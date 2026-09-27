import type { BModeFrame } from '../ultrasound/bmode';

export interface ScanConvertOptions {
  readonly dynamicRangeDb: number;
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
    for (let zi = 0; zi < sourceHeight; zi++) {
      for (let li = 0; li < sourceWidth; li++) {
        const g = gray(db[zi * sourceWidth + li]!, opts.dynamicRangeDb);
        const x0 = Math.floor(li * sx);
        const y0 = Math.floor(zi * sy);
        for (let y = y0; y < Math.min(height, y0 + sy + 1); y++) {
          for (let x = x0; x < Math.min(width, x0 + sx + 1); x++) {
            const k = (y * width + x) * 4;
            px[k] = px[k + 1] = px[k + 2] = g;
          }
        }
      }
    }
    return px;
  }

  const half = scan.widthMmOrRad / 2;
  const cx = width / 2;
  const cy = 0;
  const rMax = Math.min(height * 1.15, Math.hypot(width / 2, height));
  const scale = rMax / depthMm;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy) / scale;
      const a = Math.atan2(dx, dy);
      if (a < -half || a > half || r >= depthMm || r < 0) continue;
      const zi = Math.floor((r / depthMm) * sourceHeight);
      const li = Math.floor(((a + half) / (2 * half)) * sourceWidth);
      const g = gray(db[zi * sourceWidth + li]!, opts.dynamicRangeDb);
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
