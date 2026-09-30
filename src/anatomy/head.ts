/**
 * Anatomía implícita de la cabeza para la exploración transtemporal.
 *
 * Marco del paciente (mm, levógiro): +x = izquierda, +y = superior,
 * +z = anterior. Cráneo como elipsoide con tabla ósea (hueso) cuya ventana
 * temporal tiene espesor y transmisión propios por paciente; dentro,
 * tejido cerebral, mesencéfalo (pedúnculos en «corazón»), cisternas basales
 * ecogénicas, ala esfenoidal y el polígono de Willis como tubos con línea
 * central, radio y orientación.
 *
 * Profundidades y direcciones de referencia (Siemens TCD job aid, guía AIUM):
 * M1 hacia la sonda a 45–65 mm, A1 alejándose a 60–85, bifurcación ACI a
 * 55–65 bidireccional, P1/P2 a 60–70, OA 40–60 por ventana orbital.
 */
import { MATERIALS, type MaterialId } from './materials';
import { clamp, dist, normalize, scale, sub, type Vec3 } from '../core/vec3';
import { hash3, hashString, type SeededRandom } from '../core/random';
import type { Side, WillisVariant } from '../domain/contracts';
import { ANATOMIA_CABEZA } from './params';
import { buildWillisVessels } from './willis';

const HEAD = ANATOMIA_CABEZA.params;

/** Un vaso tubular: línea central por segmentos + radio local. */
export interface Vessel {
  readonly id: string;
  readonly side: Side | 'media';
  /** Polilínea suave (Catmull-Rom remuestreada ~1 mm) usada en clasificación. */
  readonly points: readonly Vec3[];
  /** Puntos de control anatómicos que definen el vaso. */
  readonly controlPoints: readonly Vec3[];
  readonly radiusMm: number;
  /** Caja envolvente de `points` ± radio, para rechazo rápido por muestra. */
  readonly aabb: { readonly min: Vec3; readonly max: Vec3 };
  /** +1 orienta el flujo de points[0] hacia el último; −1 invierte esa dirección. */
  readonly flowSign: 1 | -1;
  /** Flujo medio del segmento, ml/min, positivo en la orientación anatómica. */
  readonly flowMlMin: number;
  /** Velocidad media derivada de Q/(πr²·0,6), cm/s. */
  readonly meanCms: number;
  /** Velocidad sistólica pico de referencia, cm/s. */
  readonly psvCms: number;
  /** Velocidad telediastólica de referencia, cm/s. */
  readonly edvCms: number;
  /**
   * Vaso venoso: flujo cuasi estacionario — `vesselVelocityCms` devuelve
   * `meanCms·modulation` plano, sin forma arterial ni modulación hemodinámica.
   */
  readonly venous?: boolean;
  /**
   * Patrón de resistencia distal (DEC-58). Ausente o `'baja'`: onda arterial
   * de baja resistencia modulada por la hemodinámica cerebral (ACM, ACI).
   * `'alta'`: onda de alta resistencia (ACE y ramas) con EDV baja e incisura
   * dicrota, fija entre `edvCms` y `psvCms`: el territorio extracraneal no
   * sigue la reactividad al CO₂ ni la autorregulación cerebral.
   */
  readonly waveform?: 'baja' | 'alta';
  /**
   * Estenosis focal: posición a lo largo de la línea central (`sMm`, arco en mm),
   * longitud de la lesión y factor de radio mínimo en la garganta. El radio
   * local es `vesselRadiusAt`; el vaso sin estenosis usa `radiusMm` constante.
   */
  readonly stenosis?: {
    readonly sMm: number;
    readonly lengthMm: number;
    readonly radiusScale: number;
  };
}

/**
 * Escena vascular mínima para la cadena Doppler (color, PW, insonación,
 * movimiento tisular): cualquier geometría con vasos la satisface
 * (`HeadGeometry`, o el grafo ocular `EyeGeometry.vessels`). `classify` y
 * `attenuationDb` permiten a una escena no craneal aportar su propio material
 * y modelo de atenuación; si faltan, los consumidores asumen la cabeza.
 */
export interface VesselScene {
  readonly vessels: readonly Vessel[];
  readonly classify?: (p: Vec3) => MaterialId;
  /** Atenuación ida y vuelta (dB) sonda→punto, igual que `skullAttenuationDb`. */
  readonly attenuationDb?: (from: Vec3, to: Vec3, f0Mhz: number) => number;
}

/** Cabeza del adulto de referencia con ventanas temporales. */
export interface HeadGeometry {
  /** Centro del elipsoide craneal. */
  readonly skullCenter: Vec3;
  /** Semiejes del cráneo exterior, mm. */
  readonly skullRadii: Vec3;
  /** Espesor óseo fuera de la ventana, mm. */
  readonly skullThicknessMm: number;
  /** Espesor óseo dentro de la ventana temporal, mm. */
  readonly windowThicknessMm: number;
  /** Factor de transmisión de la ventana [0,1] (1 = ideal). */
  readonly windowQuality: number;
  /** Centro de cada ventana temporal sobre la superficie, por lado. */
  readonly windowCenter: Record<Side, Vec3>;
  /** Radio útil de la ventana, mm. */
  readonly windowRadiusMm: number;
  readonly vessels: readonly Vessel[];
  /** Centro del mesencéfalo. */
  readonly midbrainCenter: Vec3;
  readonly midbrainRadii: Vec3;
  /** Centro del III ventrículo en el plano diencefálico. */
  readonly thirdVentricleCenter: Vec3;
  /** Ancho lateral del III ventrículo, mm (sustitución de caso p. ej. hidrocefalia). */
  readonly thirdVentricleWidthMm: number;
  /** Escala sobre los radios de los cuernos frontales (1 = normal). */
  readonly frontalHornScale: number;
  /** Desplazamiento de línea media supratentorial en mm (+ = hacia la izquierda, +x). */
  readonly midlineShiftMm: number;
  /** Escala del área de sustancia nigra (casos con SN hiperecogénica; 1 normal). */
  readonly snAreaScale?: number;
}

