/**
 * Presentación en canvas: pasa de datos físicos (dB, cm/s) a píxeles.
 * Aquí no hay física: solo mapeo con el rango dinámico y las paletas.
 */
import type { BModeFrame } from '../ultrasound/bmode';
import type { SpectralColumn } from '../doppler/spectral';
import type { ScanGeometry } from '../ultrasound/probe';
import { nyquistVelocityCms } from '../core/units';
import {
  rasterizeSpectrogram,
  spectralVelocityTicks,
  frequencyFractionToY,
  type SpectralColormap,
} from './spectrogramRaster';

/** dB → nivel de gris [0,255] dentro del rango dinámico. */
export function dbToGray(db: number, dynamicRangeDb: number, gainDb: number): number {
  const x = (db + gainDb) / dynamicRangeDb;
  return Math.round(255 * Math.min(1, Math.max(0, x + 1 - 255 / 255 / 1)));
}

/** Pinta un fotograma B-mode en el canvas (lineal: recto; sector: abanico). */
export function drawBMode(
  ctx: CanvasRenderingContext2D,
  frame: BModeFrame,
  settings: { dynamicRangeDb: number },
): { pxPerMmZ: number; pxPerU: number } {
  const { width, height, db, scan, depthMm } = frame;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const img = ctx.createImageData(W, H);
  const px = img.data;
  px.fill(0);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;

  if (scan.kind === 'linear') {
    const sx = W / width;
    const sy = H / height;
    for (let zi = 0; zi < height; zi++) {
      for (let li = 0; li < width; li++) {
        const g = gray(db[zi * width + li]!, settings.dynamicRangeDb);
        const x0 = Math.floor(li * sx);
        const y0 = Math.floor(zi * sy);
        for (let y = y0; y < Math.min(H, y0 + sy + 1); y++) {
          for (let x = x0; x < Math.min(W, x0 + sx + 1); x++) {
            const k = (y * W + x) * 4;
            px[k] = px[k + 1] = px[k + 2] = g;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return { pxPerMmZ: H / depthMm, pxPerU: W / scan.widthMmOrRad };
  }

  // sector: cada píxel proyecta a coordenadas (ángulo, radio)
  const half = scan.widthMmOrRad / 2;
  const cx = W / 2;
  const cy = 0;
  const rMax = Math.min(H * 1.15, Math.hypot(W / 2, H));
  const scale = rMax / depthMm;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy) / scale;
      const a = Math.atan2(dx, dy);
      if (a < -half || a > half || r >= depthMm || r < 0) continue;
      const zi = Math.floor((r / depthMm) * height);
      const li = Math.floor(((a + half) / (2 * half)) * width);
      const g = gray(db[zi * width + li]!, settings.dynamicRangeDb);
      const k = (y * W + x) * 4;
      px[k] = px[k + 1] = px[k + 2] = g;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { pxPerMmZ: scale, pxPerU: scale };
}

function gray(db: number, drDb: number): number {
  const x = db / drDb + 1; // db∈[-dr,0] → [0,1]
  return Math.round(255 * Math.min(1, Math.max(0, x)));
}

/** Superpone el mapa Doppler color (rojo hacia la sonda, azul alejándose). */
export function drawColorOverlay(
  ctx: CanvasRenderingContext2D,
  vel: Float32Array,
  pow: Float32Array,
  rows: number,
  cols: number,
  scan: ScanGeometry,
  depthMm: number,
  prfHz: number,
  f0Mhz: number,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const nyq = nyquistVelocityCms(prfHz, f0Mhz * 1e6, 0);
  const img = ctx.getImageData(0, 0, W, H);
  const px = img.data;
  const mapPx = (x: number, y: number): number => (y * W + x) * 4;
  const paint = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const k = mapPx(x, y);
    px[k] = Math.round(px[k]! * (1 - a) + r * a);
    px[k + 1] = Math.round(px[k + 1]! * (1 - a) + g * a);
    px[k + 2] = Math.round(px[k + 2]! * (1 - a) + b * a);
  };
  const half = scan.widthMmOrRad / 2;
  if (scan.kind === 'linear') {
    for (let zi = 0; zi < rows; zi++) {
      for (let ci = 0; ci < cols; ci++) {
        const v = vel[zi * cols + ci]!;
        const pw = pow[zi * cols + ci]!;
        if (!Number.isFinite(v) || pw < 0.008) continue;
        const bw = Math.ceil(W / cols) + 1;
        const bh = Math.ceil(H / rows) + 1;
        const x0 = Math.floor((ci / cols) * W);
        const y0 = Math.floor((zi / rows) * H);
        const [r, g, b] = colorFor(v, nyq);
        const a = Math.min(0.9, pw * 5);
        for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) paint(x0 + dx, y0 + dy, r, g, b, a);
      }
    }
  } else {
    const cx = W / 2;
    const scale = Math.min(H * 1.15, Math.hypot(W / 2, H)) / depthMm;
    for (let zi = 0; zi < rows; zi++) {
      const zMm = ((zi + 0.5) / rows) * depthMm;
      for (let ci = 0; ci < cols; ci++) {
        const v = vel[zi * cols + ci]!;
        const pw = pow[zi * cols + ci]!;
        if (!Number.isFinite(v) || pw < 0.008) continue;
        const u = ((ci + 0.5) / cols - 0.5) * scan.widthMmOrRad;
        if (Math.abs(u) > half) continue;
        // la celda cubre el pequeño sector angular correspondiente
        const rad = Math.max(2, Math.ceil(((scale * depthMm) / rows) * 0.5));
        const x = Math.round(cx + Math.sin(u) * zMm * scale);
        const y = Math.round(Math.cos(u) * zMm * scale);
        const [r, g, b] = colorFor(v, nyq);
        for (let dy = -rad; dy <= rad; dy++)
          for (let dx = -rad; dx <= rad; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
            paint(xx, yy, r, g, b, Math.min(0.9, pw * 5));
          }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function colorFor(vCms: number, nyqCms: number): [number, number, number] {
  const x = Math.min(1, Math.abs(vCms) / nyqCms);
  const t = 60 + Math.round(195 * x);
  return vCms >= 0 ? [t, Math.round(40 * x), 0] : [0, Math.round(60 * x), t];
}

/** Espectrograma con scroll: potencia dB → grises; línea base y escala. */
export function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  columns: readonly SpectralColumn[],
  opts: {
    fftSize: number;
    baseline: number;
    f0Mhz: number;
    angleCorrectionDeg: number;
    invert: boolean;
    windowSeconds?: number;
    gainDb?: number;
    drDb?: number;
    colormap?: SpectralColormap;
    gamma?: number;
    floorPercentile?: number;
    sweepSeconds?: number;
    teachingTrace?: readonly { t: number; vCms: number }[];
  },
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const img = ctx.createImageData(W, H);
  img.data.set(
    rasterizeSpectrogram(columns, {
      width: W,
      height: H,
      fftSize: opts.fftSize,
      baseline: opts.baseline,
      invert: opts.invert,
      sweepSeconds: opts.sweepSeconds ?? opts.windowSeconds ?? 4,
      gainDb: opts.gainDb ?? 0,
      drDb: opts.drDb ?? 55,
      gamma: opts.gamma,
      floorPercentile: opts.floorPercentile,
      colormap: opts.colormap,
    }),
  );
  ctx.putImageData(img, 0, 0);
  const last = columns.at(-1);
  const prfHz = last?.prfHz ?? 0;
  const ticks =
    prfHz > 0
      ? spectralVelocityTicks(
          H,
          opts.baseline,
          opts.invert,
          prfHz,
          opts.f0Mhz * 1e6,
          (opts.angleCorrectionDeg * Math.PI) / 180,
        )
      : [];
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(W - 54, 0, 54, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  for (const tick of ticks) {
    if (tick.y < 0 || tick.y >= H) continue;
    ctx.beginPath();
    ctx.moveTo(W - 10, tick.y);
    ctx.lineTo(W - 5, tick.y);
    ctx.stroke();
    ctx.fillText(`${tick.valueCms}`, W - 12, tick.y + 3);
  }
  ctx.fillText(`±${Math.round(prfHz / 2)} Hz`, W - 4, 10);
  ctx.restore();
  // Línea de base y traza docente.
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  const yb = Math.round(opts.baseline * H);
  ctx.moveTo(0, yb);
  ctx.lineTo(W, yb);
  ctx.stroke();
  if (opts.teachingTrace && last) {
    const t0 = last.t - (opts.sweepSeconds ?? opts.windowSeconds ?? 4);
    const nyq = nyquistVelocityCms(prfHz, opts.f0Mhz * 1e6, (opts.angleCorrectionDeg * Math.PI) / 180);
    ctx.strokeStyle = '#62e88d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (const point of opts.teachingTrace) {
      if (!Number.isFinite(point.vCms) || point.t < t0) {
        started = false;
        continue;
      }
      const x = ((point.t - t0) / (opts.sweepSeconds ?? opts.windowSeconds ?? 4)) * W;
      const y = frequencyFractionToY(point.vCms / nyq, H, opts.baseline, opts.invert);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
