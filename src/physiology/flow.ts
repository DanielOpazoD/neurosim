/**
 * Fisiología basal del adulto de referencia N1: reloj cardíaco, forma de onda
 * arterial cerebral y parámetros por vaso.
 *
 * La onda modela una ACM normal mediante una tabla Windkessel de dos elementos.
 * v(φ) = EDV + (PSV − EDV)·s(φ) con s∈[0,1].
 * TAMax emerge de integrar la envolvente real — NUNCA de (PSV+2·EDV)/3,
 * que es una aproximación clínica (plan §7.4).
 */
import { hash3, hashString } from '../core/random';
import type { Vec3 } from '../core/vec3';
import { scale, normalize } from '../core/vec3';
import type { BasalPhysiology } from '../domain/contracts';
import type { Vessel, VesselScene } from '../anatomy/head';
import { vesselAt, vesselClosest, vesselDistance, vesselRadiusAt } from '../anatomy/head';
import { arterialShapeTable, FISIOLOGIA } from './params';
import { Respiration } from './respiration';
import type { HemodynamicState } from './hemodynamics';

/** Estado fisiológico instantáneo. */
export interface PhysState {
  /** Tiempo de simulación, s. */
  readonly t: number;
  /** Fase cardíaca [0,1). */
  readonly cardiacPhase: number;
  readonly heartRateBpm: number;
  /** Fase respiratoria [0,1). */
  readonly respiratoryPhase: number;
  /** Modulación multiplicativa del flujo por respiración. */
  readonly flowModulation: number;
  readonly hemo: HemodynamicState;
}

/** Reloj cardíaco: fase y tiempos de latido para las medidas. */
export class CardiacCycle {
  private readonly starts = [0];
  private readonly intervals: number[] = [];

  constructor(
    readonly bpm: number,
    readonly seed: number,
    readonly respiration: Respiration,
  ) {}

  get periodS(): number {
    return 60 / this.bpm;
  }

  private gaussianAt(k: number): number {
    const u1 = Math.max(Number.EPSILON, hash3(this.seed, k, 0, 0x48525631));
    const u2 = hash3(this.seed, k, 1, 0x48525632);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private rrAt(k: number, tStart: number): number {
    const physiology = FISIOLOGIA.params;
    const rsa = physiology.rsaAmplitude.value * this.respiration.signalAt(tStart);
    const hrv = physiology.hrvSd.value * this.gaussianAt(k);
    return this.periodS * Math.max(0.5, 1 + rsa + hrv);
  }

  private ensureThrough(t: number): void {
    if (this.intervals.length === 0) this.intervals.push(this.rrAt(0, 0));
    while (this.starts[this.starts.length - 1]! + this.intervals[this.intervals.length - 1]! <= t) {
      const k = this.intervals.length;
      const tStart = this.starts[this.starts.length - 1]! + this.intervals[this.intervals.length - 1]!;
      this.intervals.push(this.rrAt(k, tStart));
      this.starts.push(tStart);
    }
  }

  /** Fase en [0,1) según la agenda determinista de latidos. */
  phaseAt(t: number): number {
    if (t <= 0) return 0;
    this.ensureThrough(t);
    let k = this.starts.length - 1;
    while (k > 0 && t < this.starts[k]!) k -= 1;
    const rr = this.intervals[k]!;
    return Math.min(1 - Number.EPSILON, Math.max(0, (t - this.starts[k]!) / rr));
  }

  /** Tiempos de inicio de latido que cubren [t0, t1]. */
  beatsIn(t0: number, t1: number): { tStart: number; rr: number }[] {
    if (t1 < 0) return [];
    this.ensureThrough(t1);
    const beats: { tStart: number; rr: number }[] = [];
    let first = 0;
    while (first + 1 < this.starts.length && this.starts[first]! + this.intervals[first]! < t0) first += 1;
    for (let k = first; k < this.intervals.length && this.starts[k]! <= t1; k += 1) {
      beats.push({ tStart: this.starts[k]!, rr: this.intervals[k]! });
    }
    return beats;
  }
}

/** Forma de onda arterial Windkessel sin dimensiones s(φ) ∈ [0,1]. */
export function arterialShape(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const position = p * arterialShapeTable.length;
  const left = Math.floor(position) % arterialShapeTable.length;
  const right = (left + 1) % arterialShapeTable.length;
  const fraction = position - Math.floor(position);
  return arterialShapeTable[left]! * (1 - fraction) + arterialShapeTable[right]! * fraction;
}

/**
 * Onda de alta resistencia sin dimensiones h(φ) ∈ [0,1] (ACE y ramas,
 * DEC-58): ascenso sistólico rápido con pico en φ≈0,12, caída a una incisura
 * dicrota profunda (φ≈0,24), rebote corto (φ≈0,34) y cola diastólica baja.
 * v(φ) = EDV + (PSV − EDV)·h(φ); la media de h es ≈0,15.
 */
export function highResistanceShape(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const systolic = Math.exp(-(((p - 0.12) / 0.05) ** 2));
  const rebound = 0.3 * Math.exp(-(((p - 0.34) / 0.05) ** 2));
  const ramp = Math.min(1, Math.max(0, (p - 0.3) / 0.12));
  const tail = 0.12 * ramp * ramp * (3 - 2 * ramp) * Math.exp(-(p - 0.42) / 0.35);
  return Math.min(1, systolic + rebound + tail);
}

/** Velocidad espacial media del vaso en la fase dada, cm/s. */
export function vesselVelocityCms(v: Vessel, phase: number, modulation = 1, hemo?: HemodynamicState): number {
  // Venoso: flujo cuasi estacionario — ignora la forma arterial y la onda hemodinámica.
  if (v.venous) return v.meanCms * modulation;
  // Alta resistencia (ACE): onda propia, sin reactividad cerebral.
  if (v.waveform === 'alta')
    return (v.edvCms + (v.psvCms - v.edvCms) * highResistanceShape(phase)) * modulation;
  if (hemo) return v.meanCms * hemo.flowFactor * hemo.waveform(phase) * modulation;
  return (v.edvCms + (v.psvCms - v.edvCms) * arterialShape(phase)) * modulation;
}

/** Query de flujo por posición: velocidad de la sangre (mm/s) en un punto. */
export class CerebralFlow {
  constructor(
    readonly scene: VesselScene,
    readonly phys: BasalPhysiology,
  ) {}

