import { describe, expect, it } from 'vitest';
import { arterialShapeTable } from '../../src/physiology/params';
import { sampleShape } from '../../src/physiology/windkessel';
import { measureBeats, summarizeBeats } from '../../src/doppler/measureMca';

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

  it('excluye un latido con cobertura inferior al 80 % del RR', () => {
    const periodS = 60 / 70;
    const trace = Array.from({ length: 17 }, (_, i) => ({
      t: (i * periodS) / 32,
      vCms: 50,
    }));

    expect(measureBeats(trace, [{ tStart: 0, rr: periodS }])).toEqual([]);
  });

  it('deriva PI e IR de las medianas resumidas', () => {
    const summary = summarizeBeats([
      { tStart: 0, rrS: 1, psvCms: 100, edvCms: 20, taMaxCms: 40, pi: 99, ri: 99, sign: 1 },
      { tStart: 1, rrS: 1, psvCms: 80, edvCms: 30, taMaxCms: 50, pi: 88, ri: 88, sign: 1 },
      { tStart: 2, rrS: 1, psvCms: 90, edvCms: 25, taMaxCms: 45, pi: 77, ri: 77, sign: 1 },
    ]);

    expect(summary).not.toBeNull();
    expect(summary!.psvCms).toBe(90);
    expect(summary!.edvCms).toBe(25);
    expect(summary!.taMaxCms).toBe(45);
    expect(summary!.pi).toBeCloseTo((90 - 25) / 45);
    expect(summary!.ri).toBeCloseTo((90 - 25) / 90);
  });
});
