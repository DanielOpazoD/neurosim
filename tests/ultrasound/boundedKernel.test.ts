import { describe, expect, it, vi } from 'vitest';
import { beamKernel } from '../../src/ultrasound/postIq';
// Referencia discreta anterior, independiente de la cuadratura nueva.
function gaussKernel(sigma: number) {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const w = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    w[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < w.length; i++) w[i]! /= sum;
  return { r, w };
}
describe('kernel de apertura acotado', () => {
  it('acota todas las reservas antes de construir gaussianas del ápice', () => {
    const Original = Float32Array;
    vi.stubGlobal(
      'Float32Array',
      new Proxy(Original, {
        construct(target, args) {
          if (typeof args[0] === 'number' && args[0] > 129) throw new Error(`reserva no acotada: ${args[0]}`);
          return Reflect.construct(target, args);
        },
      }),
    );
    try {
      const k = beamKernel(1e7, 0.04, 64);
      expect(k.w.length).toBe(129);
      expect(k.w.every(Number.isFinite)).toBe(true);
      expect(k.w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it.each([1, 20, 100, 2000])('conserva la mezcla normalizada del kernel completo, sigma=%s', (sigma) => {
    const main = gaussKernel(sigma),
      broad = gaussKernel(3 * sigma),
      k = beamKernel(sigma, 0.04, 64);
    const raw = Array.from({ length: k.w.length }, (_, j) => {
      const i = j - k.r;
      return Math.fround(
        0.96 * (Math.abs(i) <= main.r ? main.w[i + main.r]! : 0) +
          0.04 * (Math.abs(i) <= broad.r ? broad.w[i + broad.r]! : 0),
      );
    });
    const sum = raw.reduce((a, b) => a + b, 0);
    k.w.forEach((w, i) => expect(Math.abs(w - raw[i]! / sum)).toBeLessThan(1e-6));
  });
});
