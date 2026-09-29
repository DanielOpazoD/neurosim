/**
 * Poses de sonda: transformaciones puras desde el caso y el estado.
 * No accede al reloj ni a elementos de la interfaz.
 */
import { add, cross, dot, normalize, scale, type Vec3 } from '../core/vec3';
import { hash3 } from '../core/random';
import type { ProbePose, Side } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import { DOPPLER } from '../doppler/params';
import { surfacePoint } from '../anatomy/head';
import { handTremorVelocityMmS } from '../doppler/clutter';
import { rotateAround } from '../ultrasound/probe';
import type { AppState } from './state';

export type PoseInput = Pick<AppState, 'side' | 'station' | 'tiltDeg' | 'offsetMm'> &
  Partial<Pick<AppState, 'offsetVMm' | 'tiltVDeg' | 'rotDeg' | 'press' | 'handMotion'>> & {
    tSec?: number;
  };

/**
 * Retroceso máximo (mm) de la cara de la sonda respecto del tejido por el
 * micro-movimiento de mano: la sonda sigue acoplada con gel (DEC-55).
 */
export const HAND_MAX_RETREAT_MM = 0.05;

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
      add(scale(anterior, eye.globeRadiusMm + 3.2), scale(lateral, s.offsetMm)),
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

/** Pose nominal de la estación (sin micro-movimiento de mano). */
export function stationPose(sim: ReferenceCase, s: PoseInput, side = s.side): ProbePose {
  return s.station === 'ojo'
    ? eyePose(sim, s, side)
    : s.station === 'submandibular'
      ? submandibularPose(sim, s, side)
      : temporalPose(sim, s, side);
}

/**
 * Desplazamiento bruto (mm, marco paciente) del micro-movimiento de mano:
 * temblor + derivas, antes de la cota de contacto de `currentPose`.
 */
export function handMotionDisplacementMm(t: number, seed: number): Vec3 {
  const tremorAmp = DOPPLER.params.handTremorMmS.value;
  const driftFast = DOPPLER.params.handDriftFastMm.value;
  const driftSlow = DOPPLER.params.handDriftSlowMm.value;
  const disp: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    let d = 0;
    // Temblor fisiológico: mismas frecuencias/fases que
    // handTremorVelocityMmS, integradas analíticamente (A = v/2πf).
    for (let harmonic = 0; harmonic < 2; harmonic += 1) {
      const frequency = 8 + 4 * hash3(seed, axis, harmonic, 0x54524d46);
      const phase = 2 * Math.PI * hash3(seed, axis, harmonic, 0x54525048);
      d += (-tremorAmp * Math.cos(2 * Math.PI * frequency * t + phase)) / (2 * Math.PI * frequency);
    }
    // Deriva lenta del pulso.
    d += driftFast * Math.sin(2 * Math.PI * 0.27 * t + 2 * Math.PI * hash3(seed, axis, 7, 0x44524631));
    d += driftSlow * Math.sin(2 * Math.PI * 0.06 * t + 2 * Math.PI * hash3(seed, axis, 8, 0x44524632));
    disp[axis] = d;
  }
  return disp;
}

export function currentPose(sim: ReferenceCase, s: PoseInput): ProbePose {
  const pose = stationPose(sim, s);
  if (!s.handMotion || s.tSec === undefined) return pose;
  const seed = sim.patient.seed;
  const t = s.tSec;
  const disp = handMotionDisplacementMm(t, seed);
  // Contacto con gel (DEC-55): la componente que aleja la cara de la sonda
  // del tejido (−forward) se acota a HAND_MAX_RETREAT_MM; la deriva lateral,
  // elevacional y hacia el tejido se conserva. Sin la cota, >0,5 mm de
  // retroceso metía aire (≈125 dB/cm a 10 MHz) y oscurecía el fotograma.
  const along = dot(disp, pose.forward);
  const origin = add(
    pose.origin,
    along < -HAND_MAX_RETREAT_MM ? add(disp, scale(pose.forward, -HAND_MAX_RETREAT_MM - along)) : disp,
  );
  // Jitter de inclinación ~0,3° a 0,27 Hz.
  const jitterRad =
    ((0.3 * Math.PI) / 180) * Math.sin(2 * Math.PI * 0.27 * t + 2 * Math.PI * hash3(seed, 3, 9, 0x44525033));
  const forward = normalize(rotateAround(pose.forward, pose.lateral, jitterRad));
  return { ...pose, origin, forward };
}

export function poseForSide(sim: ReferenceCase, s: PoseInput, side: Side): ProbePose {
  return stationPose(sim, s, side);
}

/**
 * Velocidad de la sonda por micro-movimiento de mano (mm/s): derivada
 * analítica del desplazamiento de `currentPose` — temblor (igual que
 * `handTremorVelocityMmS`) más la derivada de las derivas lenta/rápida.
 */
export function handMotionVelocityMmS(tSec: number, seed: number): Vec3 {
  const out = handTremorVelocityMmS(tSec, seed);
  const driftFast = DOPPLER.params.handDriftFastMm.value;
  const driftSlow = DOPPLER.params.handDriftSlowMm.value;
  for (let axis = 0; axis < 3; axis += 1) {
    out[axis]! +=
      driftFast *
      2 *
      Math.PI *
      0.27 *
      Math.cos(2 * Math.PI * 0.27 * tSec + 2 * Math.PI * hash3(seed, axis, 7, 0x44524631));
    out[axis]! +=
      driftSlow *
      2 *
      Math.PI *
      0.06 *
      Math.cos(2 * Math.PI * 0.06 * tSec + 2 * Math.PI * hash3(seed, axis, 8, 0x44524632));
  }
  return out;
}
