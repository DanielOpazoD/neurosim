/**
 * Campo de dispersión coherente (speckle) reproducible por semilla.
 *
 * Ruido de valor trilineal sobre retícula de paso `pitchMm` derivado de
 * hash3: el speckle es textura, no mapeo anatómico — la identidad del caso
 * se mantiene en PatientState, nunca en la imagen.
 */
import { hash3, hashString } from '../core/random';
import type { Vec3 } from '../core/vec3';

/** Retícula de dispersantes: tamaño del grano del speckle (mm). */
const PITCH_MM = 0.35;

function hashLattice(seed: string, ix: number, iy: number, iz: number): number {
  return hash3((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791), 0, 0, hashString(seed));
}

/** Ruido trilineal suave en [-1, 1], determinista por `seed` y posición. */
export function scatterNoise(seed: string, p: Vec3): number {
  const fx = p[0] / PITCH_MM;
  const fy = p[1] / PITCH_MM;
  const fz = p[2] / PITCH_MM;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const sz = tz * tz * (3 - 2 * tz);
  let acc = 0;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
        acc += w * (2 * hashLattice(seed, x0 + dx, y0 + dy, z0 + dz) - 1);
      }
    }
  }
  return acc;
}

/**
 * Amplitud compleja del dispersante: fase aleatoria estable por posición,
 * módulo proporcional a la intensidad de dispersión del material.
 */
export function scatterComplex(seed: string, p: Vec3, scatterAmp: number): [number, number] {
  const phase =
    2 *
    Math.PI *
    hash3(
      Math.floor(p[0] / PITCH_MM) * 7919,
      Math.floor(p[1] / PITCH_MM) * 104729,
      Math.floor(p[2] / PITCH_MM) * 1299709,
      hashString(seed + ':ph'),
    );
  const amp = scatterAmp * (0.55 + 0.45 * scatterNoise(seed + ':n', p));
  return [amp * Math.cos(phase), amp * Math.sin(phase)];
}
