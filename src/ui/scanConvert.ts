import type { BModeFrame } from '../ultrasound/bmode';
import type { ScanGeometry } from '../ultrasound/probe';
import type { GrayMap } from '../domain/contracts';

export interface ScanConvertOptions {
  readonly dynamicRangeDb: number;
  /** Mapa de grises de presentación (por defecto 'lineal'). */
  readonly grayMap?: GrayMap;
}

const GRAY_MAP_CODE: Record<GrayMap, number> = { lineal: 0, sigmoide: 1, gamma: 2 };

/**
 * Píxel de salida → coordenadas de imagen (z mm, u mm/rad).
 * `null` fuera del sector o la profundidad; lineal siempre devuelve el punto.
 */
export function pixelToImage(
  scan: Pick<ScanGeometry, 'kind' | 'widthMmOrRad'>,
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

/**
 * Tabla de conversión de barrido precalculada (DEC-54): para cada píxel de
 * salida, los cuatro vecinos y pesos bilineales de la malla fuente, y sus
 * coordenadas de imagen (z, u) para la superposición de color. Depende solo
 * de (tipo de sonda, ancho lateral, profundidad, tamaño de malla y de
 * canvas) — no de la pose — así que se reutiliza fotograma a fotograma y
 * evita `atan2`/`hypot` por píxel. Los valores son exactamente los que
 * calculaba el muestreo bilineal por píxel (salida bit a bit idéntica).
 */
export interface ScanLut {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /** Índice fuente (y0·sw + x0) por píxel; −1 = fuera del sector. */
  readonly i00: Int32Array;
  /** Desplazamientos al vecino x1 (0/1) e y1 (0/sw). */
  readonly dx: Int32Array;
  readonly dy: Int32Array;
  readonly tx: Float64Array;
  readonly ty: Float64Array;
  /** Coordenadas de imagen por píxel (NaN fuera del sector). */
  readonly z: Float64Array;
  readonly u: Float64Array;
}

const lutCache = new Map<string, ScanLut>();
const LUT_CACHE_MAX = 6;

export function scanLut(
  scan: Pick<ScanGeometry, 'kind' | 'widthMmOrRad'>,
  depthMm: number,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): ScanLut {
  const key = `${scan.kind}|${scan.widthMmOrRad}|${depthMm}|${sourceWidth}x${sourceHeight}|${width}x${height}`;
  const cached = lutCache.get(key);
  if (cached) return cached;
  const n = width * height;
  const i00 = new Int32Array(n).fill(-1);
  const dx = new Int32Array(n);
  const dy = new Int32Array(n);
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const z = new Float64Array(n).fill(Number.NaN);
  const u = new Float64Array(n).fill(Number.NaN);
  const set = (k: number, fli: number, fzi: number): void => {
    // Mismo cálculo que el bilineal con recorte de bordes original.
    const xx = Math.min(Math.max(fli, 0), sourceWidth - 1);
    const yy = Math.min(Math.max(fzi, 0), sourceHeight - 1);
    const x0 = Math.floor(xx);
    const y0 = Math.floor(yy);
    const x1 = Math.min(sourceWidth - 1, x0 + 1);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    i00[k] = y0 * sourceWidth + x0;
    dx[k] = x1 - x0;
    dy[k] = (y1 - y0) * sourceWidth;
    tx[k] = xx - x0;
    ty[k] = yy - y0;
  };
  if (scan.kind === 'linear') {
    const sx = width / sourceWidth;
    const sy = height / sourceHeight;
    for (let y = 0; y < height; y++) {
      const fzi = (y + 0.5) / sy - 0.5;
      for (let x = 0; x < width; x++) {
        const k = y * width + x;
        set(k, (x + 0.5) / sx - 0.5, fzi);
        const p = pixelToImage(scan, depthMm, width, height, x, y)!;
        z[k] = p.z;
        u[k] = p.u;
      }
    }
  } else {
    const half = scan.widthMmOrRad / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = pixelToImage(scan, depthMm, width, height, x, y);
        if (!p) continue;
        const k = y * width + x;
        set(k, ((p.u + half) / (2 * half)) * sourceWidth - 0.5, (p.z / depthMm) * sourceHeight - 0.5);
        z[k] = p.z;
        u[k] = p.u;
      }
    }
  }
  const lut: ScanLut = { key, width, height, i00, dx, dy, tx, ty, z, u };
  if (lutCache.size >= LUT_CACHE_MAX) lutCache.delete(lutCache.keys().next().value!);
  lutCache.set(key, lut);
  return lut;
}

/** Conversión de barrido sobre un buffer RGBA existente (fondo negro opaco). */
export function scanConvertInto(
  frame: BModeFrame,
  opts: ScanConvertOptions,
  out: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const { width: sourceWidth, height: sourceHeight, db, scan, depthMm } = frame;
  const lut = scanLut(scan, depthMm, sourceWidth, sourceHeight, width, height);
  const { i00, dx, dy, tx, ty } = lut;
  const dr = opts.dynamicRangeDb;
  const map = GRAY_MAP_CODE[opts.grayMap ?? 'lineal'];
  const n = width * height;
  for (let k = 0; k < n; k++) {
    const o = k * 4;
    const base = i00[k]!;
    if (base < 0) {
      out[o] = out[o + 1] = out[o + 2] = 0;
      out[o + 3] = 255;
      continue;
    }
    const ddx = dx[k]!;
    const ddy = dy[k]!;
    const fx = tx[k]!;
    const fy = ty[k]!;
    const a = db[base]!;
    const b = db[base + ddx]!;
    const c = db[base + ddy]!;
    const d = db[base + ddy + ddx]!;
    const v = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    out[o] = out[o + 1] = out[o + 2] = gray(v, dr, map);
    out[o + 3] = 255;
  }
}

export function scanConvert(
  frame: BModeFrame,
  opts: ScanConvertOptions,
  width: number,
  height: number,
): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  scanConvertInto(frame, opts, px, width, height);
  return px;
}

function gray(db: number, dynamicRangeDb: number, map: number): number {
  const x = Math.min(1, Math.max(0, db / dynamicRangeDb + 1));
  // Mapas compartidos con scanConvert.frag.glsl (uGrayMap): mantener idénticos.
  let v: number;
  if (map === 1) v = 0.5 * x + 0.5 * x * x * (3 - 2 * x);
  else if (map === 2) v = Math.pow(x, 0.8);
  else v = x;
  return Math.round(255 * v);
}
