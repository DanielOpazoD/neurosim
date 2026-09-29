import { describe, expect, it } from 'vitest';
import { renderBMode } from '../../src/ultrasound/bmode';
import { buildScan } from '../../src/ultrasound/probe';
import { defaultEyeSettings } from '../../src/domain/settings';
import { pixelToImage, scanConvert, scanLut } from '../../src/ui/scanConvert';
import { colorDopplerRgb, compositeColorOverlay } from '../../src/ui/canvasDraw';
import { nyquistVelocityCms } from '../../src/core/units';
import { smoothstep } from '../../src/core/vec3';

describe('scanConvert', () => {
  it('es determinista y conserva alpha opaco en una sonda lineal', () => {
    const settings = { ...defaultEyeSettings(), depthMm: 12 };
    const scan = buildScan(
      {
        origin: [0, 0, 0],
        forward: [0, 0, 1],
        lateral: [1, 0, 0],
        markerAngleRad: 0,
        contactPressure: 0.3,
      },
      'linear',
      8,
    );
    const frame = renderBMode({ classify: () => 'vitrio' }, scan, settings, 'scan-convert', {
      axialStepMm: 1,
      speckle: false,
      electronicNoise: false,
    });
    const first = scanConvert(frame, { dynamicRangeDb: settings.dynamicRangeDb }, 32, 24);
    const second = scanConvert(frame, { dynamicRangeDb: settings.dynamicRangeDb }, 32, 24);
    expect(first).toEqual(second);
    for (let i = 3; i < first.length; i += 4) expect(first[i]).toBe(255);
  });

  it('los mapas de grises son monótonos y conservan los extremos', () => {
    const scan = {
      kind: 'linear' as const,
      widthMmOrRad: 8,
      apex: [0, 0, 0] as [number, number, number],
      lines: [],
      lateralDir: [1, 0, 0] as [number, number, number],
      axialDir: [0, 0, 1] as [number, number, number],
    };
    // Rampa de dB de −DR a 0 → x ∈ [0, 1] sobre una fila de 64 px.
    const db = new Float32Array(64);
    for (let i = 0; i < 64; i += 1) db[i] = -60 + (60 * i) / 63;
    const frame = {
      width: 64,
      height: 1,
      db,
      iq: new Float32Array(128),
      depthMm: 10,
      dzMm: 10,
      scan: scan as never,
    };
    for (const grayMap of ['lineal', 'sigmoide', 'gamma'] as const) {
      const px = scanConvert(frame, { dynamicRangeDb: 60, grayMap }, 64, 1);
      expect(px[0]).toBe(0); // x=0 → 0
      expect(px[63 * 4 + 0]).toBe(255); // x=1 → 255
      for (let i = 1; i < 64; i += 1) {
        expect(px[i * 4]!).toBeGreaterThanOrEqual(px[(i - 1) * 4]!); // monótono
      }
    }
  });
});

/* Referencia por píxel previa a la LUT (DEC-54): la tabla precalculada debe
 * producir exactamente los mismos bytes. */
function referenceBilinear(db: Float32Array, sw: number, sh: number, fli: number, fzi: number): number {
  const x = Math.min(Math.max(fli, 0), sw - 1);
  const y = Math.min(Math.max(fzi, 0), sh - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(sw - 1, x0 + 1);
  const y1 = Math.min(sh - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = db[y0 * sw + x0]!;
  const b = db[y0 * sw + x1]!;
  const c = db[y1 * sw + x0]!;
  const d = db[y1 * sw + x1]!;
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

function referenceGray(db: number, dr: number): number {
  const x = Math.min(1, Math.max(0, db / dr + 1));
  return Math.round(255 * (0.5 * x + 0.5 * x * x * (3 - 2 * x)));
}

function referenceScanConvert(
  kind: 'linear' | 'sector',
  widthMmOrRad: number,
  db: Float32Array,
  sw: number,
  sh: number,
  depthMm: number,
  W: number,
  H: number,
): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let fli: number;
      let fzi: number;
      if (kind === 'linear') {
        fli = (x + 0.5) / (W / sw) - 0.5;
        fzi = (y + 0.5) / (H / sh) - 0.5;
      } else {
        const p = pixelToImage({ kind, widthMmOrRad }, depthMm, W, H, x, y);
        if (!p) continue;
        fzi = (p.z / depthMm) * sh - 0.5;
        fli = ((p.u + widthMmOrRad / 2) / widthMmOrRad) * sw - 0.5;
      }
      const g = referenceGray(referenceBilinear(db, sw, sh, fli, fzi), 60);
      const k = (y * W + x) * 4;
      px[k] = px[k + 1] = px[k + 2] = g;
    }
  }
  return px;
}

