import { describe, expect, it } from 'vitest';
import { FISIOLOGIA } from '../../src/physiology/params';
import { Respiration } from '../../src/physiology/respiration';
import { CardiacCycle } from '../../src/physiology/flow';

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((sum, value) => sum + value, 0) / a.length;
  const mb = b.reduce((sum, value) => sum + value, 0) / b.length;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  return ab / Math.sqrt(aa * bb);
}

describe('agenda cardíaca HRV + RSA', () => {
  it('es determinista y phaseAt coincide con beatsIn', () => {
    const respiration = new Respiration(FISIOLOGIA.params.respiratoryRatePerMin.value);
    const a = new CardiacCycle(70, 1234, respiration);
    const b = new CardiacCycle(70, 1234, respiration);
    expect(a.beatsIn(0, 30)).toEqual(b.beatsIn(0, 30));
    for (const beat of a.beatsIn(0, 10)) {
      expect(a.phaseAt(beat.tStart)).toBeCloseTo(0, 8);
      expect(a.phaseAt(beat.tStart + beat.rr * (1 - 1e-6))).toBeCloseTo(1, 4);
    }
  });

  it('mantiene RR medio, variabilidad fisiológica y componente RSA', () => {
    const respiration = new Respiration(FISIOLOGIA.params.respiratoryRatePerMin.value);
    const cycle = new CardiacCycle(70, 9876, respiration);
    const beats = cycle.beatsIn(0, 600);
    const rrs = beats.map((beat) => beat.rr);
    const mean = rrs.reduce((sum, value) => sum + value, 0) / rrs.length;
    const sd = Math.sqrt(rrs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rrs.length);
    const respiratory = beats.map((beat) => respiration.signalAt(beat.tStart));
    expect(mean).toBeGreaterThan((60 / 70) * 0.99);
    expect(mean).toBeLessThan((60 / 70) * 1.01);
    expect(sd / mean).toBeGreaterThanOrEqual(0.01);
    expect(sd / mean).toBeLessThanOrEqual(0.06);
    expect(correlation(rrs, respiratory)).toBeGreaterThan(0.3);
  });
});

describe('respiración', () => {
  it('es periódica y produce modulación dentro de ±3 %', () => {
    const respiration = new Respiration(14);
    expect(respiration.phaseAt(0)).toBeCloseTo(respiration.phaseAt(respiration.periodS), 8);
    expect(respiration.signalAt(0.2)).toBeCloseTo(respiration.signalAt(0.2 + respiration.periodS), 8);
    const modulation = Array.from({ length: 100 }, (_, i) => 1 + 0.03 * respiration.signalAt(i / 13));
    expect(Math.min(...modulation)).toBeGreaterThanOrEqual(0.97);
    expect(Math.max(...modulation)).toBeLessThanOrEqual(1.03);
    expect(respiration.phaseAt(-0.1)).toBeGreaterThanOrEqual(0);
    expect(respiration.phaseAt(-0.1)).toBeLessThan(1);
  });
});