export type LandmarkId =
  | 'mesencefalo'
  | 'sustanciaNegra'
  | 'nucleoRojo'
  | 'rafe'
  | 'cisternaInterpeduncular'
  | 'tercerVentriculo'
  | 'talamo'
  | 'pineal'
  | 'cuernoFrontal'
  | 'alaEsfenoidal'
  | 'penasco'
  | 'craneoContralateral';

/** Distancia al segmento ab. */
function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const t = clamp(
    ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) /
      Math.max(1e-9, abx * abx + aby * aby + abz * abz),
    0,
    1,
  );
  const qx = a[0] + abx * t;
  const qy = a[1] + aby * t;
  const qz = a[2] + abz * t;
  return Math.hypot(p[0] - qx, p[1] - qy, p[2] - qz);
}

/**
 * Segmentos precalculados por vaso (DEC-54): extremos, vector ab, los dos
 * denominadores que usan `segDist` y `vesselClosest`, longitud y arco
 * acumulado — con la misma aritmética que el cálculo por llamada.
 */
interface SegCache {
  readonly n: number;
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly az: Float64Array;
  readonly abx: Float64Array;
  readonly aby: Float64Array;
  readonly abz: Float64Array;
  /** max(1e-9, |ab|²) como en `segDist`. */
  readonly denD: Float64Array;
  /** |ab| (Math.hypot) y max(1e-9, |ab|·|ab|) como en `vesselClosest`. */
  readonly len: Float64Array;
  readonly denC: Float64Array;
  /** Arco acumulado antes del segmento i (suma secuencial de |ab|). */
  readonly sAcc: Float64Array;
  /** Bloques de SEG_BLOCK segmentos: esfera envolvente (centro, radio). */
  readonly nb: number;
  readonly bcx: Float64Array;
  readonly bcy: Float64Array;
  readonly bcz: Float64Array;
  readonly brad: Float64Array;
}

/** Segmentos por bloque para el descarte por esfera envolvente. */
const SEG_BLOCK = 8;

const segCaches = new WeakMap<Vessel, SegCache>();
function segCache(v: Vessel): SegCache {
  let c = segCaches.get(v);
  if (c) return c;
  const n = Math.max(0, v.points.length - 1);
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const az = new Float64Array(n);
  const abx = new Float64Array(n);
  const aby = new Float64Array(n);
  const abz = new Float64Array(n);
  const denD = new Float64Array(n);
  const len = new Float64Array(n);
  const denC = new Float64Array(n);
  const sAcc = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = v.points[i]!;
    const b = v.points[i + 1]!;
    ax[i] = a[0];
    ay[i] = a[1];
    az[i] = a[2];
    const x = b[0] - a[0];
    const y = b[1] - a[1];
    const z = b[2] - a[2];
    abx[i] = x;
    aby[i] = y;
    abz[i] = z;
    denD[i] = Math.max(1e-9, x * x + y * y + z * z);
    const l = Math.hypot(x, y, z);
    len[i] = l;
    denC[i] = Math.max(1e-9, l * l);
    sAcc[i] = acc;
    acc += l;
  }
  const nb = Math.ceil(n / SEG_BLOCK);
  const bcx = new Float64Array(nb);
  const bcy = new Float64Array(nb);
  const bcz = new Float64Array(nb);
  const brad = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    const iEnd = Math.min(n, (b + 1) * SEG_BLOCK);
    for (let i = b * SEG_BLOCK; i <= iEnd; i++) {
      const q = v.points[i]!;
      x0 = Math.min(x0, q[0]);
      y0 = Math.min(y0, q[1]);
      z0 = Math.min(z0, q[2]);
      x1 = Math.max(x1, q[0]);
      y1 = Math.max(y1, q[1]);
      z1 = Math.max(z1, q[2]);
    }
    bcx[b] = (x0 + x1) / 2;
    bcy[b] = (y0 + y1) / 2;
    bcz[b] = (z0 + z1) / 2;
    // Radio holgado (+1e-6) para absorber el redondeo.
    brad[b] = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 1e-6;
  }
  c = { n, ax, ay, az, abx, aby, abz, denD, len, denC, sAcc, nb, bcx, bcy, bcz, brad };
  segCaches.set(v, c);
  return c;
}

let scratchD2 = new Float64Array(256);
function scratch(n: number): Float64Array {
  if (scratchD2.length < n) scratchD2 = new Float64Array(Math.max(n, 2 * scratchD2.length));
  return scratchD2;
}

/**
 * Margen relativo del prefiltro por distancia al cuadrado: `Math.hypot` y
 * `√(dx²+dy²+dz²)` difieren en pocos ulp (~1e-16), así que un segmento cuyo
 * d² supera al mínimo en más de 1e-12 no puede dar el mínimo exacto. Solo los
 * candidatos se evalúan con `Math.hypot` → resultados bit a bit idénticos.
 */
const D2_MARGIN = 1e-12;

/**
 * Primera pasada: d² de cada segmento a `p` en `d2s` (con el denominador
 * `den`, el de `segDist` o el de `vesselClosest`) y devuelve el mínimo. Los
 * bloques cuya esfera envolvente queda estrictamente más lejos que el mejor
 * d² hallado se marcan +∞ sin evaluar: no pueden contener el mínimo ni un
 * candidato de la segunda pasada (margen 1e-9 ≫ redondeo). El bloque más
 * cercano se evalúa primero para que el descarte sea eficaz.
 */
