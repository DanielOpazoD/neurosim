/**
 * Poses de sonda: transformaciones puras desde el caso y el estado.
 * No accede al reloj ni a elementos de la interfaz.
 */
import { add, cross, normalize, scale, type Vec3 } from '../core/vec3';
import type { ProbePose, Side } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import { surfacePoint } from '../anatomy/head';
import { rotateAround } from '../ultrasound/probe';
import type { AppState } from './state';

export type PoseInput = Pick<AppState, 'side' | 'station' | 'tiltDeg' | 'offsetMm'> &
  Partial<Pick<AppState, 'offsetVMm' | 'tiltVDeg' | 'rotDeg' | 'press'>>;

/** Distancia (mm) de la cara de la sonda ocular a la superficie del globo: párpado + gel. */
export const EYE_PROBE_STANDOFF_MM = 3.2;

export function eyePose(sim: ReferenceCase, s: PoseInput, side = s.side): ProbePose {
  const eye = sim.eyes[side];
  const anterior: Vec3 = [0, 0, 1];
  const lateral: Vec3 = [1, 0, 0];
  const tilt = (s.tiltDeg * Math.PI) / 180;
  const rot = ((s.rotDeg ?? 0) * Math.PI) / 180;
  let fwd = normalize(rotateAround(scale(anterior, -1), lateral, tilt));
  // Eje de elevación del haz (antes del giro de marcador): deslizamiento
  // vertical sobre el párpado y angulación izquierda/derecha del haz.
  // cross(lateral, fwd) apunta a +y (superior) en ambas estaciones.
  const elev = normalize(cross(lateral, fwd));
  const origin = add(
    eye.center,
    add(
      add(scale(anterior, eye.globeRadiusMm + EYE_PROBE_STANDOFF_MM), scale(lateral, s.offsetMm)),
      scale(elev, s.offsetVMm ?? 0),
    ),
  );
  const tiltV = ((s.tiltVDeg ?? 0) * Math.PI) / 180;
  if (tiltV !== 0) fwd = normalize(rotateAround(fwd, elev, tiltV));
  const lat = rotateAround(lateral, fwd, rot);
  return {
    origin,
    forward: fwd,
    lateral: normalize(lat),
    markerAngleRad: rot,
    contactPressure: s.press ?? 0.3,
  };
}

export function temporalPose(sim: ReferenceCase, s: PoseInput, side = s.side): ProbePose {
  const wc = sim.head.windowCenter[side];
  const inward = normalize([
    sim.head.midbrainCenter[0] - wc[0],
    sim.head.midbrainCenter[1] - wc[1],
    sim.head.midbrainCenter[2] - wc[2],
  ]);
  const up: Vec3 = [0, 1, 0];
  let lateral: Vec3 = [
    inward[1] * up[2] - inward[2] * up[1],
    inward[2] * up[0] - inward[0] * up[2],
    inward[0] * up[1] - inward[1] * up[0],
  ];
  lateral = normalize(lateral);
  const tilt = (s.tiltDeg * Math.PI) / 180;
  const rot = ((s.rotDeg ?? 0) * Math.PI) / 180;
  let fwd = normalize(rotateAround(inward, lateral, tilt));
  // Eje de elevación del haz (antes del giro de marcador): offV desliza la
  // sonda superior/inferior por la ventana; tiltV angula el haz en ese plano.
  const elev = normalize(cross(lateral, fwd));
  const offV = s.offsetVMm ?? 0;
  // Cara de la sonda pegada a la piel (cuero cabelludo ~7,5 mm en la fosa:
  // 2,5 piel + 5 temporalis) — sin hueco de aire, que atenúa ~20 dB/cm.
  // Al deslizar (offsetMm/offsetVMm) el origen sigue la superficie del
  // cuero cabelludo sobre el elipsoide — salirse de la ventana mete hueso.
  const origin =
    s.offsetMm === 0 && offV === 0
      ? add(wc, scale(fwd, -7.7))
      : surfacePoint(sim.head, add(add(wc, scale(lateral, s.offsetMm)), scale(elev, offV)), 7.7);
  const tiltV = ((s.tiltVDeg ?? 0) * Math.PI) / 180;
  if (tiltV !== 0) fwd = normalize(rotateAround(fwd, elev, tiltV));
  const lat = rotateAround(lateral, fwd, rot);
  return {
    origin,
    forward: fwd,
    lateral: normalize(lat),
    markerAngleRad: rot,
    contactPressure: s.press ?? 0.3,
  };
}

/**
 * Ventana submandibular (DEC-58): sonda sectorial bajo el ángulo mandibular,
 * haz craneal ~30° hacia la base del cráneo. El plano de imagen por defecto
 * contiene el haz y el lateral del paciente (derecha de la imagen = lateral
 * en ambos lados). Mismos controles que la temporal: inclinación alrededor
 * del lateral, angulación en elevación, deslizamientos sobre el plano
 * cutáneo y giro del marcador. La cara queda 0,3 mm dentro de la piel.
 */
export function submandibularPose(sim: ReferenceCase, s: PoseInput, side = s.side): ProbePose {
  const frame = sim.neck[side].frame;
  const lateral = frame.lateral;
  const tilt = (s.tiltDeg * Math.PI) / 180;
  const rot = ((s.rotDeg ?? 0) * Math.PI) / 180;
  let fwd = normalize(rotateAround(frame.beam, lateral, tilt));
  const elev = normalize(cross(lateral, fwd));
  // Deslizamiento sobre el plano cutáneo (⟂ al haz por defecto).
  const skinElev = normalize(cross(lateral, frame.beam));
  const origin = add(
    add(frame.origin, scale(frame.beam, 0.3)),
    add(scale(lateral, s.offsetMm), scale(skinElev, s.offsetVMm ?? 0)),
  );
  const tiltV = ((s.tiltVDeg ?? 0) * Math.PI) / 180;
  if (tiltV !== 0) fwd = normalize(rotateAround(fwd, elev, tiltV));
  const lat = rotateAround(lateral, fwd, rot);
  return {
    origin,
    forward: fwd,
    lateral: normalize(lat),
    markerAngleRad: rot,
    contactPressure: s.press ?? 0.3,
  };
}

/** Pose de la estación: función pura de los controles de la sonda. */
export function stationPose(sim: ReferenceCase, s: PoseInput, side = s.side): ProbePose {
  return s.station === 'ojo'
    ? eyePose(sim, s, side)
    : s.station === 'submandibular'
      ? submandibularPose(sim, s, side)
      : temporalPose(sim, s, side);
}

/**
 * Pose actual de la sonda. El micro-movimiento de mano se eliminó (DEC-59):
 * la pose es exactamente la de los controles, la misma en el B-mode, el PW,
 * la vista de cabeza y el navegador anatómico.
 */
export function currentPose(sim: ReferenceCase, s: PoseInput): ProbePose {
  return stationPose(sim, s);
}

export function poseForSide(sim: ReferenceCase, s: PoseInput, side: Side): ProbePose {
  return stationPose(sim, s, side);
}
