/**
 * Campo de dispersión coherente (speckle) reproducible por semilla.
 *
 * Campo gaussiano circular complejo: `re` e `im` son dos campos
 * independientes de valores gaussianos por nodo (Box–Muller sobre hash3)
 * interpolados trilinealmente sobre una retícula subresolución de paso
 * `PITCH_MM` (< λ). La envoltura |re+i·im| tras la PSF sigue estadística de
 * Rayleigh (media/σ ≈ 1,91 en tejido homogéneo), como el speckle real. La
 * identidad del caso se mantiene en PatientState, nunca en la imagen.
 */
import { hash3, hashString } from '../core/random';
import type { Vec3 } from '../core/vec3';

/** Retícula de dispersantes: subresolución (< λ a 6 MHz) para interferencia. */
const PITCH_MM = 0.12;

function nodeIndex(ix: number, iy: number, iz: number): number {
  return (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);
}

function hashLattice(seed: string, ix: number, iy: number, iz: number): number {
  return hash3(nodeIndex(ix, iy, iz), 0, 0, hashString(seed));
}

/** Gaussiano unitario determinista por nodo (Box–Muller con dos hashes). */
function gaussLattice(nodeSeed: number, ix: number, iy: number, iz: number): number {
  const h = nodeIndex(ix, iy, iz);
  const u1 = Math.max(1e-12, hash3(h, 0, 0, nodeSeed));
  const u2 = hash3(h, 1, 0, nodeSeed);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Ruido trilineal suave en [-1, 1], determinista por `seed` y posición. */
export function scatterNoise(seed: string, p: Vec3, pitchMm = PITCH_MM): number {
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
 * Campo gaussiano interpolado trilinealmente (componente `salt`), con
 * varianza normalizada (÷√Σw²) para que la envoltura sea Rayleigh en toda
 * la celda y no solo en los nodos.
 */
function latticeGaussField(seed: string, salt: string, p: Vec3): number {
  const fx = p[0] / PITCH_MM;
  const fy = p[1] / PITCH_MM;
  const fz = p[2] / PITCH_MM;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  const nodeSeed = hashString(seed + salt);
  let acc = 0;
  let w2 = 0;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
        w2 += w * w;
        acc += w * gaussLattice(nodeSeed, x0 + dx, y0 + dy, z0 + dz);
      }
    }
  }
  return acc / Math.sqrt(Math.max(1e-9, w2));
}

/**
 * Amplitud compleja del dispersante: re e im son dos campos gaussianos
 * independientes escalados por la intensidad de dispersión del material →
 * envoltura Rayleigh tras la PSF.
 */
export function scatterComplex(seed: string, p: Vec3, scatterAmp: number): [number, number] {
  return [scatterAmp * latticeGaussField(seed, ':re', p), scatterAmp * latticeGaussField(seed, ':im', p)];
}