function segD2Pass(
  c: SegCache,
  den: Float64Array,
  px: number,
  py: number,
  pz: number,
  d2s: Float64Array,
): number {
  let best2 = Infinity;
  let first = 0;
  if (c.nb > 1) {
    let bestLb = Infinity;
    for (let b = 0; b < c.nb; b++) {
      const dx = px - c.bcx[b]!;
      const dy = py - c.bcy[b]!;
      const dz = pz - c.bcz[b]!;
      const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - c.brad[b]!;
      if (lb < bestLb) {
        bestLb = lb;
        first = b;
      }
    }
  }
  for (let k = 0; k < c.nb; k++) {
    const b = k === 0 ? first : k <= first ? k - 1 : k;
    const i0 = b * SEG_BLOCK;
    const i1 = Math.min(c.n, i0 + SEG_BLOCK);
    if (best2 < Infinity) {
      const dx = px - c.bcx[b]!;
      const dy = py - c.bcy[b]!;
      const dz = pz - c.bcz[b]!;
      const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - c.brad[b]! - 1e-6;
      if (lb > 0 && lb * lb > best2 * (1 + 1e-9)) {
        for (let i = i0; i < i1; i++) d2s[i] = Infinity;
        continue;
      }
    }
    for (let i = i0; i < i1; i++) {
      const ax = c.ax[i]!;
      const ay = c.ay[i]!;
      const az = c.az[i]!;
      const abx = c.abx[i]!;
      const aby = c.aby[i]!;
      const abz = c.abz[i]!;
      const t = clamp(((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / den[i]!, 0, 1);
      const dx = px - (ax + abx * t);
      const dy = py - (ay + aby * t);
      const dz = pz - (az + abz * t);
      const d2 = dx * dx + dy * dy + dz * dz;
      d2s[i] = d2;
      if (d2 < best2) best2 = d2;
    }
  }
  return best2;
}

/** Distancia al tubo (polilínea) de un vaso. */
export function vesselDistance(v: Vessel, p: Vec3): number {
  const { min, max } = v.aabb;
  if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1] || p[2] < min[2] || p[2] > max[2]) {
    return Infinity;
  }
  // Estenosis focal: el radio varía con s — usar el punto más cercano.
  if (v.stenosis) {
    const c = vesselClosest(v, p);
    return dist(c.point, p) - vesselRadiusAt(v, c.sMm);
  }
  const c = segCache(v);
  const d2s = scratch(c.n);
  const px = p[0];
  const py = p[1];
  const pz = p[2];
  const best2 = segD2Pass(c, c.denD, px, py, pz, d2s);
  const lim = best2 + best2 * D2_MARGIN;
  let d = Infinity;
  for (let i = 0; i < c.n; i++) {
    if (!(d2s[i]! <= lim)) continue;
    const ax = c.ax[i]!;
    const ay = c.ay[i]!;
    const az = c.az[i]!;
    const abx = c.abx[i]!;
    const aby = c.aby[i]!;
    const abz = c.abz[i]!;
    const t = clamp(((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / c.denD[i]!, 0, 1);
    d = Math.min(d, Math.hypot(px - (ax + abx * t), py - (ay + aby * t), pz - (az + abz * t)));
  }
  return d - v.radiusMm;
}

/**
 * Cota inferior barata de `vesselDistance(v, p)` (esferas de bloque, con
 * holgura ≥ 1e-6 ≫ redondeo): permite descartar un vaso sin cambiar qué vaso
 * resulta el más cercano. +∞ fuera de la AABB; −∞ (sin cota) con estenosis.
 */
export function vesselLowerBound(v: Vessel, p: Vec3): number {
  const { min, max } = v.aabb;
  if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1] || p[2] < min[2] || p[2] > max[2]) {
    return Infinity;
  }
  if (v.stenosis) return -Infinity;
  const c = segCache(v);
  let lb = Infinity;
  for (let b = 0; b < c.nb; b++) {
    const dx = p[0] - c.bcx[b]!;
    const dy = p[1] - c.bcy[b]!;
    const dz = p[2] - c.bcz[b]!;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - c.brad[b]!;
    if (d < lb) lb = d;
  }
  return Math.max(0, lb - 1e-6) - v.radiusMm;
}

/**
 * `vesselDistance(v, p) < 0` con salida temprana (clasificación): basta un
 * segmento dentro del tubo. Mismo resultado booleano, sin recorrer el resto.
 */
