import { describe, expect, it } from 'vitest';
import { renderBMode } from '../../src/ultrasound/bmode';
import { buildScan } from '../../src/ultrasound/probe';
import { defaultEyeSettings } from '../../src/domain/settings';
import { scanConvert } from '../../src/ui/scanConvert';

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
