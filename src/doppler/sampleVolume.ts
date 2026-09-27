// Adaptado de DanielOpazoD/vexus-sim @ 59fb7b18e9c1 — src/doppler/sampleVolume.ts (MIT).
// Simplificado para neurosono-sim: sin deformación; la velocidad material del
// tejido se modela en el bloque de clutter y recibe el estado respiratorio.
// LIM-11/LIM-12: la advección y la resiembra son aproximaciones del fixture.

/**
 * Volumen de muestra físico del Doppler pulsado:
 *
 *   z[n] = Σ_j a_j w_j e^{iφ_j} + η ;  φ_j[n+1] − φ_j[n] = 2π f_D,j Δt
 *
 * Dispersores virtuales persistentes dentro de una caja alrededor de la
 * puerta; los de sangre se advectan con el campo de velocidades y reentran por
 * su línea de corriente para no generar transitorios. El peso w_j combina la
 * ventana axial de la puerta (convolución con el pulso), el ancho lateral y el
 * espesor elevacional del haz. Nada consulta «si el cursor está dentro del
 * vaso»: la señal emerge de la física.
 */
import { SeededRandom } from '../core/random';
import type { Vec3 } from '../core/vec3';
import { dist, scale } from '../core/vec3';
import { dopplerShiftHz } from '../core/units';
import { MATERIALS } from '../anatomy/materials';
import type { HeadGeometry, Vessel } from '../anatomy/head';
import { classifyHead, vesselAt, vesselClosest, vesselDistance, vesselFlowDir } from '../anatomy/head';
import { vesselVelocityCms } from '../physiology/flow';
import type { PhysState } from '../physiology/flow';
import { FISIOLOGIA } from '../physiology/params';
import { DOPPLER } from './params';
import { tissueVelocityMmS } from './clutter';

export interface GateGeometry {
  /** Centro de la puerta en el mundo (mm). */
  center: Vec3;
  /** Dirección unitaria del haz desde la sonda hacia el tejido. */
  beamDir: Vec3;
  /** Vectores unitarios lateral (en plano) y elevacional. */
  lateral: Vec3;
  elevation: Vec3;
  /** Longitud de la puerta (mm) a lo largo del haz. */
  lengthMm: number;
  /** Semianchura lateral y elevacional del haz a esa profundidad (σ, mm). */
  lateralSigmaMm: number;
  elevationSigmaMm: number;
  /** Longitud del pulso Doppler (σ axial, mm). */
  pulseSigmaMm: number;
  /** Dispersión angular de la apertura (σ, rad): ensanchamiento espectral intrínseco. */
  apertureAngleSigmaRad?: number;
  /** Transmisión de amplitud ida y vuelta hasta la puerta (0–1). */
  transmission: number;
}

export interface GateEquipment {
  prfHz: number;
  f0Hz: number;
  /** Ganancia espectral (factor lineal aplicado a señal y ruido). */
  gain: number;
}

interface Scatterer {
  /** Posición material (mm). */
  m: Vec3;
  amp: number;
  phase: number;
  apAngle: number;
  cr: number;
  ci: number;
  rotC: number;
  rotS: number;
  w: number;
  dw: number;
  fading: boolean;
  ampTarget: number;
  dAmp: number;
  rampLeft: number;
  /** Vaso que le da flujo (null = tejido). */
  vessel: Vessel | null;
  /** Última velocidad material (mm/s), de sangre o tejido. */
  vMat: Vec3;
  /** Base de flujo congelada al clasificar: vMat = flowBasis·u(φ) — cuerda recta. */
  flowBasis: Vec3;
}

export interface GateComposition {
  bloodFraction: number;
  bloodWeight: number;
  /** Fracción del peso dentro del vaso dominante. */
  dominantVesselId: string | null;
  dominantVesselFraction: number;
}

const N_SCATTERERS = DOPPLER.params.scatterersTotal.value;
/** Dispersores sembrados sobre vasos que cruzan la caja en cada resiembra. */
const SEED_VESSEL_MAX = DOPPLER.params.scatterersVesselMax.value;
const RECLASSIFY_EVERY = 96;
const SLOW_EVERY = 8;
const AMP_RAMP_TICKS = 32;
const TRANSMISSION_ALPHA = 1 / AMP_RAMP_TICKS;
/** Ruido electrónico relativo a la sangre a transmisión 1. */
const NOISE_STD = DOPPLER.params.ruidoElectronico.value;

function startAmpRamp(s: Scatterer, target: number): void {
  s.ampTarget = target;
  s.dAmp = (target - s.amp) / AMP_RAMP_TICKS;
  s.rampLeft = AMP_RAMP_TICKS;
}