export function vesselContains(v: Vessel, p: Vec3): boolean {
  const { min, max } = v.aabb;
  if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1] || p[2] < min[2] || p[2] > max[2]) {
    return false;
  }
  if (v.stenosis) return vesselDistance(v, p) < 0;
  const c = segCache(v);
  const r = v.radiusMm;
  const r2lim = r * r + r * r * D2_MARGIN;
  const px = p[0];
  const py = p[1];
  const pz = p[2];
  for (let i = 0; i < c.n; i++) {
    if (i % SEG_BLOCK === 0) {
      // Bloque entero fuera del tubo: su esfera queda a más de r (con holgura).
      const b = i / SEG_BLOCK;
      const bx = px - c.bcx[b]!;
      const by = py - c.bcy[b]!;
      const bz = pz - c.bcz[b]!;
      if (Math.sqrt(bx * bx + by * by + bz * bz) - c.brad[b]! - 1e-6 > r) {
        i += SEG_BLOCK - 1;
        continue;
      }
    }
    const ax = c.ax[i]!;
    const ay = c.ay[i]!;
    const az = c.az[i]!;
    const abx = c.abx[i]!;
    const aby = c.aby[i]!;
    const abz = c.abz[i]!;
    const t = clamp(((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / c.denD[i]!, 0, 1);
    const dx = px - (ax + abx * t);
    const dy = py - (ay + aby * t);
    const dz = pz - (az + abz * t);
    if (dx * dx + dy * dy + dz * dz > r2lim) continue;
    if (Math.hypot(dx, dy, dz) - r < 0) return true;
  }
  return false;
}

/**
 * Radio local del vaso en el arco `sMm`. Con estenosis: garganta gaussiana
 * `R·(1 − (1−radiusScale)·exp(−((s−s₀)/(L/2))²))`; sin estenosis, `radiusMm`.
 */
export function vesselRadiusAt(v: Vessel, sMm: number): number {
  const st = v.stenosis;
  if (!st) return v.radiusMm;
  const bump = Math.exp(-(((sMm - st.sMm) / (st.lengthMm / 2)) ** 2));
  return v.radiusMm * (1 - (1 - st.radiusScale) * bump);
}

/** Punto más cercano sobre la línea central y tangente local. */
export function vesselClosest(v: Vessel, p: Vec3): { point: Vec3; tangent: Vec3; sMm: number } {
  const { min, max } = v.aabb;
  if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1] || p[2] < min[2] || p[2] > max[2]) {
    return { point: [...v.points[0]!] as Vec3, tangent: [1, 0, 0], sMm: 0 };
  }
  let bestX = v.points[0]![0];
  let bestY = v.points[0]![1];
  let bestZ = v.points[0]![2];
  let bestTx = 0;
  let bestTy = 0;
  let bestTz = 0;
  let bestS = 0;
  {
    const abx = v.points[1]![0] - bestX;
    const aby = v.points[1]![1] - bestY;
    const abz = v.points[1]![2] - bestZ;
    const l = Math.hypot(abx, aby, abz);
    if (l > 0) {
      bestTx = abx / l;
      bestTy = aby / l;
      bestTz = abz / l;
    }
  }
  // Prefiltro d² (ver D2_MARGIN) y evaluación exacta, en orden, de los
  // candidatos: se conserva el primer mínimo estricto como antes.
  const c = segCache(v);
  const d2s = scratch(c.n);
  const px = p[0];
  const py = p[1];
  const pz = p[2];
  const best2 = segD2Pass(c, c.denC, px, py, pz, d2s);
  const lim = best2 + best2 * D2_MARGIN;
  let bestD = Infinity;
  for (let i = 0; i < c.n; i++) {
    if (!(d2s[i]! <= lim)) continue;
    const ax = c.ax[i]!;
    const ay = c.ay[i]!;
    const az = c.az[i]!;
    const abx = c.abx[i]!;
    const aby = c.aby[i]!;
    const abz = c.abz[i]!;
    const len = c.len[i]!;
    const t = clamp(((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / c.denC[i]!, 0, 1);
    const qx = ax + abx * t;
    const qy = ay + aby * t;
    const qz = az + abz * t;
    const d = Math.hypot(px - qx, py - qy, pz - qz);
    if (d < bestD) {
      bestD = d;
      bestX = qx;
      bestY = qy;
      bestZ = qz;
      if (len > 0) {
        bestTx = abx / len;
        bestTy = aby / len;
        bestTz = abz / len;
      } else {
        bestTx = 0;
        bestTy = 0;
        bestTz = 0;
      }
      bestS = c.sAcc[i]! + t * len;
    }
  }
  return { point: [bestX, bestY, bestZ], tangent: [bestTx, bestTy, bestTz], sMm: bestS };
}

/** Dirección del flujo en el punto (vector de la línea central orientada). */
export function vesselFlowDir(v: Vessel, p: Vec3): Vec3 {
  return scale(vesselClosest(v, p).tangent, v.flowSign);
}

/**
 * Cabeza del adulto de referencia N1.
 * Ventana temporal: sobre el arco cigomático, anterior a la oreja; centros
 * calculados sobre el elipsoide. `windowQuality` estable por paciente.
 */
export function buildReferenceHead(
  rng: SeededRandom,
  variant: WillisVariant = 'normal',
  vesselRadiusScale: Readonly<Record<string, number>> = {},
  windowOverride: { thicknessMm?: number; quality?: number } = {},
  snAreaScale = 1,
  vesselStenosis: Readonly<Record<string, NonNullable<Vessel['stenosis']>>> = {},
  diencephalon: {
    midlineShiftMm?: number;
    thirdVentricleWidthMm?: number;
    frontalHornScale?: number;
  } = {},
): HeadGeometry {
  const midlineShiftMm = diencephalon.midlineShiftMm ?? 0;
  const skullCenter: Vec3 = [HEAD.skullCenterXmm.value, HEAD.skullCenterYmm.value, HEAD.skullCenterZmm.value];
  const skullRadii: Vec3 = [HEAD.skullRadiusXmm.value, HEAD.skullRadiusYmm.value, HEAD.skullRadiusZmm.value];
  const r = rng.fork('head');
  const windowThicknessMm = windowOverride.thicknessMm ?? HEAD.windowThicknessMm.value + r.range(0, 0.4);
  const windowQuality = windowOverride.quality ?? HEAD.windowQuality.value; // adulto de referencia: ventana utilizable

  // Ventana: punto del elipsoide a azimut lateral y algo anterior (pterion).
  const mkWindow = (side: Side): Vec3 => {
    const s = side === 'izq' ? 1 : -1;
    const az = s * Math.PI * HEAD.windowAzimuthTurns.value; // hacia ±x, algo anterior
    const el = HEAD.windowElevationRad.value; // algo por debajo del ecuador
    const dir: Vec3 = [
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el) * HEAD.windowAnteriorFactor.value,
    ];
    const nd = normalize(dir);
    return [
      skullCenter[0] + nd[0] * skullRadii[0],
      skullCenter[1] + nd[1] * skullRadii[1],
      skullCenter[2] + nd[2] * skullRadii[2],
    ];
  };

  return {
    skullCenter,
    skullRadii,
    skullThicknessMm: HEAD.skullThicknessMm.value,
    windowThicknessMm,
    windowQuality,
    windowCenter: { der: mkWindow('der'), izq: mkWindow('izq') },
    windowRadiusMm: HEAD.windowRadiusMm.value,
    vessels: buildWillisVessels(variant, vesselRadiusScale, vesselStenosis),
    snAreaScale,
    midbrainCenter: [
      HEAD.midbrainCenterXmm.value,
      HEAD.midbrainCenterYmm.value,
      HEAD.midbrainCenterZmm.value,
    ],
    midbrainRadii: [HEAD.midbrainRadiusXmm.value, HEAD.midbrainRadiusYmm.value, HEAD.midbrainRadiusZmm.value],
    thirdVentricleCenter: [
      HEAD.midbrainCenterXmm.value + midlineShiftMm,
      HEAD.midbrainCenterYmm.value + 12,
      HEAD.midbrainCenterZmm.value - 9,
    ],
    thirdVentricleWidthMm: diencephalon.thirdVentricleWidthMm ?? HEAD.thirdVentricleWidthMm.value,
    frontalHornScale: diencephalon.frontalHornScale ?? 1,
    midlineShiftMm,
  };
}

