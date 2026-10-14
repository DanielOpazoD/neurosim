import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { hemodynamics, onsdForIcpMm } from '../../src/physiology/hemodynamics';
import { FISIOLOGIA } from '../../src/physiology/params';
import { radialProfileMean } from '../../src/core/flowProfile';

function extrema(state: ReturnType<typeof hemodynamics>): { min: number; max: number; mean: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  const n = 4096;
  for (let i = 0; i < n; i += 1) {
    const value = state.waveform(i / n);
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return { min, max, mean: sum / n };
}

describe('acoplamiento hemodinámico latente', () => {
  it('distingue media espacial N1 de referencias axiales 90/33 y media axial 55', () => {
    const sim = buildReferenceCase();
    const state = hemodynamics({ mapMmHg: 85, paco2MmHg: 40, icpMmHg: 10 });
    const vessel = sim.head.vessels.find((v) => v.id === 'm1-der')!;
    const w = extrema(state);
    const mean = vessel.meanSpatialCms * w.mean;
    const psv = (vessel.meanSpatialCms * w.max) / radialProfileMean();
    const edv = (vessel.meanSpatialCms * w.min) / radialProfileMean();
    expect(vessel.psvCms).toBeCloseTo(90, 0);
    expect(vessel.edvCms).toBeGreaterThan(31);
    expect(vessel.edvCms).toBeLessThanOrEqual(35);
    expect(psv).toBeGreaterThanOrEqual(89);
    expect(psv).toBeLessThanOrEqual(91);
    expect(edv).toBeGreaterThan(31);
    expect(edv).toBeLessThanOrEqual(35);
    expect(mean).toBeCloseTo(vessel.meanSpatialCms!, 0);
    expect(mean).toBeCloseTo(55 * radialProfileMean(), 2);
    expect(state.expectedPi).toBeGreaterThan(0.9);
    expect(state.expectedPi).toBeLessThan(1.1);
    expect(state.flowFactor).toBe(1);
  });

  it('aumenta PI y reduce EDV con PIC 30, pero conserva el flujo medio en meseta', () => {
    const basal = hemodynamics({ mapMmHg: 85, paco2MmHg: 40, icpMmHg: 10 });
    const highIcp = hemodynamics({ mapMmHg: 85, paco2MmHg: 40, icpMmHg: 30 });
    const b = extrema(basal);
    const h = extrema(highIcp);
    expect(highIcp.expectedPi).toBeGreaterThan(1.3);
    expect(h.min).toBeLessThan(b.min);
    expect(h.mean * highIcp.flowFactor).toBeGreaterThanOrEqual(0.9 * b.mean);
  });

  it('representa la reversión diastólica y la caída de flujo con PIC 60', () => {
    const state = hemodynamics({ mapMmHg: 85, paco2MmHg: 40, icpMmHg: 60 });
    const w = extrema(state);
    expect(state.cppMmHg).toBe(25);
    expect(w.min).toBeLessThanOrEqual(0);
    expect(w.mean * state.flowFactor).toBeLessThan(0.6);
  });

  it('aplica reactividad al CO₂ y autorregulación de Lassen', () => {
    expect(hemodynamics({ mapMmHg: 85, paco2MmHg: 30, icpMmHg: 10 }).flowFactor).toBeGreaterThanOrEqual(0.7);
    expect(hemodynamics({ mapMmHg: 85, paco2MmHg: 30, icpMmHg: 10 }).flowFactor).toBeLessThanOrEqual(0.78);
    expect(hemodynamics({ mapMmHg: 85, paco2MmHg: 50, icpMmHg: 10 }).flowFactor).toBeGreaterThanOrEqual(1.28);
    expect(hemodynamics({ mapMmHg: 85, paco2MmHg: 50, icpMmHg: 10 }).flowFactor).toBeLessThanOrEqual(1.4);
    expect(hemodynamics({ mapMmHg: 60, paco2MmHg: 40, icpMmHg: 10 }).flowFactor).toBeGreaterThanOrEqual(0.95);
    expect(hemodynamics({ mapMmHg: 45, paco2MmHg: 40, icpMmHg: 10 }).flowFactor).toBeLessThan(0.75);
  });

  it('acopla PIC estática al DVNO con saturación', () => {
    expect(onsdForIcpMm(4.6, 10)).toBeCloseTo(4.6, 8);
    expect(onsdForIcpMm(4.6, 30)).toBeGreaterThanOrEqual(5.6);
    expect(onsdForIcpMm(4.6, 30)).toBeLessThanOrEqual(6);
    expect(onsdForIcpMm(4.6, 80)).toBeLessThanOrEqual(FISIOLOGIA.params.onsdMaxMm.value);
  });

  it('cambia PIC sin cambiar la semilla ni la variabilidad del ojo', () => {
    const sim = buildReferenceCase();
    const initial = sim.eyes.der;
    sim.setPhysiology({ ...sim.patient.physiology, icpMmHg: 30 });
    expect(sim.patient.seed).toBe(buildReferenceCase().patient.seed);
    expect(sim.eyes.der.tortuosityPhaseRad).toBe(initial.tortuosityPhaseRad);
    expect(sim.eyes.der.sheathRadiusExtMm).toBeCloseTo((5.8 + 2 * initial.duraMm) / 2, 8);
    expect(sim.physStateAt(0).hemo.cppMmHg).toBe(55);
  });
});

describe('régimen de Starling con PAM ≤ CrCP + 1 (DEC-80)', () => {
  const sweep = (icp: number) => {
    const h = hemodynamics({ mapMmHg: 90, paco2MmHg: 40, icpMmHg: icp });
    const N = 512;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < N; i++) {
      const w = h.waveform(i / N) * h.flowFactor;
      sum += w;
      min = Math.min(min, w);
      max = Math.max(max, w);
    }
    return { h, mean: sum / N, min, max };
  };

  it('el caudal neto por ciclo nunca es negativo y tiende a 0 con la PPC, sin NaN', () => {
    let previous = Infinity;
    for (let icp = 10; icp <= 90; icp += 0.5) {
      const { h, mean, min, max } = sweep(icp);
      expect(Number.isFinite(mean) && Number.isFinite(min) && Number.isFinite(max)).toBe(true);
      expect(mean, `PIC ${icp}`).toBeGreaterThanOrEqual(-1e-9);
      expect(mean, `PIC ${icp}`).toBeLessThanOrEqual(h.flowFactor + 1e-9);
      expect(mean, `PIC ${icp}`).toBeLessThanOrEqual(previous + 1e-9);
      expect(h.retrogradeFraction).toBeGreaterThanOrEqual(0);
      expect(h.retrogradeFraction).toBeLessThanOrEqual(1);
      previous = mean;
    }
    expect(sweep(90).mean).toBeCloseTo(0, 9);
  });

  it('la media es continua al cruzar la frontera entre regímenes', () => {
    let crossed = false;
    for (let icp = 50; icp <= 90; icp += 0.05) {
      const a = sweep(icp);
      const b = sweep(icp + 0.05);
      if (a.h.regime !== b.h.regime) {
        crossed = true;
        expect(Math.abs(a.mean - b.mean), `frontera en PIC ${icp}`).toBeLessThan(0.02);
      }
    }
    expect(crossed).toBe(true);
  });

  it('parada circulatoria (PIC 88): espigas sistólicas, lóbulo retrógrado acotado y neto ≈ 0 (antes −0,9× nominal)', () => {
    const { h, mean, min, max } = sweep(88);
    expect(h.regime).toBe('starling');
    expect(max).toBeGreaterThan(0);
    expect(min).toBeLessThan(0);
    expect(-min).toBeLessThanOrEqual(max * 40); // el lóbulo retrógrado no domina sin límite
    expect(mean).toBeGreaterThanOrEqual(0);
    expect(mean).toBeLessThan(0.05);
  });

  it('el régimen normal no cambia: PAM 90 / PIC 10 conserva media 1·f y CrCP = PIC + tono', () => {
    const { h, mean } = sweep(10);
    expect(h.regime).toBe('normal');
    expect(h.retrogradeFraction).toBe(1);
    expect(mean).toBeCloseTo(h.flowFactor, 6);
  });
});
