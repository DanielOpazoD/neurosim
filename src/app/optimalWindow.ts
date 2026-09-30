/**
 * «Ventana óptima» (DEC-60): resuelve la adquisición ideal para la estación,
 * el lado y el caso actuales — posición/inclinación de la sonda y ajustes del
 * equipo — como punto de partida para medir. Módulo puro (sin DOM), con caché
 * por (geometría del caso, estación, lado, plano).
 *
 * - Ojo (vaina): plano transversal (rot 0) o sagital (rot 90, si el protocolo
 *   DVNO espera el sagital), inclinación/angulación 0 y desplazamientos que
 *   centran el nervio a 3 mm retroglobo en la línea central de la imagen y en
 *   el plano (Newton 2×2 con jacobiano numérico, ≤ 5 pasos). Profundidad
 *   45 mm, foco a la profundidad del nervio.
 * - Temporal: plano mesencefálico con la M1 ipsilateral más larga en el plano:
 *   rejilla gruesa (inclinación ±10° cada 2,5°, desplazamientos ±6 mm cada
 *   3 mm) + ascenso local
 *   en los pasos de los deslizadores, maximizando la longitud de M1 a ≤ 1 mm
 *   del plano y dentro del sector, menos 0,3 mm por grado de inclinación y
 *   por mm de desplazamiento vertical (preferencia por el plano canónico,
 *   `temporalPoseScore`). Profundidad 90 mm, color con la caja
 *   centrada en M1 y puerta PW en el punto de M1 con menor ángulo de
 *   insonación (el PW no se enciende).
 * - Submandibular: mínimo ángulo de insonación a la ACI ipsilateral con
 *   ≥ 10 mm de ACI en el plano; color y puerta sobre la ACI.
 */
import { fromEyeLocal, nerveCenterline } from '../anatomy/eye';
import { vesselFlowDir, type Vessel, type VesselScene } from '../anatomy/head';
import { dot, normalize, sub, type Vec3 } from '../core/vec3';
import type { ColorBox, ProbePose, Side, Station } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import { insonationAngles } from '../doppler/insonation';
import {
  beamDirAt,
  elevAxis,
  imageToPatient,
  patientToImage,
  SECTOR_HALF_ANGLE_RAD,
} from '../ultrasound/probe';
import { stationPose, type PoseInput } from './poses';
import { dopplerSceneFor } from './renderRequest';

export type OnsdPlaneTarget = 'transversal' | 'sagital';

/** Controles de la sonda que fija el botón (los mismos de `AppState`). */
export interface ProbeParams {
  readonly offsetMm: number;
  readonly offsetVMm: number;
  readonly tiltDeg: number;
  readonly tiltVDeg: number;
  readonly rotDeg: number;
  readonly press: number;
}

export interface OptimalWindowMetrics {
  /** Ojo: posición lateral del nervio (3 mm) en la imagen y distancia al plano, mm. */
  readonly nerveImageUMm?: number;
  readonly nerveElevationMm?: number;
  /** Vaso objetivo (M1/ACI): longitud en el plano (±1 mm, dentro del sector), mm. */
  readonly inPlaneLengthMm?: number;
  /** Ángulo real de insonación en la puerta (como `PwController.insonation`), °. */
  readonly insonationDeg?: number;
  readonly vesselId?: string | null;
  /** Poses evaluadas y tiempo de cálculo (sin caché), ms. */
  readonly evaluations: number;
  readonly solveMs: number;
}

export interface OptimalWindow {
  readonly station: Station;
  readonly side: Side;
  readonly plane?: OnsdPlaneTarget;
  readonly probe: ProbeParams;
  readonly depthMm: number;
  readonly focusMm: number;
  readonly colorOn: boolean;
  readonly colorBox: ColorBox | null;
  /** Puerta PW en coordenadas de imagen (u en rad para el sector); null en el ojo. */
  readonly gate: { readonly depthMm: number; readonly uMm: number } | null;
  readonly metrics: OptimalWindowMetrics;
}