/** Posición radial normalizada dentro del elipsoide craneal (≤1 dentro). */
function ellipsoidLevel(c: Vec3, radii: Vec3, p: Vec3): number {
  const d = sub(p, c);
  return Math.hypot(d[0] / radii[0], d[1] / radii[1], d[2] / radii[2]);
}

/**
 * Ruido de retícula trilineal en [-1,1] con paso configurable (idéntico al
 * de speckle.ts; duplicado aquí porque anatomy no puede importar ultrasound).
 */
function latticeNoise(seed: string, p: Vec3, pitchMm: number): number {
  const fx = p[0] / pitchMm;
  const fy = p[1] / pitchMm;
  const fz = p[2] / pitchMm;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const sz = tz * tz * (3 - 2 * tz);
  const nodeSeed = hashString(seed);
  let acc = 0;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
        const node = ((x0 + dx) * 73856093) ^ ((y0 + dy) * 19349663) ^ ((z0 + dz) * 83492791);
        acc += w * (2 * hash3(node, 0, 0, nodeSeed) - 1);
      }
    }
  }
  return acc;
}

/** Distancia al centro de ventana más cercano (cualquier lado). */
function windowDistance(h: HeadGeometry, p: Vec3): number {
  return Math.min(dist(p, h.windowCenter.izq), dist(p, h.windowCenter.der));
}

/** ¿Está el punto dentro de la ventana temporal del lado indicado? */
export function inTemporalWindow(h: HeadGeometry, side: Side, p: Vec3): boolean {
  return skullThicknessAt(h, p) < (h.skullThicknessMm + h.windowThicknessMm) / 2;
}

/**
 * Espesor óseo efectivo en un punto de la tabla craneal: campo suave que
 * adelgaza hacia la ventana temporal más cercana (escamosa) más un jitter
 * determinista de ±0,3 mm que rompe la tabla interna perfecta.
 */
export function skullThicknessAt(h: HeadGeometry, p: Vec3): number {
  const d = windowDistance(h, p);
  const w = Math.exp(-((d / h.windowRadiusMm) ** 2));
  return h.skullThicknessMm - (h.skullThicknessMm - h.windowThicknessMm) * w;
}

/**
 * Espesor con jitter determinista de ±0,3 mm (ruido de 6 mm) que rompe la
 * tabla interna perfecta; nulo en el centro de la ventana.
 */
export function skullThicknessJittered(h: HeadGeometry, p: Vec3): number {
  const d = windowDistance(h, p);
  const w = Math.exp(-((d / h.windowRadiusMm) ** 2));
  return skullThicknessAt(h, p) + 0.3 * latticeNoise('craneo:tabla', p, 6) * (1 - w);
}

/** Punto sobre la superficie del cuero cabelludo en la dirección de `p`:
 * proyecta `p` sobre el elipsoide escalado a nivel 1 + `scalpMm`/R_dir, donde
 * R_dir es el radio local del elipsoide en esa dirección. */
export function surfacePoint(h: HeadGeometry, p: Vec3, scalpMm = 0): Vec3 {
  const c = h.skullCenter;
  const r = h.skullRadii;
  const qx = (p[0] - c[0]) / r[0];
  const qy = (p[1] - c[1]) / r[1];
  const qz = (p[2] - c[2]) / r[2];
  const level = Math.hypot(qx, qy, qz);
  if (level <= 0) return [c[0] + r[0], c[1], c[2]];
  const uqx = qx / level;
  const uqy = qy / level;
  const uqz = qz / level;
  const rDir = Math.hypot(uqx * r[0], uqy * r[1], uqz * r[2]); // mm al hueso
  const k = (1 + scalpMm / rDir) / level;
  return [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k, c[2] + (p[2] - c[2]) * k];
}

/**
 * ¿El punto cae dentro de la tabla interna del cráneo? Versión barata sin
 * jitter: basta para decidir si la pulsación cerebral aplica.
 */
export function insideInnerTable(h: HeadGeometry, p: Vec3): boolean {
  const t = skullThicknessAt(h, p);
  return (
    ellipsoidLevel(h.skullCenter, [h.skullRadii[0] - t, h.skullRadii[1] - t, h.skullRadii[2] - t], p) <= 1.0
  );
}

/**
 * Clasifica un punto del paciente para la escena transcraneal.
 * Orden: fuera de la cabeza → piel/cuero cabelludo → hueso → vasos →
 * mesencéfalo → cisternas → tejido cerebral.
 */
