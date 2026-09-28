import type { BModeFrame } from '../ultrasound/bmode';
import type { ScanGeometry } from '../ultrasound/probe';

export interface ScanConvertOptions {
  readonly dynamicRangeDb: number;
}

/** Muestreo bilineal de la imagen dB en coordenadas fraccionarias (borde: clamp). */
function bilinearDb(
  db: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  fli: number,
  fzi: number,
): number {
  const x = Math.min(Math.max(fli, 0), sourceWidth - 1);
  const y = Math.min(Math.max(fzi, 0), sourceHeight - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(sourceWidth - 1, x0 + 1);
  const y1 = Math.min(sourceHeight - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = db[y0 * sourceWidth + x0]!;
  const b = db[y0 * sourceWidth + x1]!;
  const c = db[y1 * sourceWidth + x0]!;
  const d = db[y1 * sourceWidth + x1]!;
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/**
 * Píxel de salida → coordenadas de imagen (z mm, u mm/rad).
 * `null` fuera del sector o la profundidad; lineal siempre devuelve el punto.
 */
export function pixelToImage(
  scan: ScanGeometry,
  depthMm: number,
  width: number,
  height: number,
  x: number,
  y: number,
): { z: number; u: number } | null {
  if (scan.kind === 'linear') {
    return {
      u: ((x + 0.5) / width - 0.5) * scan.widthMmOrRad,
      z: ((y + 0.5) / height) * depthMm,
    };
  }
  const cx = width / 2;
  const scalePx = Math.min(height * 1.15, Math.hypot(width / 2, height)) / depthMm;
  const dx = x - cx;
  const dy = y;
  const r = Math.hypot(dx, dy) / scalePx;
  const a = Math.atan2(dx, dy);
  const half = scan.widthMmOrRad / 2;
  if (a < -half || a > half || r < 0 || r >= depthMm) return null;
  return { z: r, u: a };
}

export function scanConvert(
  frame: BModeFrame,
  opts: ScanConvertOptions,
  width: number,
  height: number,
): Uint8ClampedArray {
  const { width: sourceWidth, height: sourceHeight, db, scan, depthMm } = frame;
  const px = new Uint8ClampedArray(width * height * 4);
  px.fill(0);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;

  if (scan.kind === 'linear') {
    const sx = width / sourceWidth;
    const sy = height / sourceHeight;
    for (let y = 0; y < height; y++) {
      const fzi = (y + 0.5) / sy - 0.5;
      for (let x = 0; x < width; x++) {
        const fli = (x + 0.5) / sx - 0.5;
        const g = gray(bilinearDb(db, sourceWidth, sourceHeight, fli, fzi), opts.dynamicRangeDb);
        const k = (y * width + x) * 4;
        px[k] = px[k + 1] = px[k + 2] = g;
      }
    }
    return px;
  }

  const half = scan.widthMmOrRad / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = pixelToImage(scan, depthMm, width, height, x, y);
      if (!p) continue;
      const fzi = (p.z / depthMm) * sourceHeight - 0.5;
      const fli = ((p.u + half) / (2 * half)) * sourceWidth - 0.5;
      const g = gray(bilinearDb(db, sourceWidth, sourceHeight, fli, fzi), opts.dynamicRangeDb);
      const k = (y * width + x) * 4;
      px[k] = px[k + 1] = px[k + 2] = g;
    }
  }
  return px;
}

function gray(db: number, dynamicRangeDb: number): number {
  const x = db / dynamicRangeDb + 1;
  return Math.round(255 * Math.min(1, Math.max(0, x)));
}