export interface OptimalWindowOptions {
  /** Ojo: plano pedido (el siguiente hueco del protocolo DVNO). */
  readonly plane?: OnsdPlaneTarget;
}

/** Tolerancia del plano para contar longitud de vaso, mm. */
export const IN_PLANE_TOL_MM = 1;
/** Rangos de búsqueda (grados / mm) y pasos de los deslizadores. */
const TCD_TILT_RANGE = 10;
const TCD_OFFSET_RANGE = 6;
/** Coste de alejarse del plano mesencefálico: mm de M1 por grado de inclinación / mm de desplazamiento vertical. */
export const TCD_CANONICAL_PENALTY_MM = 0.3;
const TILT_STEP = 1;
const OFFSET_STEP = 0.5;
const DEFAULT_PRESS = 0.3;
const FOCUS_RANGE = [5, 60] as const;
const EYE_DEPTH_MM = 45;
const TEMPORAL_DEPTH_MM = 90;
const SUBMANDIBULAR_DEPTH_MM = 70;
/** Muestras de los extremos del vaso excluidas de la puerta (bifurcaciones), mm. */
const GATE_END_MARGIN_MM = 3;

const cache = new WeakMap<object, Map<string, OptimalWindow>>();

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Resuelve (o devuelve de la caché) la ventana óptima de la estación. */
export function solveOptimalWindow(
  sim: ReferenceCase,
  station: Station,
  side: Side,
  opts: OptimalWindowOptions = {},
): OptimalWindow {
  const plane = station === 'ojo' ? (opts.plane ?? 'transversal') : undefined;
  // Clave por objeto de geometría: `setPhysiology` reconstruye los ojos.
  const geometry: object =
    station === 'ojo' ? sim.eyes[side] : station === 'submandibular' ? sim.neck[side] : sim.head;
  const key = `${sim.clinicalCase.id}|${sim.willisVariant}|${station}|${side}|${plane ?? ''}`;
  let perGeometry = cache.get(geometry);
  if (!perGeometry) {
    perGeometry = new Map();
    cache.set(geometry, perGeometry);
  }
  const hit = perGeometry.get(key);
  if (hit) return hit;
  const t0 = now();
  const partial =
    station === 'ojo'
      ? solveEye(sim, side, plane!)
      : station === 'temporal'
        ? solveTemporal(sim, side)
        : solveSubmandibular(sim, side);
  const result: OptimalWindow = {
    ...partial,
    metrics: { ...partial.metrics, solveMs: now() - t0 },
  };
  perGeometry.set(key, result);
  return result;
}

/** Vacía la caché de una geometría (tests de tiempo sin caché). */
export function clearOptimalWindowCache(sim: ReferenceCase): void {
  for (const g of [sim.eyes.der, sim.eyes.izq, sim.head, sim.neck.der, sim.neck.izq]) cache.delete(g);
}

function poseFor(sim: ReferenceCase, station: Station, side: Side, p: ProbeParams): ProbePose {
  const input: PoseInput = { side, station, ...p };
  return stationPose(sim, input, side);
}

type SolvedPart = Omit<OptimalWindow, 'metrics'> & { metrics: Omit<OptimalWindowMetrics, 'solveMs'> };

// ── Ojo ──────────────────────────────────────────────────────────────────

/** Punto del nervio a 3 mm retroglobo en el marco del paciente. */
export function eyeNerveTarget(sim: ReferenceCase, side: Side): Vec3 {
  const eye = sim.eyes[side];
  return fromEyeLocal(eye, nerveCenterline(eye, 3));
}

