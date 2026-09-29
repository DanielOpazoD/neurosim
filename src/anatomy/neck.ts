/**
 * Escena submandibular del Doppler transcraneal (DEC-58): región cervical
 * alta bajo el ángulo mandibular, insonada con la sonda sectorial de 2 MHz
 * angulada en sentido craneal para medir la ACI extracraneal distal
 * (denominador medido del índice de Lindegaard).
 *
 * Marco del paciente de la cabeza (mm, levógiro): +x izquierda, +y superior,
 * +z anterior. La geometría se describe en un marco local por lado anclado
 * en el punto cutáneo submandibular: `d` a lo largo del haz por defecto
 * (craneal y ~30° posterior), `lat` hacia lateral del paciente y `ant` hacia
 * anterior, ambos ortogonales al haz. El plano de imagen por defecto es
 * (d, lat): la ACI corre casi a lo largo del haz (ángulo de insonación
 * pequeño), la ACE queda medial y algo anterior con ramas, la vena yugular
 * interna lateral y la rama mandibular (hueso) más lateral aún.
 *
 * Pura: sin dependencias de ultrasonido ni de fisiología (el caudal de la
 * ACI se deriva de los vasos de Willis ya construidos).
 *
 * LIM-29: tubos de radio constante, piel plana, sin compresión venosa ni
 * modulación respiratoria de la yugular, ACE con onda fija.
 */
import type { MaterialId } from './materials';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../core/vec3';
import type { Side } from '../domain/contracts';
import { vesselContains, type Vessel, type VesselScene } from './head';
import { smoothPolyline } from './willis';

/** Factor de `velocityForFlow` (Willis): Q[ml/min] = v̄[cm/s]·π·r²·0,6. */
const FLOW_FACTOR = 0.6;

/**
 * Radio de la ACI cervical distal, mm. Con el caudal de Willis (M1+A1+AComP ≈
 * 326 ml/min) y la misma relación Q = v̄·πr²·0,6, 2,2 mm da TAMax ≈ 36 cm/s y
 * PSV/EDV ≈ 58/23 cm/s (objetivo 35–45 y ≈60/25). Un radio de 2,6 mm daría
 * ≈26 cm/s y un Lindegaard normal > 2 (DEC-58).
 */
export const NECK_ICA_RADIUS_MM = 2.2;
export const NECK_ECA_RADIUS_MM = 1.8;
export const NECK_IJV_RADIUS_MM = 4.5;
/** Velocidad media estacionaria de la yugular interna, cm/s. */
export const NECK_IJV_MEAN_CMS = 20;
/** PSV / EDV de la ACE (alta resistencia), cm/s. */
export const NECK_ECA_PSV_CMS = 75;
export const NECK_ECA_EDV_CMS = 8;
/**
 * Media de la onda de alta resistencia `highResistanceShape` (physiology/flow):
 * v̄ = EDV + (PSV − EDV)·0,157 (comprobado en tests/neck.test.ts).
 */
export const HIGH_RESISTANCE_SHAPE_MEAN = 0.157;
/** Piel y tejido subcutáneo bajo la sonda, mm. */
export const NECK_SKIN_MM = 1.5;
export const NECK_SUBCUTANEOUS_MM = 4;

/** Marco local submandibular (unitarios, ortonormales). */
export interface NeckFrame {
  /** Punto cutáneo submandibular (lateral al hioides, bajo el ángulo). */
  readonly origin: Vec3;
  /** Haz por defecto: craneal y ~30° posterior, algo medial. */
  readonly beam: Vec3;
  /** Lateral del paciente, ⟂ al haz. */
  readonly lateral: Vec3;
  /** Anterior, ⟂ al haz y a `lateral`. */
  readonly anterior: Vec3;
}

export interface NeckGeometry extends VesselScene {
  readonly side: Side;
  readonly frame: NeckFrame;
  /** Glándula submandibular: elipsoide alineado con el marco local (d, lat, ant). */
  readonly gland: { readonly center: Vec3; readonly radii: Vec3 };
  /** Vientre posterior del digástrico: cápsula entre dos puntos locales. */
  readonly digastric: { readonly a: Vec3; readonly b: Vec3; readonly radiusMm: number };
  readonly vessels: readonly Vessel[];
}

/** Punto cutáneo submandibular por lado (patient frame). */
function neckOrigin(side: Side): Vec3 {
  const s = side === 'izq' ? 1 : -1;
  return [s * 36, -74, 12];
}

export function neckFrame(side: Side): NeckFrame {
  const s = side === 'izq' ? 1 : -1;
  const origin = neckOrigin(side);
  // 30° desde la vertical hacia la base del cráneo (posterior), algo medial.
  const beam = normalize([-s * 0.08, Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)]);
  const z: Vec3 = [0, 0, 1];
  const anterior = normalize(sub(z, scale(beam, dot(z, beam))));
  const lateral = normalize(cross(beam, anterior));
  // cross(haz, anterior) apunta a +x; en el lado derecho el lateral es −x.
  return { origin, beam, anterior, lateral: s === 1 ? lateral : scale(lateral, -1) };
}

