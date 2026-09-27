/**
 * Mediciones sobre lo adquirido. Un `Measurement` se liga al cuadro
 * (`frameTSeconds`): ni freeze ni cine recalculan con el estado presente.
 * El valor se guarda en su unidad y, para DVNO, con su convención de bordes.
 */
import { dist, type Vec3 } from '../core/vec3';
import type { AcquiredFrame, Measurement, OnsdConvention, Side } from './contracts';
import { imageToPatient } from '../ultrasound/probe';

/** Punto de caliper en coordenadas de imagen (u mm/rad lateral, z mm axial). */
export interface ImagePoint {
  readonly u: number;
  readonly z: number;
}

export function imagePointToPatient(frame: AcquiredFrame, pt: ImagePoint): Vec3 {
  const g = frame.geometry;
  const pose = {
    origin: g.apex,
    forward: g.axialDir,
    lateral: g.lateralDir,
    markerAngleRad: 0,
    contactPressure: 0,
  };
  return imageToPatient(pose, g.kind, pt.u, pt.z);
}

/** Distancia euclídea entre dos puntos de imagen del mismo cuadro, mm. */
export function caliperDistanceMm(frame: AcquiredFrame, a: ImagePoint, b: ImagePoint): number {
  return dist(imagePointToPatient(frame, a), imagePointToPatient(frame, b));
}

/**
 * Registra una medición de distancia o DVNO sobre el cuadro.
 * `referenceOffsetMm` documenta el punto de referencia retroglobo (típ. 3 mm).
 */
export function recordDistance(
  frame: AcquiredFrame,
  side: Side,
  a: ImagePoint,
  b: ImagePoint,
  opts: { kind?: Measurement['kind']; convention?: OnsdConvention; referenceOffsetMm?: number } = {},
): Measurement {
  const pA = imagePointToPatient(frame, a);
  const pB = imagePointToPatient(frame, b);
  return {
    kind: opts.kind ?? 'distancia',
    frameTSeconds: frame.tSeconds,
    side,
    pointsMm: [pA, pB],
    value: dist(pA, pB),
    unit: 'mm',
    convention: opts.convention,
    referenceOffsetMm: opts.referenceOffsetMm,
  };
}
