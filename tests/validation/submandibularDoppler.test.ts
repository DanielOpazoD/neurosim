/**
 * Doppler submandibular (DEC-58): PW de 6 s sobre la ACI distal con la puerta
 * y la pose por defecto de la app (PSV/EDV dentro del 25 % del modelo, patrón
 * de baja resistencia) y PW sobre la ACE (alta resistencia).
 */
import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { vesselVelocityCms } from '../../src/physiology/flow';
import { neckLocal } from '../../src/anatomy/neck';
import { patientToImage } from '../../src/ultrasound/probe';
import { currentPose } from '../../src/app/poses';
import { measureIcaWithChain, submandibularState } from './helpers';

const sim = buildReferenceCase();

describe('PW submandibular', () => {
  it('ACI der, 6 s: PSV/EDV dentro del 25 % del modelo y baja resistencia (IR < 0,65)', () => {
    const s = submandibularState(sim, 'der');
    const ica = sim.neck.der.vessels.find((v) => v.id === 'aci-der')!;
    const hemo = sim.physStateAt(0).hemo;
    let psv = 0;
    let edv = Infinity;
    for (let i = 0; i < 400; i++) {
      const v = vesselVelocityCms(ica, i / 400, 1, hemo);
      psv = Math.max(psv, v);
      edv = Math.min(edv, v);
    }
    const { summary, composition, angle } = measureIcaWithChain(sim, s, 6);
    expect(angle.vesselId).toBe('aci-der');
    expect(angle.realDeg).toBeLessThanOrEqual(30);
    expect(composition.dominantVesselId).toBe('aci-der');
    expect(summary).not.toBeNull();
    expect(summary!.beats).toBeGreaterThanOrEqual(4);
    // Flujo craneal: se aleja de la sonda (signo negativo en pantalla).
    expect(summary!.psvCms).toBeLessThan(0);
    expect(Math.abs(summary!.psvCms)).toBeGreaterThan(psv * 0.75);
    expect(Math.abs(summary!.psvCms)).toBeLessThan(psv * 1.25);
    expect(Math.abs(summary!.edvCms)).toBeGreaterThan(edv * 0.75);
    expect(Math.abs(summary!.edvCms)).toBeLessThan(edv * 1.25);
    expect(summary!.ri).toBeLessThan(0.65);
  });

  it('ACE der: patrón de alta resistencia (IR > 0,75)', () => {
    const s = submandibularState(sim, 'der');
    const eca = sim.neck.der.vessels.find((v) => v.id === 'ace-der')!;
    // Puerta sobre la ACE a ~35 mm de profundidad (en el plano por defecto).
    const target = eca.points.reduce((best, p) =>
      Math.abs(neckLocal(sim.neck.der.frame, p)[0] - 35) <
      Math.abs(neckLocal(sim.neck.der.frame, best)[0] - 35)
        ? p
        : best,
    );
    const { u, z } = patientToImage(currentPose(sim, s), 'sector', target);
    s.gateUMm = u;
    s.gateDepthMm = z;
    s.settings = { ...s.settings, gateMm: 3 };
    const { summary, composition } = measureIcaWithChain(sim, s, 4);
    expect(composition.dominantVesselId).toBe('ace-der');
    expect(summary).not.toBeNull();
    expect(summary!.ri).toBeGreaterThan(0.75);
    expect(Math.abs(summary!.edvCms)).toBeLessThan(15);
  });
});