/** Coordenadas locales (d, lat, ant) de un punto del paciente. */
export function neckLocal(frame: NeckFrame, p: Vec3): Vec3 {
  const r = sub(p, frame.origin);
  return [dot(r, frame.beam), dot(r, frame.lateral), dot(r, frame.anterior)];
}

/** Punto del paciente desde coordenadas locales (d, lat, ant). */
export function neckPoint(frame: NeckFrame, d: number, lat: number, ant: number): Vec3 {
  return add(
    frame.origin,
    add(scale(frame.beam, d), add(scale(frame.lateral, lat), scale(frame.anterior, ant))),
  );
}

function aabbOf(points: readonly Vec3[], pad: number): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i]! - pad < min[i]!) min[i] = p[i]! - pad;
      if (p[i]! + pad > max[i]!) max[i] = p[i]! + pad;
    }
  }
  return { min, max };
}

function mkVessel(
  id: string,
  side: Side,
  controlPoints: readonly Vec3[],
  radiusMm: number,
  meanCms: number,
  psvCms: number,
  edvCms: number,
  extra: Partial<Pick<Vessel, 'venous' | 'waveform'>> = {},
): Vessel {
  const points = smoothPolyline(controlPoints, 1);
  return {
    id,
    side,
    points,
    controlPoints,
    radiusMm,
    aabb: aabbOf(points, radiusMm),
    flowSign: 1,
    flowMlMin: meanCms * Math.PI * radiusMm * radiusMm * FLOW_FACTOR,
    meanCms,
    psvCms,
    edvCms,
    ...extra,
  };
}

/**
 * Caudal de la ACI de un lado = M1 + A1 + AComP ipsilaterales (igual que el
 * sifón `ica-*` de `buildWillisVessels`), ml/min.
 */
export function neckIcaFlowMlMin(headVessels: readonly Vessel[], side: Side): number {
  const q = (id: string) => headVessels.find((v) => v.id === id)?.flowMlMin ?? 0;
  return q(`m1-${side}`) + q(`a1-${side}`) + q(`pcoa-${side}`);
}

/**
 * Vasos cervicales de un lado: ACI distal (baja resistencia, caudal de Willis),
 * ACE con ramas facial y lingual (alta resistencia) y vena yugular interna
 * (venosa, hacia el corazón). Los puntos siguen el sentido del flujo.
 */
function buildNeckVessels(frame: NeckFrame, side: Side, headVessels: readonly Vessel[]): Vessel[] {
  const s = side === 'izq' ? 1 : -1;
  const L = (d: number, lat: number, ant: number): Vec3 => neckPoint(frame, d, lat, ant);
  // PSV/EDV de la ACI escalados desde la M1 ipsilateral (misma forma de onda).
  const m1 = headVessels.find((v) => v.id === `m1-${side}`);
  const icaQ = neckIcaFlowMlMin(headVessels, side);
  const icaMean = icaQ / (Math.PI * NECK_ICA_RADIUS_MM * NECK_ICA_RADIUS_MM * FLOW_FACTOR);
  const k = m1 && m1.meanCms > 0 ? icaMean / m1.meanCms : 0.65;
  const icaPsv = (m1?.psvCms ?? 90) * k;
  const icaEdv = (m1?.edvCms ?? 35) * k;
  // ACI: entra al plano por detrás, sube casi a lo largo del haz cruzando la
  // línea central a ~45 mm y gira hacia el conducto carotídeo; el tramo
  // petroso apunta al inicio del sifón intracraneal (s·9, −4, −10).
  const ica = mkVessel(
    `aci-${side}`,
    side,
    [
      L(6, 5, -6),
      L(15, 3.5, -1),
      L(30, 1.8, 0),
      L(45, 0, 0),
      L(60, -1.8, 0),
      L(72, -3.5, -1.5),
      L(82, -4, -5),
      [s * 18, -4.5, -24],
      [s * 11, -4.2, -13],
    ],
    NECK_ICA_RADIUS_MM,
    icaMean,
    icaPsv,
    icaEdv,
    { waveform: 'baja' },
  );
  const ecaMean = NECK_ECA_EDV_CMS + (NECK_ECA_PSV_CMS - NECK_ECA_EDV_CMS) * HIGH_RESISTANCE_SHAPE_MEAN;
  const eca = mkVessel(
    `ace-${side}`,
    side,
    [L(7, -2.5, 5), L(12, -4.5, 3.5), L(18, -6.5, 3), L(30, -10, 2.5), L(45, -13, 3), L(60, -15, 6)],
    NECK_ECA_RADIUS_MM,
    ecaMean,
    NECK_ECA_PSV_CMS,
    NECK_ECA_EDV_CMS,
    { waveform: 'alta' },
  );
  const branchPsv = 50;
  const branchEdv = 5;
  const branchMean = branchEdv + (branchPsv - branchEdv) * HIGH_RESISTANCE_SHAPE_MEAN;
  const facial = mkVessel(
    `ace-facial-${side}`,
    side,
    [L(18, -6.5, 3), L(22, -11, 9), L(26, -15, 17)],
    1.1,
    branchMean,
    branchPsv,
    branchEdv,
    { waveform: 'alta' },
  );
  const lingual = mkVessel(
    `ace-lingual-${side}`,
    side,
    [L(12, -4.5, 3.5), L(15, -11, 6), L(17, -18, 9)],
    1.0,
    branchMean,
    branchPsv,
    branchEdv,
    { waveform: 'alta' },
  );
  // Yugular interna: lateral y algo anterior a la ACI, grande; flujo caudal
  // (hacia la sonda), estacionario (~20 cm/s).
  const ijv = mkVessel(
    `vyi-${side}`,
    side,
    [L(85, 8, -3), L(65, 10, 1.5), L(45, 10.5, 3.5), L(28, 10, 4), L(14, 9.5, 7), L(8, 9, 12)],
    NECK_IJV_RADIUS_MM,
    NECK_IJV_MEAN_CMS,
    NECK_IJV_MEAN_CMS,
    NECK_IJV_MEAN_CMS,
    { venous: true },
  );
  return [ica, eca, facial, lingual, ijv];
}

