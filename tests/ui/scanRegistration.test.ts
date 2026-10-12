import { expect, it } from 'vitest';
import { buildScan } from '../../src/ultrasound/probe';
import { pixelToImage, scanConvert } from '../../src/ui/scanConvert';

for (const kind of ['linear', 'sector'] as const)
  it(`registra una rampa física ${kind} en su profundidad y lateral reales`, () => {
    const scan = buildScan(
      { origin: [0, 0, 0], forward: [0, 0, 1], lateral: [1, 0, 0], markerAngleRad: 0, contactPressure: 0 },
      kind,
      5,
    );
    const db = new Float32Array(25);
    for (let z = 0; z < 5; z++)
      for (let x = 0; x < 5; x++) {
        const u = (x / 4 - 0.5) * scan.widthMmOrRad;
        db[z * 5 + x] = -50 + 2 * z * 2 + (6 * u) / scan.widthMmOrRad;
      }
    const data = scanConvert(
      { width: 5, height: 5, db, iq: new Float32Array(50), dzMm: 2, depthMm: 10, scan },
      { dynamicRangeDb: 60 },
      100,
      100,
    );
    let tested = 0;
    for (let y = 10; y < 65; y += 10)
      for (let x = 25; x < 80; x += 10) {
        const p = pixelToImage(scan, 10, 100, 100, x, y);
        if (!p || p.z > 8) continue;
        const expected = Math.round((1 + (-50 + 2 * p.z + (6 * p.u) / scan.widthMmOrRad) / 60) * 255);
        expect(data[(y * 100 + x) * 4]).toBeCloseTo(expected, 0);
        tested++;
      }
    expect(tested).toBeGreaterThan(10);
  });
