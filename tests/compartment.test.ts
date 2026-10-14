import { describe, expect, it } from 'vitest';
import {
  IntracranialCompartment,
  complianceMlPerMmHg,
  defaultCompartmentParams,
  icpForVolume,
  steadyLesionVolumeForIcp,
  volumeForIcp,
} from '../src/physiology/compartment';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { caseById } from '../src/domain/cases';

const P = defaultCompartmentParams();

describe('compartimento intracraneal (DEC-82)', () => {
  it('curva de Marmarou: PVI multiplica por 10, inversa consistente, compliance = PVI/(ln10·P)', () => {
    expect(icpForVolume(P, 0)).toBeCloseTo(P.icp0MmHg, 9);
    expect(icpForVolume(P, P.pviMl)).toBeCloseTo(Math.min(P.icpCapMmHg, 10 * P.icp0MmHg), 9);
    for (const v of [-10, -3, 0, 5, 12]) expect(volumeForIcp(P, icpForVolume(P, v))).toBeCloseTo(v, 9);
    expect(complianceMlPerMmHg(P, 10)).toBeCloseTo(P.pviMl / (Math.LN10 * 10), 9);
    expect(complianceMlPerMmHg(P, 40)).toBeLessThan(complianceMlPerMmHg(P, 10));
    expect(icpForVolume(P, 1000)).toBe(P.icpCapMmHg);
  });

  it('sin lesión la PIC basal es un punto fijo del balance de LCR (Davson)', () => {
    const c = new IntracranialCompartment(P);
    expect(c.sinusMmHg).toBeCloseTo(P.icp0MmHg - P.csfFormationMlMin * P.csfOutflowResistance, 9);
    for (const t of [0, 60, 600, 3600]) expect(c.icpAt(t)).toBeCloseTo(P.icp0MmHg, 6);
  });

  it('lesión menor que la reserva: salto inmediato por la curva y vuelta a la basal en minutos', () => {
    const c = new IntracranialCompartment(P);
    c.setLesionVolume(20, 10);
    const jump = c.icpAt(10);
    expect(jump).toBeCloseTo(icpForVolume(P, 20), 6);
    expect(jump).toBeGreaterThan(P.icp0MmHg);
    let prev = jump;
    for (let t = 10; t <= 10 + 30 * 60; t += 30) {
      const icp = c.icpAt(t);
      expect(Number.isFinite(icp)).toBe(true);
      expect(icp).toBeLessThanOrEqual(prev + 1e-9);
      prev = icp;
    }
    expect(Math.abs(c.icpAt(10 + 30 * 60) - P.icp0MmHg)).toBeLessThan(0.5);
    expect(Math.abs(c.icpAt(10 + 90 * 60) - P.icp0MmHg)).toBeLessThan(0.1);
    expect(c.steadyIcp()).toBeCloseTo(P.icp0MmHg, 9);
    // el tiempo medio de recuperación es del orden de minutos, no de segundos ni horas
    const half = (jump + P.icp0MmHg) / 2;
    let tHalf = 0;
    for (let t = 10; t <= 10 + 60 * 60; t += 5) {
      if (c.icpAt(t) <= half) {
        tHalf = t - 10;
        break;
      }
    }
    expect(tHalf).toBeGreaterThan(20);
    expect(tHalf).toBeLessThan(15 * 60);
  });

  it('lesión mayor que la reserva: la PIC queda sostenida por el volumen residual', () => {
    const c = new IntracranialCompartment(P);
    const lesion = P.csfDisplaceableMl + 10;
    c.setLesionVolume(lesion, 0);
    const late = c.icpAt(4 * 3600);
    expect(late).toBeCloseTo(icpForVolume(P, 10), 1);
    expect(late).toBeGreaterThan(P.icp0MmHg * 2);
    expect(c.steadyIcp()).toBeCloseTo(icpForVolume(P, 10), 9);
    expect(c.reserveMlAt(4 * 3600)).toBeCloseTo(0, 3);
  });

  it('steadyForIcp reproduce la PIC declarada por un caso y es estable en el tiempo', () => {
    for (const icp of [5, 10, 20, 32, 45]) {
      const c = IntracranialCompartment.steadyForIcp(icp, P);
      expect(c.icpAt(0)).toBeCloseTo(icp, 6);
      expect(c.icpAt(3600)).toBeCloseTo(icp, 3);
      expect(steadyLesionVolumeForIcp(P, icp)).toBeCloseTo(c.current.lesionVolumeMl, 9);
    }
    expect(steadyLesionVolumeForIcp(P, P.icp0MmHg)).toBe(0);
  });

  it('drenaje (volumen negativo) baja la PIC y la reserva se recupera por formación de LCR', () => {
    const c = new IntracranialCompartment(P);
    c.setLesionVolume(-10, 0);
    expect(c.icpAt(0)).toBeLessThan(P.icp0MmHg);
    expect(c.icpAt(60 * 60)).toBeGreaterThan(c.icpAt(0));
    expect(c.icpAt(3 * 3600)).toBeCloseTo(P.icp0MmHg, 1);
  });

  it('determinista e independiente de la cadencia de consulta', () => {
    const a = new IntracranialCompartment(P);
    const b = new IntracranialCompartment(P);
    a.setLesionVolume(30, 5);
    b.setLesionVolume(30, 5);
    for (let t = 5; t <= 605; t += 7) a.icpAt(t);
    a.advanceTo(400);
    expect(a.icpAt(605)).toBeCloseTo(b.icpAt(605), 6);
  });
});

