/**
 * Presentación en canvas: pasa de datos físicos (dB, cm/s) a píxeles.
 * Aquí no hay física: solo mapeo con el rango dinámico y las paletas.
 */
import type { BModeFrame } from '../ultrasound/bmode';
import type { GrayMap } from '../domain/contracts';
import type { SpectralColumn } from '../doppler/spectral';
import type { ScanGeometry } from '../ultrasound/probe';
import type { ColorBox } from '../domain/contracts';
import { pixelToImage, scanConvert } from './scanConvert';
import { nyquistVelocityCms } from '../core/units';
import { smoothstep } from '../core/vec3';
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
  settings: { dynamicRangeDb: number; grayMap?: GrayMap },
): { pxPerMmZ: number; pxPerU: number } {
  const { scan, depthMm } = frame;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const img = ctx.createImageData(W, H);
  img.data.set(scanConvert(frame, settings, W, H));
  ctx.putImageData(img, 0, 0);
  return scan.kind === 'linear'
    ? { pxPerMmZ: H / depthMm, pxPerU: W / scan.widthMmOrRad }
    : {
        pxPerMmZ: Math.min(H * 1.15, Math.hypot(W / 2, H)) / depthMm,
        pxPerU: Math.min(H * 1.15, Math.hypot(W / 2, H)) / depthMm,
      };
}

export interface ColorOverlayGrid {
  readonly vel: Float32Array;
  readonly pow: Float32Array;
  readonly rows: number;
  readonly cols: number;
  readonly box: ColorBox;
}

/**
 * Superpone el mapa Doppler color solo dentro de la caja: recorre los píxeles
 * de salida, muestrea la malla vel/pow por bilineal y respeta al B-mode
 * brillante (tejido sobre color).
 */
export function drawColorOverlay(
  ctx: CanvasRenderingContext2D,
  color: ColorOverlayGrid,
  scan: ScanGeometry,
  depthMm: number,
  prfHz: number,
  f0Mhz: number,
): void {
  const { vel, pow, rows, cols, box } = color;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const nyq = nyquistVelocityCms(prfHz, f0Mhz * 1e6, 0);
  const img = ctx.getImageData(0, 0, W, H);
  const px = img.data;
  const zSpan = Math.max(1e-9, box.zMaxMm - box.zMinMm);
  const uSpan = Math.max(1e-9, box.uHalf * 2);
  const nz = rows - 1;
  const nu = cols - 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = pixelToImage(scan, depthMm, W, H, x, y);
      if (!p) continue;
      const fzi = ((p.z - box.zMinMm) / zSpan) * rows - 0.5;
      const fci = ((p.u - box.uCenter) / uSpan + 0.5) * cols - 0.5;
      if (fzi < 0 || fzi > nz || fci < 0 || fci > nu) continue;
      const zi0 = Math.min(nz - 1, Math.floor(fzi));
      const ci0 = Math.min(nu - 1, Math.floor(fci));
      const fz = fzi - zi0;
      const fc = fci - ci0;
      // Bilineal; la velocidad se pondera por potencia y un nodo NaN cuenta
      // como potencia 0 para no contaminar a los vecinos.
      let pInterp = 0;
      let vNum = 0;
      let vDen = 0;
      for (let dz = 0; dz <= 1; dz++) {
        for (let dc = 0; dc <= 1; dc++) {
          const w = (dz ? fz : 1 - fz) * (dc ? fc : 1 - fc);
          const idx = (zi0 + dz) * cols + ci0 + dc;
          const pw = Number.isFinite(vel[idx]!) ? pow[idx]! : 0;
          pInterp += w * pw;
          vNum += w * pw * (pw > 0 ? vel[idx]! : 0);
          vDen += w * pw;
        }
      }
      if (pInterp < 0.02 || vDen <= 0) continue;
      const k = (y * W + x) * 4;
      if (px[k]! > 170) continue;
      const v = vNum / vDen;
      const [r, g, b] = colorDopplerRgb(v, nyq);
      const a = smoothstep(0.02, 0.15, pInterp) * 0.95;
      px[k] = Math.round(px[k]! * (1 - a) + r * a);
      px[k + 1] = Math.round(px[k + 1]! * (1 - a) + g * a);
      px[k + 2] = Math.round(px[k + 2]! * (1 - a) + b * a);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Paleta Doppler pura: +v (hacia la sonda) rojo→naranja→amarillo,
 * −v azul→celeste→cian; por debajo de 0.15·Nyquist queda en versión tenue.
 */
export function colorDopplerRgb(vCms: number, nyqCms: number): [number, number, number] {
  const x = Math.min(1, Math.abs(vCms) / Math.max(1e-9, nyqCms));
  const dim = x < 0.15 ? 0.45 : 1;
  const t = Math.min(1, Math.max(0, (x - 0.15) / 0.85));
  if (vCms >= 0) {
    return [Math.round(255 * dim), Math.round((40 + 160 * t) * dim), Math.round(60 * t * dim)];
  }
  return [Math.round(60 * t * dim), Math.round((60 + 160 * t) * dim), Math.round(255 * dim)];
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
    floorOffsetDb?: number;
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
      floorOffsetDb: opts.floorOffsetDb,
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
