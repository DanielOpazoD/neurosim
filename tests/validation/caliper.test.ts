import { describe, expect, it } from 'vitest';
import {
  fromEyeLocal,
  nerveCenterline,
  nerveSection,
  sheathRadiiAt,
  trueOnsdMm,
} from '../../src/anatomy/eye';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { defaultEyeSettings } from '../../src/domain/settings';
import { caliperDistanceMm } from '../../src/domain/measure';
import { add, scale, type Vec3 } from '../../src/core/vec3';
import { buildScan, patientToImage } from '../../src/ultrasound/probe';
import { frameFromScan, eyePose } from './helpers';

describe('validación de calipers', () => {
  it('mide una distancia lateral lineal', () => {
    const settings = defaultEyeSettings();
    const pose = {
      origin: [0, 0, 20] as Vec3,
      forward: [0, 0, -1] as Vec3,
      lateral: [1, 0, 0] as Vec3,
      markerAngleRad: 0,
      contactPressure: 0,
    };
    const scan = buildScan(pose, 'linear', 128);
    const frame = frameFromScan(scan, settings, 'der', 'ojo');
    expect(caliperDistanceMm(frame, { u: -2.3, z: 20 }, { u: 2.3, z: 20 })).toBeCloseTo(4.6, 1);
  });

  it('mide la cuerda de un sector', () => {
    const settings = defaultEyeSettings();
    const pose = {
      origin: [0, 0, 0] as Vec3,
      forward: [0, 0, 1] as Vec3,
      lateral: [1, 0, 0] as Vec3,
      markerAngleRad: 0,
      contactPressure: 0,
    };
    const scan = buildScan(pose, 'sector', 128);
    const frame = frameFromScan(scan, settings, 'der', 'temporal');
    const expected = 2 * 50 * Math.sin(0.05);
    expect(caliperDistanceMm(frame, { u: -0.05, z: 50 }, { u: 0.05, z: 50 })).toBeCloseTo(expected, 1);
  });

  it('interpreta s=0 como la pared posterior del globo', () => {
    const sim = buildReferenceCase();
    const g = sim.eyes.der;
    const c0 = nerveCenterline(g, 0);
    const c3 = nerveCenterline(g, 3);
    expect(Math.abs(c3[2] - c0[2])).toBeCloseTo(3, 1);
  });

  it('conserva el ONSD al proyectar ojo → imagen → paciente', () => {
    const sim = buildReferenceCase();
    const settings = defaultEyeSettings();
    for (const side of ['der', 'izq'] as const) {
      const g = sim.eyes[side];
      const sMm = 3;
      const center = nerveCenterline(g, sMm);
      const section = nerveSection(g, center);
      const radii = sheathRadiiAt(g, sMm);
      const innerRadius = radii.major - g.duraMm;
      const axis: Vec3 = [1, 0, 0];
      const a = fromEyeLocal(g, add(center, scale(axis, -innerRadius)));
      const b = fromEyeLocal(g, add(center, scale(axis, innerRadius)));
      const pose = eyePose(sim, side);
      const scan = buildScan(pose, 'linear', 128);
      const frame = frameFromScan(scan, settings, side, 'ojo');
      const ia = patientToImage(pose, 'linear', a);
      const ib = patientToImage(pose, 'linear', b);
      const measured = caliperDistanceMm(frame, ia, ib);
      expect(section.sMm).toBeCloseTo(sMm, 1);
      expect(measured).toBeCloseTo(trueOnsdMm(g, sMm, 'interno'), 2);
    }
    expect(trueOnsdMm(sim.eyes.der, 3, 'interno')).toBeCloseTo(4.6, 1);
    expect(trueOnsdMm(sim.eyes.izq, 3, 'interno')).toBeCloseTo(4.7, 1);
  });
});
