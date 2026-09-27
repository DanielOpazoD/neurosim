import { describe, expect, it } from 'vitest';
import type { SpectralColumn } from '../../src/doppler/spectral';
import { rasterizeSpectrogram } from '../../src/ui/spectrogramRaster';

function column(t: number, values: number[]): SpectralColumn {
  return { t, prfHz: 4000, powerDb: Float32Array.from(values) };
}

function grayAt(rgba: Uint8ClampedArray, width: number, x: number, y: number): number {
  return rgba[(y * width + x) * 4]!;
}

describe('rasterización pura del espectrograma', () => {
  it('pinta todas las filas incluso con ruido constante', () => {
    const rgba = rasterizeSpectrogram([column(0, Array(32).fill(-30)), column(0.1, Array(32).fill(-30))], {
      width: 8,
      height: 40,
      fftSize: 32,
      baseline: 0.5,
      invert: false,
      sweepSeconds: 1,
      gainDb: 0,
      drDb: 55,
    });
    for (let y = 0; y < 40; y++) expect(grayAt(rgba, 8, 3, y)).toBeGreaterThan(0);
  });

  it.each([0.5, 0.7])('coloca un tono en la fila esperada con baseline %s', (baseline) => {
    const powers = Array(64).fill(-50);
    powers[40] = 0;
    const rgba = rasterizeSpectrogram([column(0, powers)], {
      width: 1,
      height: 100,
      fftSize: 64,
      baseline,
      invert: false,
      sweepSeconds: 1,
      gainDb: 0,
      drDb: 55,
    });
    let maximum = 0;
    let maximumY = 0;
    for (let y = 0; y < 100; y++) {
      const value = grayAt(rgba, 1, 0, y);
      if (value > maximum) {
        maximum = value;
        maximumY = y;
      }
    }
    const expected = baseline * 100 - ((40 - 32) / 32) * baseline * 100;
    expect(Math.abs(maximumY - expected)).toBeLessThanOrEqual(1);
  });

  it('mantiene la monotonía de la compresión', () => {
    const low = rasterizeSpectrogram([column(0, Array(16).fill(-40))], {
      width: 1,
      height: 8,
      fftSize: 16,
      baseline: 0.5,
      invert: false,
      sweepSeconds: 1,
      gainDb: 0,
      drDb: 55,
    });
    const high = rasterizeSpectrogram([column(0, Array(16).fill(-20))], {
      width: 1,
      height: 8,
      fftSize: 16,
      baseline: 0.5,
      invert: false,
      sweepSeconds: 1,
      gainDb: 0,
      drDb: 55,
    });
    for (let y = 0; y < 8; y++) expect(grayAt(high, 1, 0, y)).toBeGreaterThanOrEqual(grayAt(low, 1, 0, y));
  });

  it('excluye columnas anteriores al barrido', () => {
    const old = column(0, Array(16).fill(10));
    const recent = column(3, Array(16).fill(-40));
    const opts = {
      width: 4,
      height: 8,
      fftSize: 16,
      baseline: 0.5,
      invert: false,
      sweepSeconds: 1,
      gainDb: 0,
      drDb: 55,
    };
    expect(rasterizeSpectrogram([old, recent], opts)).toEqual(rasterizeSpectrogram([recent], opts));
  });

  it('es determinista', () => {
    const input = [
      column(
        0,
        Array.from({ length: 32 }, (_, i) => i - 30),
      ),
      column(1, Array(32).fill(-20)),
    ];
    const opts = {
      width: 12,
      height: 24,
      fftSize: 32,
      baseline: 0.7,
      invert: true,
      sweepSeconds: 2,
      gainDb: 4,
      drDb: 55,
      colormap: 'ambar' as const,
    };
    expect(rasterizeSpectrogram(input, opts)).toEqual(rasterizeSpectrogram(input, opts));
  });
});
