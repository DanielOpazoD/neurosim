import type { Vec3 } from '../core/vec3';
import { normalize, scale, sub } from '../core/vec3';
import { hash3 } from '../core/random';
import type { VesselScene } from '../anatomy/head';
import { vesselClosest, vesselDistance } from '../anatomy/head';
import { arterialShape } from '../physiology/flow';
import { DOPPLER } from './params';
import { FISIOLOGIA } from '../physiology/params';

export interface TissueMotionInput {
  scene: VesselScene;
  point: Vec3;
  cardiacPhase: number;
  heartRateBpm: number;
  tSec: number;
}

function arterialShapeDerivative(phase: number, heartRateBpm: number): number {
  const h = 1e-4;
  const p = ((phase % 1) + 1) % 1;
  const dShapeDPhase =
    p < h
      ? (arterialShape(p + h) - arterialShape(p)) / h
      : p > 1 - h
        ? (arterialShape(p) - arterialShape(p - h)) / h
        : (arterialShape(p + h) - arterialShape(p - h)) / (2 * h);
  const cycleSlope = arterialShape(1 - h) - arterialShape(0);
  return (dShapeDPhase - cycleSlope) * (heartRateBpm / 60);
}

/** Geometría estática del movimiento tisular: solo depende de `point`. */
export interface TissueMotionBasis {
  radial: Vec3;
  dToWall: number;
}

export function tissueMotionBasis(scene: VesselScene, point: Vec3): TissueMotionBasis {
  let nearest = scene.vessels[0]!;
  let nearestDistance = vesselDistance(nearest, point);
  for (const vessel of scene.vessels.slice(1)) {
    const d = vesselDistance(vessel, point);
    if (d < nearestDistance) {
      nearest = vessel;
      nearestDistance = d;
    }
  }
  const closest = vesselClosest(nearest, point);
  const radial = normalize(sub(point, closest.point));
  return { radial, dToWall: Math.max(0, nearestDistance) };
}

export function tissueVelocityFromBasis(
  basis: TissueMotionBasis,
  cardiacPhase: number,
  heartRateBpm: number,
  tSec: number,
): Vec3 {
  const dShapeDt = arterialShapeDerivative(cardiacPhase, heartRateBpm);
  const wallMagnitude =
    DOPPLER.params.wallExcursionMm.value *
    dShapeDt *
    Math.exp(-basis.dToWall / DOPPLER.params.wallMotionDecayMm.value);
  const wall = scale(basis.radial, wallMagnitude);
  const respiratoryHz = FISIOLOGIA.params.respiratoryRatePerMin.value / 60;
  const respiratoryVelocity =
    FISIOLOGIA.params.respBrainShiftMm.value *
    2 *
    Math.PI *
    respiratoryHz *
    Math.cos(2 * Math.PI * respiratoryHz * tSec);
  const brain = [0, 0, DOPPLER.params.brainPulsationMm.value * dShapeDt + respiratoryVelocity] as Vec3;
  return [wall[0] + brain[0], wall[1] + brain[1], wall[2] + brain[2]];
}

export function tissueVelocityMmS(inp: TissueMotionInput): Vec3 {
  return tissueVelocityFromBasis(
    tissueMotionBasis(inp.scene, inp.point),
    inp.cardiacPhase,
    inp.heartRateBpm,
    inp.tSec,
  );
}

export function handTremorVelocityMmS(tSec: number, seed: number): Vec3 {
  const out: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    let value = 0;
    for (let harmonic = 0; harmonic < 2; harmonic += 1) {
      const frequency = 8 + 4 * hash3(seed, axis, harmonic, 0x54524d46);
      const phase = 2 * Math.PI * hash3(seed, axis, harmonic, 0x54525048);
      value += Math.sin(2 * Math.PI * frequency * tSec + phase);
    }
    out[axis] = value * DOPPLER.params.handTremorMmS.value;
  }
  return out;
}
