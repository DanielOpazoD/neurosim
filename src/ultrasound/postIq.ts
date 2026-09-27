import type { AcquisitionSettings } from '../domain/contracts';
import { FISICA_US } from './params';
import { lateralFwhmMm, sigmaFromFwhm, sidelobeLevelDb, type BeamSpec } from './beam';
import type { ScanGeometry } from './probe';

export interface Kernel {
  readonly w: Float32Array;
  readonly r: number;
}

const MAX_GPU_KERNEL_RADIUS = 64;

export function applyPsfAndCompression(
  iqMagnitude: Float32Array,
  width: number,
  height: number,
  dz: number,
  scan: ScanGeometry,
  settings: AcquisitionSettings,
  beam: BeamSpec,
): Float32Array {
  const f0 = settings.frequencyMhz;
  const sigmaAxial = Math.max(1, FISICA_US.params.axialPulseMmMhz.value / f0 / dz);
  const out = new Float32Array(width * height);
  const tmp = new Float32Array(width * height);
  const kernA = gaussKernel(sigmaAxial);
  for (let li = 0; li < width; li++) {
    for (let zi = 0; zi < height; zi++) {
      let acc = 0;
      for (let t = -kernA.r; t <= kernA.r; t++) {
        const zz = Math.min(height - 1, Math.max(0, zi + t));
        acc += iqMagnitude[zz * width + li]! * kernA.w[t + kernA.r]!;
      }
      tmp[zi * width + li] = acc;
    }
  }

  const sidelobeEpsilon = Math.pow(10, sidelobeLevelDb(beam) / 20);
  for (let zi = 0; zi < height; zi++) {
    const zMm = zi * dz;
    const pitchMm =
      scan.kind === 'linear'
        ? scan.widthMmOrRad / Math.max(1, scan.lineCount - 1)
        : Math.max(1e-6, (zMm * scan.widthMmOrRad) / Math.max(1, scan.lineCount - 1));
    const kern = beamKernel(
      Math.max(0.6, sigmaFromFwhm(lateralFwhmMm(beam, zMm)) / pitchMm),
      sidelobeEpsilon,
    );
    for (let li = 0; li < width; li++) {
      let acc = 0;
      for (let t = -kern.r; t <= kern.r; t++) {
        const ll = Math.min(width - 1, Math.max(0, li + t));
        acc += tmp[zi * width + ll]! * kern.w[t + kern.r]!;
      }
      out[zi * width + li] = acc;
    }
  }

  const maxRef = 4.0;
  const tgcAt = (zMm: number): number => {
    const n = settings.tgcDb.length;
    const f = Math.min(1, Math.max(0, zMm / Math.max(1, settings.depthMm))) * (n - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(n - 1, i0 + 1);
    return settings.tgcDb[i0]! * (i1 - f) + settings.tgcDb[i1]! * (f - i0);
  };
  for (let zi = 0; zi < height; zi++) {
    const tgcDb = tgcAt(zi * dz);
    for (let li = 0; li < width; li++) {
      const v = out[zi * width + li]! / maxRef;
      out[zi * width + li] = 20 * Math.log10(v + 1e-6) + settings.gainDb + tgcDb;
    }
  }
  return out;
}

export function gaussKernel(sigma: number): Kernel {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const w = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    w[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < w.length; i++) w[i]! /= sum;
  return { w, r };
}

export function beamKernel(
  sigma: number,
  sidelobeEpsilon: number,
  maxRadius = Number.POSITIVE_INFINITY,
): Kernel {
  const main = gaussKernel(sigma);
  const broad = gaussKernel(3 * sigma);
  const r = Math.min(maxRadius, Math.max(main.r, broad.r));
  const w = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const mainWeight = Math.abs(i) <= main.r ? main.w[i + main.r]! : 0;
    const broadWeight = Math.abs(i) <= broad.r ? broad.w[i + broad.r]! : 0;
    const value = (1 - sidelobeEpsilon) * mainWeight + sidelobeEpsilon * broadWeight;
    w[i + r] = value;
    sum += value;
  }
  for (let i = 0; i < w.length; i++) w[i]! /= sum;
  return { w, r };
}

export function psfKernelsTexture(
  width: number,
  height: number,
  dz: number,
  scan: ScanGeometry,
  beam: BeamSpec,
): { axial: Kernel; lateral: Float32Array; lateralRadius: number } {
  const sigmaAxial = Math.max(1, FISICA_US.params.axialPulseMmMhz.value / beam.frequencyMhz / dz);
  const axial = gaussKernel(sigmaAxial);
  const sidelobeEpsilon = Math.pow(10, sidelobeLevelDb(beam) / 20);
  const kernels = Array.from({ length: height }, (_, zi) => {
    const zMm = zi * dz;
    const pitchMm =
      scan.kind === 'linear'
        ? scan.widthMmOrRad / Math.max(1, scan.lineCount - 1)
        : Math.max(1e-6, (zMm * scan.widthMmOrRad) / Math.max(1, scan.lineCount - 1));
    return beamKernel(
      Math.max(0.6, sigmaFromFwhm(lateralFwhmMm(beam, zMm)) / pitchMm),
      sidelobeEpsilon,
      MAX_GPU_KERNEL_RADIUS,
    );
  });
  const radius = Math.max(...kernels.map((kernel) => kernel.r));
  const lateral = new Float32Array(height * (2 * radius + 1));
  for (let zi = 0; zi < height; zi++) {
    const kernel = kernels[zi]!;
    for (let i = -radius; i <= radius; i++) {
      lateral[zi * (2 * radius + 1) + i + radius] = Math.abs(i) <= kernel.r ? kernel.w[i + kernel.r]! : 0;
    }
  }
  return { axial, lateral, lateralRadius: radius };
}