export function classifyHead(h: HeadGeometry, p: Vec3): MaterialId {
  const level = ellipsoidLevel(h.skullCenter, h.skullRadii, p);
  if (level > 1.0) {
    // Cuero cabelludo: 2,5 mm de piel y, en la fosa temporal, ~5 mm de
    // músculo temporal hipoecoico debajo; fuera de ella, solo piel.
    const scalpMm = Math.min(...h.skullRadii.map((r) => r)) * (level - 1.0);
    const inFossa = windowDistance(h, p) < 1.6 * h.windowRadiusMm;
    const totalMm = inFossa ? 7.5 : 2.5;
    if (scalpMm > totalMm) return 'aire';
    // Piel en los 2,5 mm más externos; debajo, temporalis solo en la fosa.
    if (scalpMm > totalMm - 2.5 || !inFossa) return 'piel';
    return 'musculoTemporal';
  }
  // El jitter de la tabla solo decide píxeles a <~1 mm de la superficie
  // interna; en el parénquima profundo basta el espesor suave (sin ruido).
  const rMin = Math.min(h.skullRadii[0], h.skullRadii[1], h.skullRadii[2]);
  let innerLevel = ellipsoidLevel(
    h.skullCenter,
    [
      h.skullRadii[0] - skullThicknessAt(h, p),
      h.skullRadii[1] - skullThicknessAt(h, p),
      h.skullRadii[2] - skullThicknessAt(h, p),
    ],
    p,
  );
  if (Math.abs(innerLevel - 1.0) < 1.2 / rMin) {
    const boneMm = skullThicknessJittered(h, p);
    innerLevel = ellipsoidLevel(
      h.skullCenter,
      [h.skullRadii[0] - boneMm, h.skullRadii[1] - boneMm, h.skullRadii[2] - boneMm],
      p,
    );
  }
  if (innerLevel > 1.0) return 'hueso';

  // Vasos intracraneales (antes que el tejido cerebral de fondo).
  for (const v of h.vessels) {
    if (vesselContains(v, p)) return 'vaso';
  }

  const diencephalon = classifyDiencephalon(h, p);
  if (diencephalon) return diencephalon;

  const special = classifyMidbrainSpecial(h, p);
  if (special) return special;

  // Mesencéfalo en mariposa: dos pedúnculos y un tegmento posterior.
  const mb = butterflyLevel(h, p);
  if (mb <= 1.0) return 'mesencefalo';

  // Cisternas basales: borde ecogénico fino (~3 mm) alrededor del mesencéfalo.
  if (mb < 1.22) return 'cisterna';

  // Fisura silviana/ínsula: banda ecogénica (LCR+pía) a lo largo del M1.
  const sylvian = sylvianDist(p);
  if (sylvian < 1.2) return 'cisterna';

  if (isPetrous(h, p)) return 'crestaOsea';

  // Ala esfenoidal: cresta ecogénica anterior-lateral (referencia M1/ACA).
  if (isSphenoid(h, p)) return 'crestaOsea';

  // Hoz: lámina dural de línea media por encima del cuerpo calloso (sigue el
  // desplazamiento de línea media del caso, si existe).
  if (Math.abs(p[0] - h.midlineShiftMm) < 0.6 && p[1] > h.midbrainCenter[1] + 8) return 'hoz';

  // Corteza: banda de ~3 mm pegada a la tabla interna; dentro, sustancia blanca.
  if (innerLevel > 1.0 - 3 / Math.min(...h.skullRadii)) return 'tejidoCerebral';
  return 'sustanciaBlanca';
}

/** Polilínea de la fisura silviana lateral por lado (mm, marco paciente). */
function sylvianDist(p: Vec3): number {
  const s = p[0] >= 0 ? 1 : -1;
  const pts: Vec3[] = [
    [s * 30, 12, 5],
    [s * 42, 22, 4],
    [s * 50, 34, 0],
  ];
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    d = Math.min(d, segDist(p, pts[i]!, pts[i + 1]!));
  }
  return d;
}

function diencephalonCenter(h: HeadGeometry): Vec3 {
  return h.thirdVentricleCenter;
}

function classifyDiencephalon(h: HeadGeometry, p: Vec3): MaterialId | null {
  const c = diencephalonCenter(h);
  const d = sub(p, c);
  const width = h.thirdVentricleWidthMm / 2;
  const height = HEAD.thirdVentricleHeightMm.value / 2;
  const depth = HEAD.thirdVentricleDepthMm.value / 2;
  const hornScale = h.frontalHornScale;
  const insideLong = Math.abs(d[1]) <= height && Math.abs(d[2]) <= depth;
  const pineal = [c[0], c[1], c[2] - 7] as Vec3;
  if (dist(p, pineal) <= HEAD.pinealRadiusMm.value) return 'pineal';
  for (const s of [-1, 1] as const) {
    const horn = [
      c[0] + s * HEAD.frontalHornCenterXmm.value,
      c[1],
      c[2] + HEAD.frontalHornCenterZmm.value,
    ] as Vec3;
    if (
      ellipsoidLevel(
        horn,
        [
          HEAD.frontalHornRadiusXmm.value * hornScale,
          HEAD.frontalHornRadiusYmm.value * hornScale,
          HEAD.frontalHornRadiusZmm.value * hornScale,
        ],
        p,
      ) <= 1
    ) {
      return 'lcrVaina';
    }
  }
  if (insideLong && Math.abs(d[0]) <= width) return 'lcrVaina';
  if (
    insideLong &&
    Math.abs(d[0]) <= width + HEAD.ependimoThicknessMm.value &&
    Math.abs(d[0]) >= width - HEAD.ependimoThicknessMm.value
  ) {
    return 'ependimo';
  }
  for (const s of [-1, 1] as const) {
    const center: Vec3 = [c[0] + s * HEAD.thalamusCenterXmm.value, c[1], c[2]];
    if (
      ellipsoidLevel(
        center,
        [HEAD.thalamusRadiusXmm.value, HEAD.thalamusRadiusYmm.value, HEAD.thalamusRadiusZmm.value],
        p,
      ) <= 1
    ) {
      return 'talamo';
    }
  }
  return null;
}

function peduncleCenter(h: HeadGeometry, side: -1 | 1): Vec3 {
  return [
    h.midbrainCenter[0] + side * HEAD.peduncleOffsetXmm.value,
    h.midbrainCenter[1],
    h.midbrainCenter[2],
  ];
}

function substantiaNigraCenter(h: HeadGeometry, side: -1 | 1): Vec3 {
  return [
    h.midbrainCenter[0] + side * HEAD.peduncleOffsetXmm.value,
    h.midbrainCenter[1] + HEAD.snCenterYmm.value,
    h.midbrainCenter[2] + HEAD.snCenterZOffsetMm.value,
  ];
}

function redNucleusCenter(h: HeadGeometry, side: -1 | 1): Vec3 {
  return [h.midbrainCenter[0] + side * 3, h.midbrainCenter[1] + 1, h.midbrainCenter[2] - 4];
}

