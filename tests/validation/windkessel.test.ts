import { describe, expect, it } from 'vitest';
import { FISIOLOGIA, arterialShapeTable, arterialShapeMean } from '../../src/physiology/params';
import { sampleShape, windkesselShapeTable } from '../../src/physiology/windkessel';

describe('onda arterial Windkessel', () => {
  it('queda normalizada, con media clínica y pico precoz', () => {
    const table = arterialShapeTable;
    const min = Math.min(...table);
    const max = Math.max(...table);
    const mean = arterialShapeMean();
    const peak = table.indexOf(max) / table.length;
    expect(min).toBeCloseTo(0, 6);
    expect(max).toBeCloseTo(1, 6);
    expect(mean).toBeGreaterThanOrEqual(0.34);
    expect(mean).toBeLessThanOrEqual(0.39);
    expect(peak).toBeLessThan(0.2);
  });

  it('muestra una incisura dicrota y desaparece sin reflujo', () => {
    const p = {
      periodS: 60 / FISIOLOGIA.params.heartRateBpm.value,
      ejectionFraction: FISIOLOGIA.params.ejectionFraction.value,
      tauS: FISIOLOGIA.params.windkesselTauS.value,
      backflowFraction: FISIOLOGIA.params.backflowFraction.value,
      backflowDurationFraction: FISIOLOGIA.params.backflowDurationFraction.value,
    };
    const table = windkesselShapeTable(p);
    const peak = table.indexOf(Math.max(...table));
    let minima = 0;
    let maxima = 0;
    for (let i = peak + 1; i < Math.floor(table.length / 2); i += 1) {
      if (table[i]! < table[i - 1]! && table[i]! <= table[i + 1]!) minima += 1;
      if (table[i]! > table[i - 1]! && table[i]! >= table[i + 1]!) maxima += 1;
    }
    expect(minima).toBeGreaterThan(0);
    expect(maxima).toBeGreaterThan(0);
    const noBackflow = windkesselShapeTable({ ...p, backflowFraction: 0 });
    let extrema = 0;
    for (let i = peak + 1; i < Math.floor(noBackflow.length / 2); i += 1) {
      if (noBackflow[i]! < noBackflow[i - 1]! && noBackflow[i]! <= noBackflow[i + 1]!) extrema += 1;
      if (noBackflow[i]! > noBackflow[i - 1]! && noBackflow[i]! >= noBackflow[i + 1]!) extrema += 1;
    }
    expect(extrema).toBe(0);
  });

  it('conserva PI cercano a uno para PSV/EDV N1', () => {
    const meanVelocity = 35 + (90 - 35) * arterialShapeMean();
    expect((90 - 35) / meanVelocity).toBeGreaterThanOrEqual(0.9);
    expect((90 - 35) / meanVelocity).toBeLessThanOrEqual(1.1);
    expect(sampleShape(arterialShapeTable, 1.25)).toBeCloseTo(sampleShape(arterialShapeTable, 0.25), 5);
  });
});
