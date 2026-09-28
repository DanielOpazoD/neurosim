import type { AcquisitionSettings } from '../domain/contracts';
import { FISICA_US } from './params';
import { lateralFwhmMm, sigmaFromFwhm, sidelobeLevelDb, type BeamSpec } from './beam';
import type { ScanGeometry } from './probe';

export interface Kernel {
  readonly w: Float32Array;
  readonly r: number;
}

const MAX_GPU_KERNEL_RADIUS = 64;

/** Energía de un kernel (Σw²): cuánto reduce la σ de un campo blanco. */
export function kernelEnergy(k: Kernel): number {
  let e = 0;
  for (let i = 0; i < k.w.length; i++) e += k.w[i]! * k.w[i]!;
  return e;
}

/**
 * Kernel lateral por fila z. En un sector el paso lateral crece con la
 * profundidad (pitchMm = z·fan/(lineas−1)) y tiende a 0 en el ápice, así que
 * σ en píxeles diverge: `maxRadius` lo limita igual que en la ruta WebGL
 * (MAX_GPU_KERNEL_RADIUS) para que CPU y GPU apliquen la misma convolución.
 */
/**
 * Los kernels por fila sólo dependen de (height, dz, scan, beam): se cachean
 * por fotograma porque reconstruirlos cada frame materializa arrays de
 * ~10⁶ taps en las filas próximas al ápice del sector. La clave serializa
 * todos los parámetros de entrada, así que el resultado es idéntico.
 */
const rowKernelCache = new Map<string, Kernel[]>();
function cachedRowKernels(height: number, dz: number, scan: ScanGeometry, beam: BeamSpec): Kernel[] {
  const key = `${height}|${dz}|${scan.kind}|${scan.widthMmOrRad}|${scan.lineCount}|${beam.frequencyMhz}|${beam.apertureMm}|${beam.focusMm}|${beam.elevationApertureMm}|${beam.elevationFocusMm}|${beam.soundSpeedMs}`;
  let kernels = rowKernelCache.get(key);
  if (!kernels) {
    if (rowKernelCache.size > 8) rowKernelCache.clear();
    kernels = lateralRowKernels(height, dz, scan, beam, MAX_GPU_KERNEL_RADIUS);
    rowKernelCache.set(key, kernels);
  }
  return kernels;
}

function lateralRowKernels(
  height: number,
  dz: number,
  scan: ScanGeometry,
  beam: BeamSpec,
  maxRadius: number,
): Kernel[] {
  const sidelobeEpsilon = Math.pow(10, sidelobeLevelDb(beam) / 20);
  return Array.from({ length: height }, (_, zi) => {
    const zMm = zi * dz;
    const pitchMm =
      scan.kind === 'linear'
        ? scan.widthMmOrRad / Math.max(1, scan.lineCount - 1)
        : Math.max(1e-6, (zMm * scan.widthMmOrRad) / Math.max(1, scan.lineCount - 1));
    return beamKernel(
      Math.max(0.6, sigmaFromFwhm(lateralFwhmMm(beam, zMm)) / pitchMm),
      sidelobeEpsilon,
      maxRadius,
    );
  });
}

/**
 * Buffers intermedios reutilizados entre fotogramas (tmp/out/envelope no
 * escapan: `db` e `iq` sí — se transfieren al hilo principal por
 * postMessage). El pool crece al tamaño máximo visto.
 */
let pooledSize = 0;
let pooledTmp: Float32Array | null = null;
let pooledOut: Float32Array | null = null;
let pooledEnvelope: Float32Array | null = null;
function pooledBuffers(nComplex: number): {
  tmp: Float32Array;
  out: Float32Array;
  envelope: Float32Array;
} {
  if (pooledSize < nComplex) {
    pooledSize = nComplex;
    pooledTmp = new Float32Array(nComplex * 2);
    pooledOut = new Float32Array(nComplex * 2);
    pooledEnvelope = new Float32Array(nComplex);
  }
  return { tmp: pooledTmp!, out: pooledOut!, envelope: pooledEnvelope! };
}