export class SampleVolumeIQ {
  private scatterers: Scatterer[] = [];
  private rng: SeededRandom;
  private tick = 0;
  private gate: GateGeometry | null = null;
  private transmissionNow = Number.NaN;
  private equipment: GateEquipment = { prfHz: 4000, f0Hz: 2e6, gain: 1 };
  private halfAxial = 4;
  private halfLateral = 5;
  private halfElev = 6;
  private composition: GateComposition = {
    bloodFraction: 0,
    bloodWeight: 0,
    dominantVesselId: null,
    dominantVesselFraction: 0,
  };

  constructor(
    private readonly head: HeadGeometry,
    seed: number,
  ) {
    this.rng = new SeededRandom(seed ^ 0xd0991e);
  }

  get lastComposition(): GateComposition {
    return this.composition;
  }

  setEquipment(e: Partial<GateEquipment>): void {
    this.equipment = { ...this.equipment, ...e };
  }

  setGate(g: GateGeometry): void {
    const moved =
      !this.gate ||
      Math.hypot(
        g.center[0] - this.gate.center[0],
        g.center[1] - this.gate.center[1],
        g.center[2] - this.gate.center[2],
      ) >
        0.5 * this.halfAxial ||
      Math.abs(g.lengthMm - this.gate.lengthMm) > 0.5;
    this.gate = g;
    if (!Number.isFinite(this.transmissionNow)) this.transmissionNow = g.transmission;
    this.halfAxial = g.lengthMm / 2 + 2.5 * g.pulseSigmaMm;
    this.halfLateral = 2.5 * g.lateralSigmaMm;
    this.halfElev = 2.5 * g.elevationSigmaMm;
    if (moved || this.scatterers.length === 0) this.reseed();
  }

  private reseed(): void {
    this.scatterers.length = 0;
    for (let i = 0; i < N_SCATTERERS; i++) this.scatterers.push(this.spawn(null));
    this.seedVessels();
    this.updateComposition();
  }

  /**
   * Siembra dirigida: la sangre llena el tubo — donde un vaso cruza la caja se
   * siembran dispersores sobre su línea central (con jitter radial), para que
   * la población mínima de sangre no dependa del azar de la caja. Como mucho
   * SEED_VESSEL_MAX por siembra.
   */
  private seedVessels(): void {
    const h = [this.halfAxial * 0.95, this.halfLateral * 0.95, this.halfElev * 0.95];
    let placed = 0;
    for (const v of this.head.vessels) {
      if (placed >= SEED_VESSEL_MAX) break;
      for (let i = 0; i + 1 < v.points.length && placed < SEED_VESSEL_MAX; i++) {
        const a = v.points[i]!;
        const b = v.points[i + 1]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const steps = Math.max(1, Math.ceil(len / 0.8));
        for (let k = 0; k <= steps && placed < SEED_VESSEL_MAX; k++) {
          const t = k / steps;
          const w: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          const c = this.worldToGate(w);
          if (Math.abs(c[0]) >= h[0]! || Math.abs(c[1]) >= h[1]! || Math.abs(c[2]) >= h[2]!) continue;
          const r = v.radiusMm * DOPPLER.params.bloodSeedRadiusFraction.value * Math.sqrt(this.rng.float());
          const th = this.rng.float() * 2 * Math.PI;
          const off1 = r * Math.cos(th);
          const off2 = r * Math.sin(th);
          const g = this.gate!;
          const world: Vec3 = [
            w[0] + g.lateral[0] * off1 + g.elevation[0] * off2,
            w[1] + g.lateral[1] * off1 + g.elevation[1] * off2,
            w[2] + g.lateral[2] * off1 + g.elevation[2] * off2,
          ];
          const sc = this.makeScatterer(world);
          sc.vessel = v;
          sc.flowBasis = this.flowBasisOf(v, world);
          this.scatterers[placed % N_SCATTERERS] = sc;
          placed++;
        }
      }
    }
  }

  private randomInBox(): [number, number, number] {
    return [
      this.rng.range(-this.halfAxial, this.halfAxial),
      this.rng.range(-this.halfLateral, this.halfLateral),
      this.rng.range(-this.halfElev, this.halfElev),
    ];
  }

  private gateToWorld(c: [number, number, number]): Vec3 {
    const g = this.gate!;
    return [
      g.center[0] + g.beamDir[0] * c[0] + g.lateral[0] * c[1] + g.elevation[0] * c[2],
      g.center[1] + g.beamDir[1] * c[0] + g.lateral[1] * c[1] + g.elevation[1] * c[2],
      g.center[2] + g.beamDir[2] * c[0] + g.lateral[2] * c[1] + g.elevation[2] * c[2],
    ];
  }