describe('caso de referencia: PIC emergente (DEC-82)', () => {
  it('el caso parte en estado estacionario con la PIC que declara', () => {
    const sim = buildReferenceCase();
    expect(sim.compartment.icpAt(0)).toBeCloseTo(sim.patient.physiology.icpMmHg, 6);
    expect(sim.syncIcp(600)).toBe(false);
    const hic = buildReferenceCase(undefined, 'normal', caseById('hic'));
    expect(hic.compartment.icpAt(0)).toBeCloseTo(hic.patient.physiology.icpMmHg, 6);
    expect(hic.compartment.current.lesionVolumeMl).toBeGreaterThan(P.csfDisplaceableMl);
    expect(hic.syncIcp(3600)).toBe(false);
    const parada = buildReferenceCase(undefined, 'normal', caseById('paradaCirculatoria'));
    expect(parada.patient.physiology.icpMmHg).toBeGreaterThan(P.icpCapMmHg);
    expect(parada.compartment.icpAt(0)).toBeCloseTo(parada.patient.physiology.icpMmHg, 6);
    expect(parada.syncIcp(3600)).toBe(false);
  });

  it('setLesionVolume sube la PIC derivada, incrementa la revisión y la PIC vuelve a bajar con syncIcp', () => {
    const sim = buildReferenceCase();
    const rev0 = sim.physiologyRevision;
    sim.setLesionVolume(20, 10);
    const icpJump = sim.patient.physiology.icpMmHg;
    expect(icpJump).toBeGreaterThan(P.icp0MmHg + 5);
    expect(sim.physiologyRevision).toBe(rev0 + 1);
    expect(sim.physStateAt(10).hemo.cppMmHg).toBeCloseTo(sim.patient.physiology.mapMmHg - icpJump, 6);
    expect(sim.syncIcp(10 + 20 * 60)).toBe(true);
    expect(sim.patient.physiology.icpMmHg).toBeLessThan(icpJump);
    expect(sim.patient.physiology.icpMmHg % 0.5).toBeCloseTo(0, 9);
    // el DVNO sigue a la PIC derivada
    const onsdHigh = sim.eyes.der.sheathRadiusExtMm;
    sim.syncIcp(10 + 6 * 3600);
    expect(sim.patient.physiology.icpMmHg).toBeCloseTo(P.icp0MmHg, 0);
    expect(sim.eyes.der.sheathRadiusExtMm).toBeLessThanOrEqual(onsdHigh);
  });

  it('una PIC impuesta desde fuera recoloca el compartimento (casos, URL, worker)', () => {
    const sim = buildReferenceCase();
    sim.setPhysiology({ ...sim.patient.physiology, icpMmHg: 30 });
    expect(sim.compartment.icpAt(0)).toBeCloseTo(30, 6);
    expect(sim.syncIcp(7200)).toBe(false);
  });
});
