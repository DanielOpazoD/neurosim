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
});