  private worldToGate(w: Vec3): [number, number, number] {
    const g = this.gate!;
    const dx = w[0] - g.center[0];
    const dy = w[1] - g.center[1];
    const dz = w[2] - g.center[2];
    return [
      dx * g.beamDir[0] + dy * g.beamDir[1] + dz * g.beamDir[2],
      dx * g.lateral[0] + dy * g.lateral[1] + dz * g.lateral[2],
      dx * g.elevation[0] + dy * g.elevation[1] + dz * g.elevation[2],
    ];
  }

  private backscatterOf(world: Vec3): number {
    const mat = classifyHead(this.head, world);
    // La sangre porta dispersores puntuales; la cifra del material da el orden.
    // Amplitud efectiva 6: la sangre sigue muy por debajo del tejido en modo B
    // pero su energía en el canal Doppler debe superar ~12 dB el ruido para
    // que la envolvente espectral sea medible en una ventana cerebral real.
    if (mat === 'vaso') return DOPPLER.params.amplitudSangre.value;
    return MATERIALS[mat].scatterAmp * 60; // tejido muy por encima de la sangre
  }

  private makeScatterer(world: Vec3): Scatterer {
    const phase = this.rng.float() * 2 * Math.PI;
    const s: Scatterer = {
      m: [world[0], world[1], world[2]],
      amp: 0,
      ampTarget: this.backscatterOf(world) * (0.7 + 0.6 * this.rng.float()),
      phase,
      apAngle: this.rng.gaussian(),
      cr: Math.cos(phase),
      ci: Math.sin(phase),
      rotC: 1,
      rotS: 0,
      w: 0,
      dw: 0,
      fading: false,
      dAmp: 0,
      rampLeft: 0,
      vessel: this.vesselAtBlood(world),
      vMat: [0, 0, 0],
      flowBasis: [0, 0, 0],
    };
    if (s.vessel) s.flowBasis = this.flowBasisOf(s.vessel, world);
    startAmpRamp(s, s.ampTarget);
    return s;
  }

  /**
   * Dirección y perfil del flujo en `m`, sin la fase: vMat = flowBasis·u(φ)
   * con u = velocidad espacial media del vaso (cm/s → mm/s). La base se congela
   * al clasificar (órbita en cuerda recta, como vexus-sim): el dispersor no se
   * curva con el tubo y su recta de vuelta coincide con la de ida.
   */
  private flowBasisOf(v: Vessel, m: Vec3): Vec3 {
    const dir = vesselFlowDir(v, m); // tangente·flowSign, unitaria
    const d = vesselDistance(v, m); // <0 dentro
    const r = Math.min(1, Math.max(0, (v.radiusMm + Math.max(d, -v.radiusMm)) / v.radiusMm));
    const profile = Math.max(0, 1 - FISIOLOGIA.params.laminarProfile.value * r * r);
    return scale(dir, profile * 10);
  }

  /**
   * Dispersor que salió de la caja: la sangre reentra en otro punto del MISMO
   * vaso dentro de la caja (sin transitorios); el tejido se resiembra al azar.
   */
  private spawn(exited: Scatterer | null): Scatterer {
    if (!exited || !exited.vessel) return this.makeScatterer(this.gateToWorld(this.randomInBox()));
    const v = exited.vMat;
    const speed = Math.hypot(v[0], v[1], v[2]);
    if (speed > 1e-6) {
      // Reentrada: un punto al azar del MISMO vaso dentro de la caja (el tubo
      // es curvo — seguir el rayo de salida en línea recta sale del vaso y el
      // reclasificador lo convertía en tejido, agotando la sangre de la puerta).
      const inside = this.pointOnVesselInBox(exited.vessel);
      if (inside) {
        const s = this.makeScatterer(inside);
        s.vessel = exited.vessel;
        s.vMat = [v[0], v[1], v[2]];
        s.amp = s.ampTarget;
        s.dAmp = 0;
        s.rampLeft = 0;
        return s;
      }
    }
    return this.makeScatterer(this.gateToWorld(this.randomInBox()));
  }