function solveEye(sim: ReferenceCase, side: Side, plane: OnsdPlaneTarget): SolvedPart {
  const target = eyeNerveTarget(sim, side);
  const rotDeg = plane === 'sagital' ? 90 : 0;
  let off: [number, number] = [0, 0];
  let evaluations = 0;
  const residual = (o: [number, number]): [number, number] => {
    evaluations += 1;
    const pose = poseFor(sim, 'ojo', side, {
      offsetMm: o[0],
      offsetVMm: o[1],
      tiltDeg: 0,
      tiltVDeg: 0,
      rotDeg,
      press: DEFAULT_PRESS,
    });
    const rel = sub(target, pose.origin);
    return [patientToImage(pose, 'linear', target).u, dot(rel, elevAxis(pose))];
  };
  const h = 0.5;
  for (let iter = 0; iter < 5; iter++) {
    const r = residual(off);
    if (Math.abs(r[0]) < 1e-3 && Math.abs(r[1]) < 1e-3) break;
    const ra = residual([off[0] + h, off[1]]);
    const rb = residual([off[0], off[1] + h]);
    const j = [
      [(ra[0] - r[0]) / h, (rb[0] - r[0]) / h],
      [(ra[1] - r[1]) / h, (rb[1] - r[1]) / h],
    ];
    const det = j[0]![0]! * j[1]![1]! - j[0]![1]! * j[1]![0]!;
    if (Math.abs(det) < 1e-9) break;
    const d0 = (j[1]![1]! * r[0] - j[0]![1]! * r[1]) / det;
    const d1 = (-j[1]![0]! * r[0] + j[0]![0]! * r[1]) / det;
    off = [clamp(off[0] - d0, -18, 18), clamp(off[1] - d1, -20, 20)];
  }
  // Décimas de mm: el rótulo del deslizador muestra el valor exacto.
  off = [Math.round(off[0] * 10) / 10, Math.round(off[1] * 10) / 10];
  const probe: ProbeParams = {
    offsetMm: off[0],
    offsetVMm: off[1],
    tiltDeg: 0,
    tiltVDeg: 0,
    rotDeg,
    press: DEFAULT_PRESS,
  };
  const pose = poseFor(sim, 'ojo', side, probe);
  const img = patientToImage(pose, 'linear', target);
  return {
    station: 'ojo',
    side,
    plane,
    probe,
    depthMm: EYE_DEPTH_MM,
    focusMm: clamp(Math.round(img.z), FOCUS_RANGE[0], FOCUS_RANGE[1]),
    colorOn: false,
    colorBox: null,
    gate: null,
    metrics: {
      nerveImageUMm: img.u,
      nerveElevationMm: dot(sub(target, pose.origin), elevAxis(pose)),
      evaluations,
    },
  };
}

// ── Vasos (temporal / submandibular) ─────────────────────────────────────

/** Muestra de la línea central: punto medio de un segmento, su longitud y su arco. */
interface VesselSample {
  readonly p: Vec3;
  readonly w: number;
  readonly s: number;
  /** Dirección del flujo en la muestra (`vesselFlowDir`, precalculada). */
  readonly flow: Vec3;
}

function vesselSamples(v: Vessel): VesselSample[] {
  const out: VesselSample[] = [];
  let s = 0;
  for (let i = 0; i + 1 < v.points.length; i++) {
    const a = v.points[i]!;
    const b = v.points[i + 1]!;
    const w = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    // Subdivisión a ≤ 0,5 mm para contar la longitud dentro del plano.
    const n = Math.max(1, Math.ceil(w / 0.5));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      out.push({ p, w: w / n, s: s + w * t, flow: normalize(vesselFlowDir(v, p)) });
    }
    s += w;
  }
  return out;
}

interface PlaneEval {
  readonly lengthMm: number;
  /** Muestras en el plano y dentro del sector (índices en `samples`). */
  readonly inside: number[];
}

