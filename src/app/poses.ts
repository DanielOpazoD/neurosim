/**
 * Poses de sonda: transformaciones puras desde el caso y el estado.
 * No accede al reloj ni a elementos de la interfaz.
 */
import { add, normalize, scale, type Vec3 } from '../core/vec3';
import { hash3 } from '../core/random';
import type { ProbePose, Side } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import { DOPPLER } from '../doppler/params';
import { rotateAround } from '../ultrasound/probe';
import type { AppState } from './state';

export type PoseInput = Pick<AppState, 'side' | 'station' | 'tiltDeg' | 'offsetMm'> &
  Partial<Pick<AppState, 'rotDeg' | 'press' | 'handMotion'>> & { tSec?: number };

export function eyePose(sim: ReferenceCase, s: PoseInput, side = s.side): ProbePose {
  const eye = sim.eyes[side];
  const anterior: Vec3 = [0, 0, 1];
  const lateral: Vec3 = [1, 0, 0];
  const tilt = (s.tiltDeg * Math.PI) / 180;
  const rot = ((s.rotDeg ?? 0) * Math.PI) / 180;
  const origin = add(eye.center, add(scale(anterior, eye.globeRadiusMm + 3.2), scale(lateral, s.offsetMm)));
  const fwd = normalize(rotateAround(scale(anterior, -1), lateral, tilt));
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
  const fwd = normalize(rotateAround(inward, lateral, tilt));
  // Cara de la sonda pegada a la piel (cuero cabelludo ~7,5 mm en la fosa:
  // 2,5 piel + 5 temporalis) — sin hueco de aire, que atenúa ~20 dB/cm.
  const origin = add(add(wc, scale(fwd, -7.7)), scale(lateral, s.offsetMm));
  const lat = rotateAround(lateral, fwd, rot);
  return {
    origin,
    forward: fwd,
    lateral: normalize(lat),
    markerAngleRad: rot,
    contactPressure: s.press ?? 0.3,
  };
}

export function currentPose(sim: ReferenceCase, s: PoseInput): ProbePose {
  const pose = s.station === 'ojo' ? eyePose(sim, s) : temporalPose(sim, s);
  if (!s.handMotion || s.tSec === undefined) return pose;
  const seed = sim.patient.seed;
  const t = s.tSec;
  const tremorAmp = DOPPLER.params.handTremorMmS.value;
  const driftFast = DOPPLER.params.handDriftFastMm.value;
  const driftSlow = DOPPLER.params.handDriftSlowMm.value;
  const origin: Vec3 = [pose.origin[0], pose.origin[1], pose.origin[2]];
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
    origin[axis]! += d;
  }
  // Jitter de inclinación ~0,3° a 0,27 Hz.
  const jitterRad =
    ((0.3 * Math.PI) / 180) * Math.sin(2 * Math.PI * 0.27 * t + 2 * Math.PI * hash3(seed, 3, 9, 0x44525033));
  const forward = normalize(rotateAround(pose.forward, pose.lateral, jitterRad));
  return { ...pose, origin, forward };
}

export function poseForSide(sim: ReferenceCase, s: PoseInput, side: Side): ProbePose {
  return s.station === 'ojo' ? eyePose(sim, s, side) : temporalPose(sim, s, side);
}