/**
 * Convoluciona la señal IQ compleja (re, im intercalado) con la PSF
 * separable y después detecta la envoltura |re+i·im| — orden físico: el
 * speckle es interferencia de dispersores subresolución, coherente antes de
 * la detección. La ganancia por fila 1/√(ΣwA²·ΣwL²) normaliza la energía
 * para que un campo gaussiano blanco conserve su σ (scatterAmp, maxRef y el
 * SNR de ruido mantienen su calibración). Devuelve la envoltura antes de
 * TGC/compresión y la imagen en dB.
 */
export function applyPsfAndCompression(
  iq: Float32Array,
  width: number,
  height: number,
  dz: number,
  scan: ScanGeometry,
  settings: AcquisitionSettings,
  beam: BeamSpec,
): { db: Float32Array; envelope: Float32Array } {
  const f0 = settings.frequencyMhz;
  const sigmaAxial = Math.max(1, FISICA_US.params.axialPulseMmMhz.value / f0 / dz);
  const { tmp, out, envelope } = pooledBuffers(width * height);
  const kernA = gaussKernel(sigmaAxial);
  for (let li = 0; li < width; li++) {
    for (let zi = 0; zi < height; zi++) {
      let accRe = 0;
      let accIm = 0;
      for (let t = -kernA.r; t <= kernA.r; t++) {
        const zz = Math.min(height - 1, Math.max(0, zi + t));
        const k = (zz * width + li) * 2;
        const w = kernA.w[t + kernA.r]!;
        accRe += iq[k]! * w;
        accIm += iq[k + 1]! * w;
      }
      tmp[(zi * width + li) * 2] = accRe;
      tmp[(zi * width + li) * 2 + 1] = accIm;
    }
  }

  const axialEnergy = kernelEnergy(kernA);
  // Kernels laterales por fila, calculados una vez (antes se reconstruían
  // por fila) y con radio limitado a MAX_GPU_KERNEL_RADIUS: cerca del ápice
  // del sector pitchMm→0 y σ en píxeles diverge (r > 800 000), lo que
  // dominaba el coste del fotograma; el GPU ya aplicaba este tope.
  const latKernels = cachedRowKernels(height, dz, scan, beam);
  for (let zi = 0; zi < height; zi++) {
    const kern = latKernels[zi]!;
    const rowGain = 1 / Math.sqrt(axialEnergy * kernelEnergy(kern));
    for (let li = 0; li < width; li++) {
      let accRe = 0;
      let accIm = 0;
      for (let t = -kern.r; t <= kern.r; t++) {
        const ll = Math.min(width - 1, Math.max(0, li + t));
        const k = (zi * width + ll) * 2;
        const w = kern.w[t + kern.r]!;
        accRe += tmp[k]! * w;
        accIm += tmp[k + 1]! * w;
      }
      out[(zi * width + li) * 2] = accRe * rowGain;
      out[(zi * width + li) * 2 + 1] = accIm * rowGain;
    }
  }

  for (let idx = 0; idx < envelope.length; idx++) {
    envelope[idx] = Math.hypot(out[2 * idx]!, out[2 * idx + 1]!);
  }

  const db = new Float32Array(width * height);
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
      const v = envelope[zi * width + li]! / maxRef;
      db[zi * width + li] = 20 * Math.log10(v + 1e-6) + settings.gainDb + tgcDb;
    }
  }
  return { db, envelope };
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
): { axial: Kernel; lateral: Float32Array; lateralRadius: number; rowGain: Float32Array } {
  const sigmaAxial = Math.max(1, FISICA_US.params.axialPulseMmMhz.value / beam.frequencyMhz / dz);
  const axial = gaussKernel(sigmaAxial);
  const axialEnergy = kernelEnergy(axial);
  const kernels = cachedRowKernels(height, dz, scan, beam);
  const radius = Math.max(...kernels.map((kernel) => kernel.r));
  const lateral = new Float32Array(height * (2 * radius + 1));
  const rowGain = new Float32Array(height);
  for (let zi = 0; zi < height; zi++) {
    const kernel = kernels[zi]!;
    rowGain[zi] = 1 / Math.sqrt(axialEnergy * kernelEnergy(kernel));
    for (let i = -radius; i <= radius; i++) {
      lateral[zi * (2 * radius + 1) + i + radius] = Math.abs(i) <= kernel.r ? kernel.w[i + kernel.r]! : 0;
    }
  }
  return { axial, lateral, lateralRadius: radius, rowGain };
}