/** Longitud del vaso a ≤ `IN_PLANE_TOL_MM` del plano y dentro del sector. */
function evalPlane(pose: ProbePose, samples: readonly VesselSample[], depthMm: number): PlaneEval {
  const n = elevAxis(pose);
  const fwd = normalize(pose.forward);
  const lat = pose.lateral;
  const o = pose.origin;
  let lengthMm = 0;
  const inside: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const q = samples[i]!.p;
    const rx = q[0] - o[0];
    const ry = q[1] - o[1];
    const rz = q[2] - o[2];
    if (Math.abs(rx * n[0] + ry * n[1] + rz * n[2]) > IN_PLANE_TOL_MM) continue;
    const z = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
    const x = rx * lat[0] + ry * lat[1] + rz * lat[2];
    if (z <= 0 || Math.abs(Math.atan2(x, z)) > SECTOR_HALF_ANGLE_RAD || Math.hypot(x, z) > depthMm) continue;
    lengthMm += samples[i]!.w;
    inside.push(i);
  }
  return { lengthMm, inside };
}

/** Ángulo real (°) entre el haz hacia la muestra y el flujo del vaso en ella. */
function beamAngleDeg(pose: ProbePose, sample: VesselSample): number {
  const beam = normalize(sub(sample.p, pose.origin));
  return (Math.acos(Math.min(1, Math.abs(dot(beam, sample.flow)))) * 180) / Math.PI;
}

interface GatePick {
  readonly depthMm: number;
  readonly uMm: number;
  readonly insonationDeg: number;
  readonly vesselId: string | null;
}

/**
 * Puerta en el punto del vaso (en el plano) con menor ángulo de insonación,
 * comprobado con la misma función que `PwController.insonation`: el vaso
 * dominante en el centro de la puerta debe ser el objetivo.
 */
function pickGate(
  pose: ProbePose,
  vessel: Vessel,
  scene: VesselScene,
  samples: readonly VesselSample[],
  inside: readonly number[],
): GatePick | null {
  const total = samples.length ? samples[samples.length - 1]!.s : 0;
  const candidates = inside
    .filter((i) => samples[i]!.s >= GATE_END_MARGIN_MM && samples[i]!.s <= total - GATE_END_MARGIN_MM)
    .map((i) => ({ i, angle: beamAngleDeg(pose, samples[i]!) }))
    .sort((a, b) => a.angle - b.angle);
  const lateral = pose.lateral;
  const elevation = elevAxis(pose);
  for (const c of candidates.slice(0, 24)) {
    const img = patientToImage(pose, 'sector', samples[c.i]!.p);
    const center = imageToPatient(pose, 'sector', img.u, img.z);
    const beamDir = beamDirAt(pose, 'sector', img.u);
    const ins = insonationAngles(scene, center, beamDir, lateral, elevation);
    if (ins.vesselId === vessel.id) {
      return { depthMm: img.z, uMm: img.u, insonationDeg: ins.realDeg, vesselId: ins.vesselId };
    }
  }
  return null;
}

/** Caja de color que abarca las muestras del vaso en el plano (+ margen). */
function colorBoxFor(
  pose: ProbePose,
  samples: readonly VesselSample[],
  inside: readonly number[],
  depthMm: number,
): ColorBox {
  const us: number[] = [];
  const zs: number[] = [];
  for (const i of inside) {
    const img = patientToImage(pose, 'sector', samples[i]!.p);
    us.push(img.u);
    zs.push(img.z);
  }
  const deg = Math.PI / 180;
  const uMin = Math.min(...us);
  const uMax = Math.max(...us);
  const uHalf = clamp((uMax - uMin) / 2 + 5 * deg, 10 * deg, 25 * deg);
  const uCenter = clamp((uMin + uMax) / 2, -SECTOR_HALF_ANGLE_RAD + uHalf, SECTOR_HALF_ANGLE_RAD - uHalf);
  const zMin = Math.max(5, Math.min(...zs) - 8);
  const zMax = Math.min(depthMm - 1, Math.max(...zs) + 8);
  return { uCenter, uHalf, zMinMm: zMin, zMaxMm: Math.max(zMin + 10, zMax) };
}