  /**
   * Velocidad de la sangre en mm/s en un punto del paciente.
   * Perfil laminar: v(r) = vEje·(1 − 0,85·(r/R)²) dentro del tubo.
   */
  velocityAt(p: Vec3, phase: number, modulation = 1, hemo?: HemodynamicState): Vec3 {
    const v = vesselAt(this.scene, p);
    if (!v) return [0, 0, 0];
    const d = vesselDistance(v, p); // <0 dentro
    const closest = vesselClosest(v, p);
    const radius = vesselRadiusAt(v, closest.sMm);
    const r = radius + d; // distancia al eje (d ya descuenta el radio local)
    const x = Math.min(1, Math.max(0, r / radius));
    const profile = 1 - 0.85 * x * x;
    // Continuidad: la velocidad local escala con (R/r(s))² en la estenosis.
    const continuity = (v.radiusMm / Math.max(1e-6, radius)) ** 2;
    const uCms = vesselVelocityCms(v, phase, modulation, hemo) * continuity;
    const dir = normalize(closest.tangent);
    const vel = scale(dir, v.flowSign * uCms * 10 * Math.max(0, profile));
    const turb = stenosisTurbulenceMms(v, closest.sMm, p, uCms);
    return [vel[0] + turb[0], vel[1] + turb[1], vel[2] + turb[2]];
  }
}

/**
 * Turbulencia post-estenótica (mm/s, media cero, determinista por posición):
 * para puntos dentro de 3·lengthMm corriente abajo de la garganta, una
 * componente aleatoria uniforme con σ = 0,35·(vJet − v₀). Devuelve [0,0,0]
 * fuera de la zona o si el vaso no tiene estenosis.
 */
export function stenosisTurbulenceMms(v: Vessel, sMm: number, p: Vec3, uCms: number): Vec3 {
  const st = v.stenosis;
  if (!st) return [0, 0, 0];
  const downstream = v.flowSign * (sMm - st.sMm);
  if (downstream <= 0 || downstream >= 3 * st.lengthMm) return [0, 0, 0];
  const jetExcess = uCms * (1 / (st.radiusScale * st.radiusScale) - 1);
  const std = 0.35 * Math.max(0, jetExcess) * 10; // cm/s → mm/s
  const cell = 0.5; // mm — dispersores en la misma celda comparten perturbación
  const hx = Math.round(p[0] / cell);
  const hy = Math.round(p[1] / cell);
  const hz = Math.round(p[2] / cell);
  const seed = hashString(v.id);
  const amp = Math.sqrt(3) * std; // uniforme(−a,a) → σ = a/√3 = std
  return [
    amp * (2 * hash3(hx, hy, hz, seed ^ 0x54555230) - 1),
    amp * (2 * hash3(hx, hy, hz, seed ^ 0x54555231) - 1),
    amp * (2 * hash3(hx, hy, hz, seed ^ 0x54555232) - 1),
  ];
}