  /**
   * Punto uniforme aproximado sobre la línea central del vaso que cae dentro
   * de la caja de la puerta (con un pequeño margen), más un desplazamiento
   * radial dentro del tubo. null si no se encuentra en 40 intentos.
   */
  private pointOnVesselInBox(v: Vessel): Vec3 | null {
    const g = this.gate!;
    const h = [this.halfAxial * 0.9, this.halfLateral * 0.9, this.halfElev * 0.9];
    const nSeg = v.points.length - 1;
    for (let i = 0; i < 40; i++) {
      const seg = Math.min(nSeg - 1, Math.floor(this.rng.float() * nSeg));
      const a = v.points[seg]!;
      const b = v.points[seg + 1]!;
      const t = this.rng.float();
      // radio aleatorio dentro del tubo (raíz cuadrada: disco uniforme)
      const r = v.radiusMm * DOPPLER.params.bloodReseedRadiusFraction.value * Math.sqrt(this.rng.float());
      const th = this.rng.float() * 2 * Math.PI;
      const w: Vec3 = [
        a[0] + (b[0] - a[0]) * t + g.lateral[0] * (r * Math.cos(th)) + g.elevation[0] * (r * Math.sin(th)),
        a[1] + (b[1] - a[1]) * t + g.lateral[1] * (r * Math.cos(th)) + g.elevation[1] * (r * Math.sin(th)),
        a[2] + (b[2] - a[2]) * t + g.lateral[2] * (r * Math.cos(th)) + g.elevation[2] * (r * Math.sin(th)),
      ];
      const c = this.worldToGate(w);
      if (Math.abs(c[0]) < h[0]! && Math.abs(c[1]) < h[1]! && Math.abs(c[2]) < h[2]!) return w;
    }
    return null;
  }

  /**
   * Vaso en `world` tolerando volumen parcial: hasta 0,6 mm fuera de la pared
   * el voxel mezcla sangre y tejido — se clasifica como sangre.
   */
  private vesselAtBlood(world: Vec3): Vessel | null {
    const v = vesselAt(this.head, world);
    if (v) return v;
    let best: Vessel | null = null;
    let bestD = DOPPLER.params.partialWallMm.value;
    for (const cand of this.head.vessels) {
      const d = vesselDistance(cand, world);
      if (d >= 0 && d < bestD) {
        best = cand;
        bestD = d;
      }
    }
    return best;
  }

  private updateComposition(): void {
    let blood = 0;
    const perVessel = new Map<string, number>();
    let wsum = 0;
    for (const s of this.scatterers) {
      const w = s.w;
      wsum += w;
      if (s.vessel) {
        blood += w;
        perVessel.set(s.vessel.id, (perVessel.get(s.vessel.id) ?? 0) + w);
      }
    }
    let domId: string | null = null;
    let domW = 0;
    for (const [id, w] of perVessel) {
      if (w > domW) {
        domId = id;
        domW = w;
      }
    }
    this.composition = {
      bloodFraction: wsum > 0 ? blood / wsum : 0,
      bloodWeight: this.scatterers.length > 0 ? blood / this.scatterers.length : 0,
      dominantVesselId: domId,
      dominantVesselFraction: wsum > 0 ? domW / wsum : 0,
    };
  }

