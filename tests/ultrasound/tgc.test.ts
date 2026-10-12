import { describe, expect, it } from 'vitest';
import { applyPsfAndCompression } from '../../src/ultrasound/postIq';
import { probeBeamSpec } from '../../src/ultrasound/beam';
import { buildScan } from '../../src/ultrasound/probe';
import { defaultEyeSettings } from '../../src/domain/settings';

const scan = buildScan(
  { origin: [0, 0, 0], forward: [0, 0, 1], lateral: [1, 0, 0], markerAngleRad: 0, contactPressure: 0 },
  'linear',
  5,
);
function db(tgcDb: number[]) {
  const settings = { ...defaultEyeSettings(), depthMm: 10, tgcDb };
  return applyPsfAndCompression(
    new Float32Array(5 * 7 * 2).fill(1),
    5,
    7,
    2,
    scan,
    settings,
    probeBeamSpec('linear', settings),
  ).db;
}
describe('TGC en coordenadas físicas', () => {
  it('una sola banda aplica ganancia uniforme en todas las profundidades', () => {
    const ref = db([0, 0]),
      result = db([12]);
    result.forEach((v, i) => expect(v - ref[i]!).toBeCloseTo(12, 4));
  });
  it('mantiene la banda final a la profundidad límite y más allá', () => {
    const ref = db([0, 0]),
      result = db([-10, 10]);
    for (let row = 0; row < 7; row++)
      expect(result[row * 5]! - ref[row * 5]!).toBeCloseTo(Math.min(10, -10 + row * 4), 4);
  });
  it('sin bandas equivale a cero TGC', () => {
    expect(db([])).toEqual(db([0, 0]));
  });
});