/** Mínimo suave polinómico (k en unidades de nivel normalizado). */
function smin(a: number, b: number, k: number): number {
  const h0 = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h0 * h0 * k * 0.25;
}

/** Nivel del mesencéfalo en «mariposa» (≤1 dentro); exportado para headScene. */
export function butterflyLevel(h: HeadGeometry, p: Vec3): number {
  const pedRadii: Vec3 = [
    HEAD.peduncleRadiusXmm.value,
    HEAD.peduncleRadiusYmm.value,
    HEAD.peduncleRadiusZmm.value,
  ];
  const tegmentum: Vec3 = [h.midbrainCenter[0], h.midbrainCenter[1], h.midbrainCenter[2] - 4];
  const tegmentumRadii: Vec3 = [
    HEAD.tegmentumRadiusXmm.value,
    HEAD.tegmentumRadiusYmm.value,
    HEAD.tegmentumRadiusZmm.value,
  ];
  return smin(
    smin(
      ellipsoidLevel(peduncleCenter(h, -1), pedRadii, p),
      ellipsoidLevel(peduncleCenter(h, 1), pedRadii, p),
      0.25,
    ),
    ellipsoidLevel(tegmentum, tegmentumRadii, p),
    0.25,
  );
}

/**
 * Formas del mesencéfalo compartidas entre clasificador y navegador 3D:
 * dos pedúnculos laterales + tegmento posterior (marco paciente, mm).
 */
export function midbrainShapes(h: HeadGeometry): { center: Vec3; radii: Vec3 }[] {
  const pedRadii: Vec3 = [
    HEAD.peduncleRadiusXmm.value,
    HEAD.peduncleRadiusYmm.value,
    HEAD.peduncleRadiusZmm.value,
  ];
  const tegRadii: Vec3 = [
    HEAD.tegmentumRadiusXmm.value,
    HEAD.tegmentumRadiusYmm.value,
    HEAD.tegmentumRadiusZmm.value,
  ];
  return [
    { center: peduncleCenter(h, -1), radii: pedRadii },
    { center: peduncleCenter(h, 1), radii: pedRadii },
    {
      center: [h.midbrainCenter[0], h.midbrainCenter[1], h.midbrainCenter[2] - 4],
      radii: tegRadii,
    },
  ];
}

/** Formas del diencéfalo (tálamos + tercer ventrículo) para el navegador 3D. */
export function diencephalonShapes(h: HeadGeometry): {
  thalami: { center: Vec3; radii: Vec3 }[];
  ventricle: { center: Vec3; half: Vec3 };
} {
  const c = diencephalonCenter(h);
  return {
    thalami: ([-1, 1] as const).map((s) => ({
      center: [c[0] + s * HEAD.thalamusCenterXmm.value, c[1], c[2]] as Vec3,
      radii: [
        HEAD.thalamusRadiusXmm.value,
        HEAD.thalamusRadiusYmm.value,
        HEAD.thalamusRadiusZmm.value,
      ] as Vec3,
    })),
    ventricle: {
      center: c,
      half: [
        h.thirdVentricleWidthMm / 2,
        HEAD.thirdVentricleHeightMm.value / 2,
        HEAD.thirdVentricleDepthMm.value / 2,
      ],
    },
  };
}

function classifyMidbrainSpecial(h: HeadGeometry, p: Vec3): MaterialId | null {
  const md = sub(p, h.midbrainCenter);
  const snHeightMm =
    (HEAD.snAreaCm2.value * (h.snAreaScale ?? 1) * 100) / (Math.PI * HEAD.snHalfWidthMm.value);
  for (const s of [-1, 1] as const) {
    if (
      ellipsoidLevel(
        substantiaNigraCenter(h, s),
        [HEAD.snHalfWidthMm.value, snHeightMm, HEAD.snHalfDepthMm.value],
        p,
      ) <= 1
    ) {
      return 'sustanciaNegra';
    }
    if (dist(p, redNucleusCenter(h, s)) <= HEAD.redNucleusRadiusMm.value) return 'sustanciaNegra';
  }
  if (Math.abs(md[0]) <= 0.5 && Math.abs(md[1]) <= 1 && md[2] < -1 && md[2] > -9) {
    return 'cisterna';
  }
  if (
    Math.abs(md[0]) <= HEAD.peduncleOffsetXmm.value - 1 &&
    Math.abs(md[1]) <= HEAD.peduncleRadiusYmm.value * 0.8 &&
    md[2] > 1 &&
    md[2] < HEAD.peduncleRadiusZmm.value
  ) {
    return 'cisterna';
  }
  return null;
}

/**
 * Crestas óseas de la base del cráneo (N15b) como tubos finos a lo largo de
 * su cresta, no losas: cualquier plano de barrido las corta como una línea
 * o un punto brillante (antes, losas alineadas con los ejes de 3–8 mm de
 * alto contenían casi horizontalmente el plano mesencefálico y se veían como
 * masas saturadas; la M1 atravesaba la losa esfenoidal y su interfaz
 * hueso/sangre saturaba a lo largo del vaso).
 *
 * - Ala esfenoidal (borde posterior del ala menor): de la apófisis clinoides
 *   anterior, lateral a la terminación de la ACI, hacia lateral y anterior
 *   hasta el pterión, ~6 mm por delante e inferior a la M1 (la M1 corre en
 *   la cisterna silviana detrás de la cresta).
 * - Cresta del peñasco: del vértice petroso (junto al clivus, bajo el
 *   mesencéfalo) hacia posterolateral hasta la mastoides, ascendiendo hasta
 *   el nivel del plano mesencefálico en su extremo lateral.
 *
 * Marco paciente absoluto (como el polígono de Willis); `s` = +1 izquierda.
 */
export interface BoneRidge {
  readonly id: 'alaEsfenoidal' | 'penasco';
  readonly side: Side;
  readonly points: readonly Vec3[];
  readonly radiusMm: number;
  readonly aabb: { readonly min: Vec3; readonly max: Vec3 };
}

