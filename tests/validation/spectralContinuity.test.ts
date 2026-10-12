import { describe, expect, it } from 'vitest';
import { SpectralProcessor } from '../../src/doppler/spectral';

describe('continuidad de ventanas espectrales', () => {
  for (const start of [1, -1])
    it(`no mezcla muestras a través de salto a ${start}s`, () => {
      const spectral = new SpectralProcessor({ fftSize: 32, hop: 8 });
      const chunk = new Float32Array(16).fill(1);
      spectral.sync(0, 4000);
      spectral.push(chunk, chunk, 16);
      spectral.sync(start, 4000);
      spectral.push(chunk, chunk, 16);
      expect(spectral.columns).toHaveLength(0);
      spectral.push(chunk, chunk, 16);
      expect(spectral.columns).toHaveLength(1);
      expect(spectral.columns[0]!.t).toBeGreaterThan(start);
    });
  it('conserva muestras al sincronizar bloques contiguos con redondeo flotante', () => {
    const spectral = new SpectralProcessor({ fftSize: 32, hop: 8 });
    const chunk = new Float32Array(16).fill(1);
    spectral.sync(2, 4000);
    spectral.push(chunk, chunk, 16);
    spectral.sync(2 + 16 / 4000 + 1e-12, 4000);
    spectral.push(chunk, chunk, 16);
    expect(spectral.columns).toHaveLength(1);
  });
});
