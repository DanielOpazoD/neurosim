import { describe, expect, it } from 'vitest';
import { arterialShapeTable } from '../../src/physiology/params';
import { sampleShape } from '../../src/physiology/windkessel';
import { measureBeats } from '../../src/doppler/measureMca';

describe('estimador PW robusto a dropouts de columna', () => {
  it('estima EDV desde el percentil 10 sin dejar que un dropout lo fije', () => {
    const samples = 32;
    const periodS = 60 / 70;
    const trace = Array.from({ length: samples }, (_, i) => {
      const t = (i * periodS) / samples;
      const value = 35 + 55 * sampleShape(arterialShapeTable, t / periodS);
      return { t, vCms: value };
    });
    trace[7]!.vCms = 0;
    trace[19]!.vCms = Number.NaN;

    const [measure] = measureBeats(trace, [{ tStart: 0, rr: periodS }]);

    expect(measure).toBeDefined();
    expect(measure!.edvCms).toBeGreaterThan(35 * 0.95);
    expect(measure!.edvCms).toBeLessThan(35 * 1.05);
    expect(measure!.psvCms).toBeGreaterThan(90 * 0.98);
    expect(measure!.psvCms).toBeLessThan(90 * 1.02);
    expect(measure!.pi).toBeCloseTo((90 - 35) / measure!.taMaxCms, 1);
  });
});
