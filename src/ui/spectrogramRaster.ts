import { nyquistVelocityCms } from '../core/units';
import type { SpectralColumn } from '../doppler/spectral';

export type SpectralColormap = 'gris' | 'ambar';

export interface SpectrogramRasterOptions {
  readonly width: number;
  readonly height: number;
  readonly fftSize: number;
  readonly baseline: number;
  readonly invert: boolean;
  readonly sweepSeconds: number;
  readonly gainDb: number;
  readonly drDb: number;
  readonly floorOffsetDb?: number;
  readonly gamma?: number;
  readonly floorPercentile?: number;
  readonly colormap?: SpectralColormap;
}

export interface SpectralVelocityTick {
  readonly valueCms: number;
  readonly y: number;
}

function percentile(values: readonly number[], p: number): number {
  return percentileInPlace(Float64Array.from(values), p);
}

/**
 * Percentil por selección (quickselect, O(n)) sobre un buffer que se
 * reordena: devuelve el mismo estadístico de orden que ordenar y leer el
 * índice `round((n−1)·p)`, sin el coste de ordenar ~80 k valores por rAF.
 */
export function percentileInPlace(a: Float64Array, p: number): number {
  const n = a.length;
  if (n === 0) return -200;
  const k = Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)));
  let lo = 0;
  let hi = n - 1;
  while (hi > lo) {
    const pivot = a[(lo + hi) >> 1]!;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i]! < pivot) i++;
      while (a[j]! > pivot) j--;
      if (i <= j) {
        const t = a[i]!;
        a[i] = a[j]!;
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k]!;
}

function visibleColumns(
  columns: readonly SpectralColumn[],
  width: number,
  sweepSeconds: number,
): { columns: SpectralColumn[]; t0: number; t1: number } {
  if (columns.length === 0) return { columns: [], t0: 0, t1: sweepSeconds };
  const t1 = columns[columns.length - 1]!.t;
  const t0 = t1 - sweepSeconds;
  return { columns: columns.filter((column) => column.t >= t0), t0, t1 };
}

function interpolateBin(powerDb: Float32Array, index: number): number {
  const clamped = Math.max(0, Math.min(powerDb.length - 1, index));
  const lo = Math.floor(clamped);
  const hi = Math.min(powerDb.length - 1, lo + 1);
  const f = clamped - lo;
  return powerDb[lo]! * (1 - f) + powerDb[hi]! * f;
}

function rowFrequencyFraction(y: number, height: number, baseline: number, invert: boolean): number {
  const center = baseline * height;
  const raw = y <= center ? (center - y) / Math.max(1, center) : -(y - center) / Math.max(1, height - center);
  return invert ? -raw : raw;
}

export function frequencyFractionToY(
  fraction: number,
  height: number,
  baseline: number,
  invert: boolean,
): number {
  const raw = invert ? -fraction : fraction;
  const center = baseline * height;
  return raw >= 0 ? center - raw * center : center - raw * (height - center);
}

export function rasterizeSpectrogram(
  columns: readonly SpectralColumn[],
  opts: SpectrogramRasterOptions,
): Uint8ClampedArray {
  const { width, height, fftSize } = opts;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  if (width <= 0 || height <= 0 || columns.length === 0) return rgba;

  const visible = visibleColumns(columns, width, opts.sweepSeconds);
  if (visible.columns.length === 0) return rgba;
  const N = Math.min(fftSize, visible.columns[0]!.powerDb.length);
  const buckets: SpectralColumn[][] = Array.from({ length: width }, () => []);
  for (const column of visible.columns) {
    const x = Math.floor(((column.t - visible.t0) / opts.sweepSeconds) * width);
    if (x >= 0 && x < width) buckets[x]!.push(column);
  }
  const profiles: Float32Array[] = [];
  for (let x = 0; x < width; x++) {
    const bucket = buckets[x]!;
    if (bucket.length > 0) {
      const profile = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        // Misma suma izquierda→derecha que el antiguo reduce (bit a bit).
        let sum = 0;
        for (let c = 0; c < bucket.length; c++) sum += bucket[c]!.powerDb[k]!;
        profile[k] = sum / bucket.length;
      }
      profiles.push(profile);
      continue;
    }
    const target = visible.t0 + ((x + 0.5) / width) * opts.sweepSeconds;
    let nearest = visible.columns[0]!;
    let distance = Math.abs(nearest.t - target);
    for (const column of visible.columns.slice(1)) {
      const nextDistance = Math.abs(column.t - target);
      if (nextDistance < distance) {
        nearest = column;
        distance = nextDistance;
      }
    }
    profiles.push(nearest.powerDb);
  }

  let total = 0;
  for (const profile of profiles) total += profile.length;
  const allPower = new Float64Array(total);
  let offsetAll = 0;
  for (const profile of profiles) {
    allPower.set(profile, offsetAll);
    offsetAll += profile.length;
  }
  const floorDb = percentileInPlace(allPower, opts.floorPercentile ?? 0.2);
  const gamma = opts.gamma ?? 0.7;
  const dr = Math.max(1e-6, opts.drDb);
  const floorRef = floorDb + (opts.floorOffsetDb ?? 6);
  for (let y = 0; y < height; y++) {
    const fraction = rowFrequencyFraction(y + 0.5, height, opts.baseline, opts.invert);
    const index = (fraction + 1) * (N / 2);
    // Vecinos/peso del bin por fila (idénticos a `interpolateBin` para perfiles
    // de longitud N): se calculan una vez por fila, no por píxel (DEC-54).
    const clamped = Math.max(0, Math.min(N - 1, index));
    const lo = Math.floor(clamped);
    const hi = Math.min(N - 1, lo + 1);
    const f = clamped - lo;
    for (let x = 0; x < width; x++) {
      const profile = profiles[x]!;
      const dbv =
        profile.length === N ? profile[lo]! * (1 - f) + profile[hi]! * f : interpolateBin(profile, index);
      const u = Math.min(1, Math.max(0, (dbv + opts.gainDb - floorRef) / dr));
      const level = 4 + Math.round(251 * Math.pow(u, gamma));
      const offset = (y * width + x) * 4;
      if (opts.colormap === 'ambar') {
        rgba[offset] = level;
        rgba[offset + 1] = Math.round(level * 0.68);
        rgba[offset + 2] = Math.round(level * 0.2);
      } else {
        rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = level;
      }
    }
  }
  return rgba;
}

export function spectralVelocityTicks(
  height: number,
  baseline: number,
  invert: boolean,
  prfHz: number,
  f0Hz: number,
  angleCorrectionRad: number,
): SpectralVelocityTick[] {
  const nyq = nyquistVelocityCms(prfHz, f0Hz, angleCorrectionRad);
  const limit = Math.floor(nyq / 20) * 20;
  const ticks: SpectralVelocityTick[] = [];
  for (let value = -limit; value <= limit; value += 20) {
    ticks.push({
      valueCms: value,
      y: frequencyFractionToY(value / nyq, height, baseline, invert),
    });
  }
  return ticks;
}

export function spectralFloorDb(
  columns: readonly SpectralColumn[],
  sweepSeconds: number,
  percentileValue = 0.2,
): number {
  if (columns.length === 0) return -200;
  const t1 = columns[columns.length - 1]!.t;
  const visible = columns.filter((column) => column.t >= t1 - sweepSeconds);
  return percentile(
    visible.flatMap((column) => Array.from(column.powerDb)),
    percentileValue,
  );
}