/** Radio de las crestas óseas, mm. */
export const BONE_RIDGE_RADIUS_MM = 1.2;

function ridge(id: BoneRidge['id'], s: 1 | -1, pts: readonly Vec3[]): BoneRidge {
  const points = pts.map(([x, y, z]) => [s * x, y, z] as Vec3);
  const r = BONE_RIDGE_RADIUS_MM;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const q of points) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, q[k]! - r);
      max[k] = Math.max(max[k]!, q[k]! + r);
    }
  }
  return { id, side: s === 1 ? 'izq' : 'der', points, radiusMm: r, aabb: { min, max } };
}

export const BONE_RIDGES: readonly BoneRidge[] = ([1, -1] as const).flatMap((s) => [
  ridge('alaEsfenoidal', s, [
    [12, 11.5, 2], // apófisis clinoides anterior
    [21, 12, 5],
    [33, 12.2, 10],
    [48, 12.5, 17],
    [56, 12.5, 21], // pterión (tabla interna)
  ]),
  ridge('penasco', s, [
    [14, 5, -4], // vértice petroso, junto al clivus
    [28, 8, -20],
    [42, 11, -36], // eminencia arcuata
    [50, 11, -44], // hacia la mastoides
  ]),
]);

function ridgeContains(r: BoneRidge, p: Vec3): boolean {
  const { min, max } = r.aabb;
  if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1] || p[2] < min[2] || p[2] > max[2]) {
    return false;
  }
  for (let i = 0; i + 1 < r.points.length; i++) {
    if (segDist(p, r.points[i]!, r.points[i + 1]!) <= r.radiusMm) return true;
  }
  return false;
}

function inRidge(p: Vec3, id: BoneRidge['id']): boolean {
  for (const r of BONE_RIDGES) if (r.id === id && ridgeContains(r, p)) return true;
  return false;
}

function isPetrous(_h: HeadGeometry, p: Vec3): boolean {
  return inRidge(p, 'penasco');
}

function isSphenoid(_h: HeadGeometry, p: Vec3): boolean {
  return inRidge(p, 'alaEsfenoidal');
}

export function landmarkAt(h: HeadGeometry, p: Vec3): LandmarkId | null {
  const md = sub(p, h.midbrainCenter);
  const d = sub(p, h.thirdVentricleCenter);
  const snHeightMm =
    (HEAD.snAreaCm2.value * (h.snAreaScale ?? 1) * 100) / (Math.PI * HEAD.snHalfWidthMm.value);
  const width = h.thirdVentricleWidthMm / 2;
  if (
    dist(p, [h.thirdVentricleCenter[0], h.thirdVentricleCenter[1], h.thirdVentricleCenter[2] - 7]) <=
    HEAD.pinealRadiusMm.value
  ) {
    return 'pineal';
  }
  if (
    Math.abs(d[1]) <= HEAD.thirdVentricleHeightMm.value / 2 &&
    Math.abs(d[2]) <= HEAD.thirdVentricleDepthMm.value / 2 &&
    Math.abs(d[0]) <= width
  )
    return 'tercerVentriculo';
  for (const s of [-1, 1] as const) {
    if (
      ellipsoidLevel(
        substantiaNigraCenter(h, s),
        [HEAD.snHalfWidthMm.value, snHeightMm, HEAD.snHalfDepthMm.value],
        p,
      ) <= 1
    )
      return 'sustanciaNegra';
    if (dist(p, redNucleusCenter(h, s)) <= HEAD.redNucleusRadiusMm.value) return 'nucleoRojo';
  }
  if (Math.abs(md[0]) <= 0.5 && Math.abs(md[1]) <= 1 && md[2] < -1 && md[2] > -9) return 'rafe';
  if (
    Math.abs(md[0]) <= HEAD.peduncleOffsetXmm.value - 1 &&
    Math.abs(md[1]) <= HEAD.peduncleRadiusYmm.value * 0.8 &&
    md[2] > 1 &&
    md[2] < HEAD.peduncleRadiusZmm.value
  )
    return 'cisternaInterpeduncular';
  if (butterflyLevel(h, p) <= 1) return 'mesencefalo';
  const hornScale = h.frontalHornScale;
  for (const s of [-1, 1] as const) {
    const horn: Vec3 = [
      h.thirdVentricleCenter[0] + s * HEAD.frontalHornCenterXmm.value,
      h.thirdVentricleCenter[1],
      h.thirdVentricleCenter[2] + HEAD.frontalHornCenterZmm.value,
    ];
    if (
      ellipsoidLevel(
        horn,
        [
          HEAD.frontalHornRadiusXmm.value * hornScale,
          HEAD.frontalHornRadiusYmm.value * hornScale,
          HEAD.frontalHornRadiusZmm.value * hornScale,
        ],
        p,
      ) <= 1
    )
      return 'cuernoFrontal';
    const thalamus: Vec3 = [
      h.thirdVentricleCenter[0] + s * HEAD.thalamusCenterXmm.value,
      h.thirdVentricleCenter[1],
      h.thirdVentricleCenter[2],
    ];
    if (
      ellipsoidLevel(
        thalamus,
        [HEAD.thalamusRadiusXmm.value, HEAD.thalamusRadiusYmm.value, HEAD.thalamusRadiusZmm.value],
        p,
      ) <= 1
    )
      return 'talamo';
  }
  if (isSphenoid(h, p)) return 'alaEsfenoidal';
  if (isPetrous(h, p)) return 'penasco';
  if (classifyHead(h, p) === 'hueso') return 'craneoContralateral';
  return null;
}

export function materialAtHead(h: HeadGeometry, p: Vec3) {
  return MATERIALS[classifyHead(h, p)];
}

/** Vaso dominante en un punto (el más cercano cuyo tubo lo contiene). */
export function vesselAt(scene: VesselScene, p: Vec3): Vessel | null {
  for (const v of scene.vessels) {
    if (vesselContains(v, p)) return v;
  }
  return null;
}
