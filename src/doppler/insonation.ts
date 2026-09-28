import type { Vec3 } from '../core/vec3';
import { dot, normalize } from '../core/vec3';
import type { VesselScene } from '../anatomy/head';
import { vesselDistance, vesselFlowDir } from '../anatomy/head';
import { DOPPLER } from './params';

export interface InsonationAngles {
  vesselId: string | null;
  realDeg: number;
  projectedDeg: number;
  elevationTiltDeg: number;
}

export function insonationAngles(
  scene: VesselScene,
  center: Vec3,
  beamDir: Vec3,
  lateral: Vec3,
  elevation: Vec3,
): InsonationAngles {
  let dominant = scene.vessels[0] ?? null;
  let bestDistance = dominant ? vesselDistance(dominant, center) : Infinity;
  for (const vessel of scene.vessels.slice(1)) {
    const d = vesselDistance(vessel, center);
    if (d < bestDistance) {
      dominant = vessel;
      bestDistance = d;
    }
  }
  const maxDistance = DOPPLER.params.partialWallMm.value + (dominant?.radiusMm ?? 0);
  if (!dominant || bestDistance > maxDistance) {
    return { vesselId: null, realDeg: Number.NaN, projectedDeg: Number.NaN, elevationTiltDeg: Number.NaN };
  }
  const flow = normalize(vesselFlowDir(dominant, center));
  const beam = normalize(beamDir);
  const lat = normalize(lateral);
  const elev = normalize(elevation);
  const real = Math.acos(Math.min(1, Math.abs(dot(flow, beam)))) * (180 / Math.PI);
  const projectedVector = normalize([
    beam[0] * dot(flow, beam) + lat[0] * dot(flow, lat),
    beam[1] * dot(flow, beam) + lat[1] * dot(flow, lat),
    beam[2] * dot(flow, beam) + lat[2] * dot(flow, lat),
  ]);
  const projected = Math.acos(Math.min(1, Math.abs(dot(projectedVector, beam)))) * (180 / Math.PI);
  const elevationTilt = Math.asin(Math.min(1, Math.abs(dot(flow, elev)))) * (180 / Math.PI);
  return { vesselId: dominant.id, realDeg: real, projectedDeg: projected, elevationTiltDeg: elevationTilt };
}

export function angleCorrectionErrorFactor(realDeg: number, userDeg: number): number {
  const real = (realDeg * Math.PI) / 180;
  const user = (userDeg * Math.PI) / 180;
  return Math.cos(real) / Math.cos(user);
}