  /** Genera `n` muestras IQ a la PRF actual. Escribe en re/im desde offset. */
  generate(
    phys: PhysState,
    probeVelocity: Vec3,
    n: number,
    re: Float32Array,
    im: Float32Array,
    offset = 0,
  ): void {
    const g = this.gate;
    if (!g) {
      re.fill(0, offset, offset + n);
      im.fill(0, offset, offset + n);
      return;
    }
    const dt = 1 / this.equipment.prfHz;
    const f0 = this.equipment.f0Hz;
    const bHat: Vec3 = [-g.beamDir[0], -g.beamDir[1], -g.beamDir[2]];
    const apSigma = g.apertureAngleSigmaRad ?? 0;
    const half = g.lengthMm / 2;
    const ps = Math.max(0.2, g.pulseSigmaMm);
    const invLat2 = 1 / (g.lateralSigmaMm * g.lateralSigmaMm);
    const invEl2 = 1 / (g.elevationSigmaMm * g.elevationSigmaMm);
    const twoPiDt = 2 * Math.PI * dt;

    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      const slow = this.tick % SLOW_EVERY === 0;
      const reclass = this.tick % RECLASSIFY_EVERY === 0;
      for (let j = 0; j < this.scatterers.length; j++) {
        const s = this.scatterers[j]!;
        s.m[0] += s.vMat[0] * dt;
        s.m[1] += s.vMat[1] * dt;
        s.m[2] += s.vMat[2] * dt;
        if (slow) {
          const dx = s.m[0] - g.center[0];
          const dy = s.m[1] - g.center[1];
          const dz = s.m[2] - g.center[2];
          const ax = dx * g.beamDir[0] + dy * g.beamDir[1] + dz * g.beamDir[2];
          const la = dx * g.lateral[0] + dy * g.lateral[1] + dz * g.lateral[2];
          const el = dx * g.elevation[0] + dy * g.elevation[1] + dz * g.elevation[2];
          const outside =
            Math.abs(ax) > this.halfAxial || Math.abs(la) > this.halfLateral || Math.abs(el) > this.halfElev;
          if (outside) {
            if (s.vessel) {
              this.scatterers[j] = this.spawn(s);
              continue;
            }
            if (!s.fading) {
              s.fading = true;
              s.dw = 0;
              startAmpRamp(s, 0);
            }
          } else {
            if (s.fading && s.rampLeft <= 0) {
              this.scatterers[j] = this.spawn(null);
              continue;
            }
            if (reclass) {
              const v = this.vesselAtBlood(s.m);
              if (!s.vessel && v) {
                s.vessel = v;
                s.flowBasis = this.flowBasisOf(v, s.m);
              } else if (s.vessel) {
                if (v && v !== s.vessel) {
                  s.vessel = v;
                  s.flowBasis = this.flowBasisOf(v, s.m);
                } else if (!v) {
                  // La sangre no abandona el vaso: la cuerda recta la sacó de la
                  // pared; se reancla al tubo (máx. 0,9·R del eje) en vez de
                  // convertirla en tejido — si no, la población se agota.
                  const cl = vesselClosest(s.vessel, s.m);
                  const dr = dist(cl.point, s.m);
                  const rr =
                    Math.min(dr, s.vessel.radiusMm * DOPPLER.params.bloodReanchorRadiusFraction.value) /
                    Math.max(1e-6, dr);
                  s.m = [
                    cl.point[0] + (s.m[0] - cl.point[0]) * rr,
                    cl.point[1] + (s.m[1] - cl.point[1]) * rr,
                    cl.point[2] + (s.m[2] - cl.point[2]) * rr,
                  ];
                  s.flowBasis = this.flowBasisOf(s.vessel, s.m);
                }
              }
            }
            if (s.vessel) {
              s.vMat = scale(
                s.flowBasis,
                vesselVelocityCms(s.vessel, phys.cardiacPhase, phys.flowModulation),
              );
            } else {
              s.vMat = tissueVelocityMmS({
                head: this.head,
                point: s.m,
                cardiacPhase: phys.cardiacPhase,
                heartRateBpm: phys.heartRateBpm,
                tSec: phys.t,
              });
            }
            const wTarget =
              0.5 *
              (erf((half - ax) / (ps * Math.SQRT2)) + erf((half + ax) / (ps * Math.SQRT2))) *
              Math.exp(-0.5 * (la * la * invLat2 + el * el * invEl2));
            s.dw = (wTarget - s.w) / SLOW_EVERY;
            const vx = s.vMat[0] - probeVelocity[0];
            const vy = s.vMat[1] - probeVelocity[1];
            const vz = s.vMat[2] - probeVelocity[2];
            const da = s.apAngle * apSigma;
            const bx = bHat[0] + g.lateral[0] * da;
            const by = bHat[1] + g.lateral[1] * da;
            const bz = bHat[2] + g.lateral[2] * da;
            const bn = 1 / Math.hypot(bx, by, bz);
            const fd = dopplerShiftHz((vx * bx + vy * by + vz * bz) * bn, f0);
            const dphi = twoPiDt * fd;
            s.rotC = Math.cos(dphi);
            s.rotS = Math.sin(dphi);
          }
        }
        const cr = s.cr * s.rotC - s.ci * s.rotS;
        const ci = s.cr * s.rotS + s.ci * s.rotC;
        s.cr = cr;
        s.ci = ci;
        s.w += s.dw;
        if (s.rampLeft > 0) {
          s.amp += s.dAmp;
          s.rampLeft--;
        }
        const a = s.amp * s.w;
        sr += a * cr;
        si += a * ci;
      }
      const nr = this.rng.gaussian() * NOISE_STD;
      const ni = this.rng.gaussian() * NOISE_STD;
      this.transmissionNow += (g.transmission - this.transmissionNow) * TRANSMISSION_ALPHA;
      re[offset + k] = (sr * this.transmissionNow + nr) * this.equipment.gain;
      im[offset + k] = (si * this.transmissionNow + ni) * this.equipment.gain;
      this.tick++;
      if (this.tick % (RECLASSIFY_EVERY * 4) === 0) this.updateComposition();
    }
  }
}

/** Función error (aproximación de Abramowitz–Stegun 7.1.26, |ε| < 1,5e−7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      Math.exp(-ax * ax);
  return sign * y;
}