/** Escena submandibular de un lado; `headVessels` aporta el caudal de la ACI. */
export function buildReferenceNeck(side: Side, headVessels: readonly Vessel[]): NeckGeometry {
  const frame = neckFrame(side);
  const neck: Omit<NeckGeometry, 'classify'> = {
    side,
    frame,
    gland: { center: [16, -9, 3], radii: [8, 12, 11] },
    digastric: { a: [4.5, -18, 2], b: [11, 18, -2], radiusMm: 2.5 },
    vessels: buildNeckVessels(frame, side, headVessels),
  };
  const full: NeckGeometry = { ...neck, classify: (p: Vec3) => classifyNeck(full, p) };
  return full;
}

export function buildReferenceNecks(headVessels: readonly Vessel[]): Record<Side, NeckGeometry> {
  return { der: buildReferenceNeck('der', headVessels), izq: buildReferenceNeck('izq', headVessels) };
}

/** Distancia de q al segmento ab (coordenadas locales). */
function segDistLocal(q: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(q, a), ab) / Math.max(1e-9, dot(ab, ab))));
  const c = add(a, scale(ab, t));
  return Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]);
}

/**
 * Rama y ángulo mandibular (hueso) en coordenadas locales: lámina lateral al
 * haz, ~8 mm de espesor efectivo para los rayos oblicuos (sombra acústica
 * en el borde lateral del sector).
 */
export function inMandible(local: Vec3): boolean {
  const [d, lat, ant] = local;
  const inner = 19 - 0.05 * d;
  return d >= 3 && d <= 95 && lat >= inner && lat <= inner + 8 && ant >= -14 && ant <= 26;
}

/** Milohioideo: lámina muscular medial que se hunde con la profundidad. */
function inMylohyoid(local: Vec3): boolean {
  const [d, lat, ant] = local;
  const outer = -17 - 0.25 * d;
  return d >= 6 && d <= 35 && lat <= outer && lat >= outer - 3 && Math.abs(ant) <= 20;
}

/**
 * Clasifica un punto de la escena submandibular. Orden: fuera de la piel
 * (gel/aire) → piel → subcutáneo → hueso mandibular → vasos → glándula →
 * músculos (digástrico, milohioideo) → tejido cervical de fondo.
 */
export function classifyNeck(
  n: Pick<NeckGeometry, 'frame' | 'gland' | 'digastric' | 'vessels'>,
  p: Vec3,
): MaterialId {
  const local = neckLocal(n.frame, p);
  const d = local[0];
  if (d < 0) return d > -3 ? 'gel' : 'aire';
  if (d < NECK_SKIN_MM) return 'piel';
  if (d < NECK_SUBCUTANEOUS_MM) return 'grasaSubcutanea';
  if (inMandible(local)) return 'hueso';
  for (const v of n.vessels) {
    if (vesselContains(v, p)) return 'vaso';
  }
  const g = n.gland;
  const gl = Math.hypot(
    (local[0] - g.center[0]) / g.radii[0],
    (local[1] - g.center[1]) / g.radii[1],
    (local[2] - g.center[2]) / g.radii[2],
  );
  if (gl <= 1) return 'glandulaSubmandibular';
  if (segDistLocal(local, n.digastric.a, n.digastric.b) <= n.digastric.radiusMm) return 'musculoCervical';
  if (inMylohyoid(local)) return 'musculoCervical';
  return 'tejidoCervical';
}