describe('LUT de conversión de barrido (DEC-54)', () => {
  const sw = 37;
  const sh = 53;
  const db = new Float32Array(sw * sh);
  for (let i = 0; i < db.length; i++) db[i] = -60 * Math.abs(Math.sin(i * 12.9898) * 0.999);
  for (const [kind, widthMmOrRad] of [
    ['linear', 38],
    ['sector', (80 * Math.PI) / 180],
  ] as const) {
    it(`es bit a bit idéntica al muestreo por píxel (${kind})`, () => {
      const frame = {
        width: sw,
        height: sh,
        db,
        iq: new Float32Array(2 * sw * sh),
        depthMm: 45,
        dzMm: 45 / sh,
        scan: { kind, widthMmOrRad } as never,
      };
      const got = scanConvert(frame, { dynamicRangeDb: 60, grayMap: 'sigmoide' }, 97, 71);
      expect(got).toEqual(referenceScanConvert(kind, widthMmOrRad, db, sw, sh, 45, 97, 71));
    });

    it(`la superposición de color con LUT coincide con la ruta por píxel (${kind})`, () => {
      const rows = 12;
      const cols = 9;
      const vel = new Float32Array(rows * cols);
      const pow = new Float32Array(rows * cols);
      for (let i = 0; i < vel.length; i++) {
        vel[i] = i % 7 === 0 ? Number.NaN : 40 * Math.sin(i * 1.7);
        pow[i] = Math.abs(Math.cos(i * 0.9));
      }
      const box =
        kind === 'linear'
          ? { uCenter: 1, uHalf: 10, zMinMm: 12, zMaxMm: 36 }
          : { uCenter: 0.05, uHalf: 0.4, zMinMm: 10, zMaxMm: 40 };
      const W = 97;
      const H = 71;
      const base = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < base.length; i++) base[i] = (i * 37) % 256;
      const got = base.slice();
      const lut = scanLut({ kind, widthMmOrRad }, 45, sw, sh, W, H);
      compositeColorOverlay(got, W, H, { vel, pow, rows, cols, box }, lut, 4000, 2);
      // Referencia: bucle por píxel con pixelToImage (implementación previa).
      const ref = base.slice();
      const nyq = nyquistVelocityCms(4000, 2e6, 0);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = pixelToImage({ kind, widthMmOrRad }, 45, W, H, x, y);
          if (!p) continue;
          const fzi = ((p.z - box.zMinMm) / (box.zMaxMm - box.zMinMm)) * rows - 0.5;
          const fci = ((p.u - box.uCenter) / (box.uHalf * 2) + 0.5) * cols - 0.5;
          if (fzi < 0 || fzi > rows - 1 || fci < 0 || fci > cols - 1) continue;
          const zi0 = Math.min(rows - 2, Math.floor(fzi));
          const ci0 = Math.min(cols - 2, Math.floor(fci));
          let pI = 0;
          let vN = 0;
          let vD = 0;
          for (let dz = 0; dz <= 1; dz++) {
            for (let dc = 0; dc <= 1; dc++) {
              const w = (dz ? fzi - zi0 : 1 - (fzi - zi0)) * (dc ? fci - ci0 : 1 - (fci - ci0));
              const idx = (zi0 + dz) * cols + ci0 + dc;
              const pw = Number.isFinite(vel[idx]!) ? pow[idx]! : 0;
              pI += w * pw;
              vN += w * pw * (pw > 0 ? vel[idx]! : 0);
              vD += w * pw;
            }
          }
          if (pI < 0.02 || vD <= 0) continue;
          const k = (y * W + x) * 4;
          if (ref[k]! > 170) continue;
          const [r, g, b] = colorDopplerRgb(vN / vD, nyq);
          const a = smoothstep(0.02, 0.15, pI) * 0.95;
          ref[k] = Math.round(ref[k]! * (1 - a) + r * a);
          ref[k + 1] = Math.round(ref[k + 1]! * (1 - a) + g * a);
          ref[k + 2] = Math.round(ref[k + 2]! * (1 - a) + b * a);
        }
      }
      expect(got).toEqual(ref);
      expect(got).not.toEqual(base);
    });
  }
});