/** Rejilla de valores [−range, range] con paso `step`. */
function grid(range: number, step: number): number[] {
  const out: number[] = [];
  for (let v = -range; v <= range + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

type Params3 = readonly [number, number, number];

/**
 * Rejilla gruesa + ascenso local en los pasos de los deslizadores (vecinos
 * ±1 paso por eje) hasta que no mejora. `score` mayor es mejor.
 */
function searchDiscrete(
  coarse: readonly [number[], number[], number[]],
  steps: Params3,
  bounds: Params3,
  score: (p: Params3) => number,
): { best: Params3; value: number; evaluations: number } {
  let evaluations = 0;
  const seen = new Map<string, number>();
  const f = (p: Params3): number => {
    const k = p.join(',');
    const cached = seen.get(k);
    if (cached !== undefined) return cached;
    evaluations += 1;
    const v = score(p);
    seen.set(k, v);
    return v;
  };
  let best: Params3 = [0, 0, 0];
  let value = f(best);
  for (const a of coarse[0]) {
    for (const b of coarse[1]) {
      for (const c of coarse[2]) {
        const v = f([a, b, c]);
        if (v > value + 1e-9) {
          value = v;
          best = [a, b, c];
        }
      }
    }
  }
  for (let guard = 0; guard < 200; guard++) {
    let improved = false;
    for (let axis = 0; axis < 3; axis++) {
      for (const dir of [-1, 1]) {
        const next = [...best] as [number, number, number];
        next[axis] = Math.round((next[axis]! + dir * steps[axis]!) * 1000) / 1000;
        if (Math.abs(next[axis]!) > bounds[axis]! + 1e-9) continue;
        const v = f(next);
        if (v > value + 1e-9) {
          value = v;
          best = next;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return { best, value, evaluations };
}

function findVessel(scene: VesselScene, id: string): Vessel {
  const v = scene.vessels.find((x) => x.id === id);
  if (!v) throw new Error(`optimalWindow: falta el vaso ${id}`);
  return v;
}

/**
 * Objetivo temporal: longitud de M1 en el plano con preferencia por el plano
 * mesencefálico canónico (N15b, DEC-60): cada grado de inclinación y cada mm
 * de desplazamiento vertical cuestan `TCD_CANONICAL_PENALTY_MM` de M1, así
 * que con visibilidad parecida la pose queda cerca del plano estándar (la
 * mariposa mesencefálica sigue en el plano). Desempate suave hacia la sonda
 * centrada en la ventana.
 */
export function temporalPoseScore(
  m1LengthMm: number,
  p: Pick<ProbeParams, 'tiltDeg' | 'offsetMm' | 'offsetVMm'>,
): number {
  return (
    m1LengthMm -
    TCD_CANONICAL_PENALTY_MM * (Math.abs(p.tiltDeg) + Math.abs(p.offsetVMm)) -
    1e-3 * (Math.abs(p.offsetMm) + Math.abs(p.offsetVMm))
  );
}

function solveTemporal(sim: ReferenceCase, side: Side): SolvedPart {
  const scene = dopplerSceneFor(sim, 'temporal', side);
  const m1 = findVessel(scene, `m1-${side}`);
  const samples = vesselSamples(m1);
  const params = (p: Params3): ProbeParams => ({
    tiltDeg: p[0],
    offsetMm: p[1],
    offsetVMm: p[2],
    tiltVDeg: 0,
    rotDeg: 0,
    press: DEFAULT_PRESS,
  });
  const search = searchDiscrete(
    [grid(TCD_TILT_RANGE, 2.5), grid(TCD_OFFSET_RANGE, 3), grid(TCD_OFFSET_RANGE, 3)],
    [TILT_STEP, OFFSET_STEP, OFFSET_STEP],
    [TCD_TILT_RANGE, TCD_OFFSET_RANGE, TCD_OFFSET_RANGE],
    (p) => {
      const ev = evalPlane(poseFor(sim, 'temporal', side, params(p)), samples, TEMPORAL_DEPTH_MM);
      return temporalPoseScore(ev.lengthMm, params(p));
    },
  );
  const probe = params(search.best);
  const pose = poseFor(sim, 'temporal', side, probe);
  const ev = evalPlane(pose, samples, TEMPORAL_DEPTH_MM);
  const gate = pickGate(pose, m1, scene, samples, ev.inside);
  return {
    station: 'temporal',
    side,
    probe,
    depthMm: TEMPORAL_DEPTH_MM,
    focusMm: clamp(Math.round(gate?.depthMm ?? 50), FOCUS_RANGE[0], FOCUS_RANGE[1]),
    colorOn: true,
    colorBox: ev.inside.length ? colorBoxFor(pose, samples, ev.inside, TEMPORAL_DEPTH_MM) : null,
    gate: gate ? { depthMm: gate.depthMm, uMm: gate.uMm } : null,
    metrics: {
      inPlaneLengthMm: ev.lengthMm,
      insonationDeg: gate?.insonationDeg,
      vesselId: gate?.vesselId ?? null,
      evaluations: search.evaluations,
    },
  };
}

/** Longitud mínima de ACI en el plano para aceptar un plano, mm. */
export const SUBMANDIBULAR_MIN_ICA_MM = 10;

function solveSubmandibular(sim: ReferenceCase, side: Side): SolvedPart {
  const scene = dopplerSceneFor(sim, 'submandibular', side);
  const ica = findVessel(scene, `aci-${side}`);
  const samples = vesselSamples(ica);
  const total = samples.length ? samples[samples.length - 1]!.s : 0;
  // Sin angulación (tiltV): gira el haz dentro del plano sin girar el
  // lateral de la pose, y la puerta en coordenadas de imagen dejaría de caer
  // sobre el vaso; inclinación + desplazamientos bastan.
  const params = (p: Params3): ProbeParams => ({
    tiltDeg: p[0],
    offsetMm: p[1],
    offsetVMm: p[2],
    tiltVDeg: 0,
    rotDeg: 0,
    press: DEFAULT_PRESS,
  });
  const search = searchDiscrete(
    [grid(12, 4), grid(TCD_OFFSET_RANGE, 3), grid(TCD_OFFSET_RANGE, 3)],
    [TILT_STEP, OFFSET_STEP, OFFSET_STEP],
    [12, TCD_OFFSET_RANGE, TCD_OFFSET_RANGE],
    (p) => {
      const pose = poseFor(sim, 'submandibular', side, params(p));
      const ev = evalPlane(pose, samples, SUBMANDIBULAR_DEPTH_MM);
      if (ev.lengthMm < SUBMANDIBULAR_MIN_ICA_MM) return -1000 + ev.lengthMm;
      let best = 90;
      for (const i of ev.inside) {
        const sm = samples[i]!;
        if (sm.s < GATE_END_MARGIN_MM || sm.s > total - GATE_END_MARGIN_MM) continue;
        best = Math.min(best, beamAngleDeg(pose, sm));
      }
      // Menor ángulo; a igualdad, más ACI en el plano.
      return -best + 1e-3 * ev.lengthMm;
    },
  );
  const probe = params(search.best);
  const pose = poseFor(sim, 'submandibular', side, probe);
  const ev = evalPlane(pose, samples, SUBMANDIBULAR_DEPTH_MM);
  const gate = pickGate(pose, ica, scene, samples, ev.inside);
  const depthMm =
    gate && gate.depthMm > SUBMANDIBULAR_DEPTH_MM - 10
      ? Math.min(120, Math.ceil((gate.depthMm + 15) / 5) * 5)
      : SUBMANDIBULAR_DEPTH_MM;
  return {
    station: 'submandibular',
    side,
    probe,
    depthMm,
    focusMm: clamp(Math.round(gate?.depthMm ?? 45), FOCUS_RANGE[0], FOCUS_RANGE[1]),
    colorOn: true,
    colorBox: ev.inside.length ? colorBoxFor(pose, samples, ev.inside, depthMm) : null,
    gate: gate ? { depthMm: gate.depthMm, uMm: gate.uMm } : null,
    metrics: {
      inPlaneLengthMm: ev.lengthMm,
      insonationDeg: gate?.insonationDeg,
      vesselId: gate?.vesselId ?? null,
      evaluations: search.evaluations,
    },
  };
}
