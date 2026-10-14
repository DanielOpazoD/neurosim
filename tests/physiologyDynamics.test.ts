import { describe, expect, it } from 'vitest';
import { RegulationDynamics } from '../src/physiology/dynamics';
import { autoregulationFactor, co2Factor, hemodynamics } from '../src/physiology/hemodynamics';
import { FISIOLOGIA } from '../src/physiology/params';
import { buildReferenceCase } from '../src/domain/referenceCase';

const BASAL = { heartRateBpm: 70, mapMmHg: 90, paco2MmHg: 40, icpMmHg: 10 };
const TAU = FISIOLOGIA.params.autoregTauS.value;
const CO2_TAU = FISIOLOGIA.params.co2TauS.value;
const CO2_DELAY = FISIOLOGIA.params.co2DelayS.value;

describe('dinámica de la regulación (DEC-81)', () => {
  it('sin atS el cambio es instantáneo y coincide con el estado estacionario previo', () => {
    const d = new RegulationDynamics(BASAL);
    d.setTarget({ ...BASAL, mapMmHg: 70 });
    const h = d.hemodynamicsAt(123);
    const ref = hemodynamics({ mapMmHg: 70, paco2MmHg: 40, icpMmHg: 10 });
    expect(h.flowFactor).toBeCloseTo(ref.flowFactor, 9);
    expect(h.crcpMmHg).toBeCloseTo(ref.crcpMmHg, 9);
    expect(d.settledAt(123)).toBe(true);
    expect(d.hemodynamicsAt(123)).toBe(d.steadyState);
  });

  it('escalón de PAM 90→70: flujo pasivo a la presión al instante y recuperación con τ hacia el estacionario', () => {
    const d = new RegulationDynamics(BASAL);
    const t0 = 10;
    const before = d.hemodynamicsAt(t0 - 0.01).flowFactor;
    d.setTarget({ ...BASAL, mapMmHg: 70 }, t0);
    const steady = autoregulationFactor(60) * co2Factor(40);
    const passive = (60 / 80) * before; // resistencia aún la basal
    const f0 = d.hemodynamicsAt(t0).flowFactor;
    expect(f0).toBeCloseTo(passive, 6);
    expect(f0).toBeLessThan(steady);
    const fTau = d.hemodynamicsAt(t0 + TAU).flowFactor;
    const recovered = (fTau - f0) / (steady - f0);
    expect(recovered).toBeGreaterThan(0.55);
    expect(recovered).toBeLessThan(0.75);
    const fLate = d.hemodynamicsAt(t0 + 8 * TAU).flowFactor;
    expect(fLate).toBeCloseTo(steady, 3);
    expect(d.settledAt(t0 + 20 * TAU)).toBe(true);
    // monótono y sin NaN durante el transitorio
    let prev = f0;
    for (let t = t0; t <= t0 + 6 * TAU; t += 0.25) {
      const f = d.hemodynamicsAt(t).flowFactor;
      expect(Number.isFinite(f)).toBe(true);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f;
    }
  });

  it('escalón de PaCO₂ 40→50: nada cambia durante el retardo, después sube con τ_CO₂', () => {
    const d = new RegulationDynamics(BASAL);
    const t0 = 5;
    const f0 = d.hemodynamicsAt(0).flowFactor;
    d.setTarget({ ...BASAL, paco2MmHg: 50 }, t0);
    expect(d.hemodynamicsAt(t0 + CO2_DELAY * 0.9).flowFactor).toBeCloseTo(f0, 9);
    const steady = autoregulationFactor(80) * co2Factor(50);
    const fTau = d.hemodynamicsAt(t0 + CO2_DELAY + CO2_TAU).flowFactor;
    expect((fTau - f0) / (steady - f0)).toBeCloseTo(1 - Math.exp(-1), 2);
    expect(d.hemodynamicsAt(t0 + CO2_DELAY + 10 * CO2_TAU).flowFactor).toBeCloseTo(steady, 4);
  });

  it('autorregulación alterada: el flujo sigue a la PPC y no se recupera', () => {
    const d = new RegulationDynamics(BASAL, 'alterada');
    const f90 = d.hemodynamicsAt(0).flowFactor;
    d.setTarget({ ...BASAL, mapMmHg: 70 }, 1);
    for (const t of [1, 1 + TAU, 1 + 10 * TAU]) {
      expect(d.hemodynamicsAt(t).flowFactor).toBeCloseTo((60 / 80) * f90, 6);
    }
    const intact = new RegulationDynamics(BASAL);
    intact.setTarget({ ...BASAL, mapMmHg: 70 }, 1);
    expect(intact.hemodynamicsAt(1 + 10 * TAU).flowFactor).toBeGreaterThan(
      d.hemodynamicsAt(1 + 10 * TAU).flowFactor,
    );
  });

  it('un segundo escalón parte del valor instantáneo, sin saltos', () => {
    const d = new RegulationDynamics(BASAL);
    d.setTarget({ ...BASAL, mapMmHg: 70 }, 0);
    const mid = d.regulationAt(TAU / 2).cvrAutoRatio;
    d.setTarget({ ...BASAL, mapMmHg: 90 }, TAU / 2);
    expect(d.regulationAt(TAU / 2).cvrAutoRatio).toBeCloseTo(mid, 12);
  });

  it('determinista: dos instancias con la misma historia dan el mismo estado', () => {
    const a = new RegulationDynamics(BASAL);
    const b = new RegulationDynamics(BASAL);
    for (const d of [a, b]) {
      d.setTarget({ ...BASAL, icpMmHg: 30 }, 2);
      d.setTarget({ ...BASAL, icpMmHg: 30, paco2MmHg: 32 }, 4);
    }
    for (const t of [2, 3, 5, 9, 30]) {
      expect(a.hemodynamicsAt(t).flowFactor).toBe(b.hemodynamicsAt(t).flowFactor);
      expect(a.hemodynamicsAt(t).crcpMmHg).toBe(b.hemodynamicsAt(t).crcpMmHg);
    }
  });

  it('el caso de referencia expone la dinámica: setPhysiology(…, atS) produce un transitorio visible en physStateAt', () => {
    const sim = buildReferenceCase();
    const initial = { ...sim.patient.physiology };
    const steadyBefore = sim.physStateAt(0).hemo.flowFactor;
    sim.setPhysiology({ ...initial, mapMmHg: initial.mapMmHg - 20 }, 10);
    const f10 = sim.physStateAt(10).hemo.flowFactor;
    const f40 = sim.physStateAt(40).hemo.flowFactor;
    expect(f10).toBeLessThan(f40);
    expect(f40).toBeLessThan(steadyBefore);
    expect(sim.regulation.settledAt(10 + 20 * TAU)).toBe(true);
    // sin atS: instantáneo (comportamiento previo)
    sim.setPhysiology(initial);
    expect(sim.physStateAt(10).hemo.flowFactor).toBeCloseTo(steadyBefore, 9);
  });
});
