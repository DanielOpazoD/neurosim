import { describe, expect, it } from 'vitest';
import {
  classifyEye,
  eyeLocalDir,
  fromEyeLocal,
  nerveCenterline,
  nerveFrame,
  nerveSection,
  sheathRadiiAt,
  trueOnsdMinorMm,
  trueOnsdMm,
} from '../../src/anatomy/eye';
import type { MaterialId } from '../../src/anatomy/materials';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { defaultEyeSettings } from '../../src/domain/settings';
import { caliperDistanceMm } from '../../src/domain/measure';
import { add, dist, scale, type Vec3 } from '../../src/core/vec3';
import { buildScan, imageToPatient, patientToImage } from '../../src/ultrasound/probe';
import { currentPose } from '../../src/app/poses';
import { createInitialState } from '../../src/app/state';
import { frameFromScan, eyePose } from './helpers';

/** Distancia (paso 0,01 mm) hasta el primer punto cuyo material no está en `inside`. */
function exitDistanceMm(at: (t: number) => Vec3, classify: (p: Vec3) => MaterialId, inside: Set<MaterialId>) {
  let t = 0;
  while (inside.has(classify(at(t + 0.01))) && t < 8) t += 0.01;
  return t + 0.005; // frontera a mitad del último paso
}
const SHEATH_EXT = new Set<MaterialId>(['nervioOptico', 'lcrVaina', 'duraVaina', 'vaso']);
const SHEATH_INT = new Set<MaterialId>(['nervioOptico', 'lcrVaina', 'vaso']);

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

  // DEC-57: la vaina se clasifica en el marco de la sección perpendicular;
  // antes el ojo izquierdo (nervio a ~18° en la imagen) medía 4,96 frente a 4,70.
  it('la frontera dural clasificada coincide con la verdad a lo largo de u y v (ambos ojos)', () => {
    const sim = buildReferenceCase();
    for (const side of ['der', 'izq'] as const) {
      const g = sim.eyes[side];
      const f = nerveFrame(g, 3);
      const c = fromEyeLocal(g, f.c);
      const classify = (p: Vec3) => classifyEye(g, p);
      const across = (axis: Vec3, inside: Set<MaterialId>) => {
        const d = eyeLocalDir(g, axis);
        const plus = exitDistanceMm((t) => add(c, scale(d, t)), classify, inside);
        const minus = exitDistanceMm((t) => add(c, scale(d, -t)), classify, inside);
        return plus + minus;
      };
      expect(Math.abs(across(f.u, SHEATH_EXT) - trueOnsdMm(g, 3, 'externo'))).toBeLessThanOrEqual(0.05);
      expect(Math.abs(across(f.v, SHEATH_EXT) - trueOnsdMinorMm(g, 3, 'externo'))).toBeLessThanOrEqual(0.05);
      expect(Math.abs(across(f.u, SHEATH_INT) - trueOnsdMm(g, 3, 'interno'))).toBeLessThanOrEqual(0.05);
      expect(Math.abs(across(f.v, SHEATH_INT) - trueOnsdMinorMm(g, 3, 'interno'))).toBeLessThanOrEqual(0.05);
    }
  });

  it('en el plano B-mode de la guía el diámetro aparente ⟂ al nervio coincide con la verdad', () => {
    const sim = buildReferenceCase();
    for (const side of ['der', 'izq'] as const) {
      for (const rotDeg of [0, 90]) {
        const s = createInitialState();
        s.side = side;
        s.offsetMm = side === 'der' ? -2.5 : 2.5;
        s.rotDeg = rotDeg;
        s.handMotion = false;
        const pose = currentPose(sim, s);
        const g = sim.eyes[side];
        const img = (sMm: number) => patientToImage(pose, 'linear', fromEyeLocal(g, nerveCenterline(g, sMm)));
        const c = img(3);
        const a = img(3.5);
        const b = img(2.5);
        const n = Math.hypot(a.u - b.u, a.z - b.z);
        // Perpendicular a la dirección del nervio en la imagen.
        const pu = (a.z - b.z) / n;
        const pz = -(a.u - b.u) / n;
        const at = (t: number): Vec3 => imageToPatient(pose, 'linear', c.u + t * pu, c.z + t * pz);
        const classify = (p: Vec3) => classifyEye(g, p);
        const t1 = exitDistanceMm((t) => at(-t), classify, SHEATH_INT);
        const t2 = exitDistanceMm(at, classify, SHEATH_INT);
        const width = dist(at(-t1), at(t2));
        const truth = rotDeg === 0 ? trueOnsdMm(g, 3, 'interno') : trueOnsdMinorMm(g, 3, 'interno');
        expect(
          Math.abs(width - truth),
          `${side} ${rotDeg}°: ${width.toFixed(3)} vs ${truth.toFixed(3)}`,
        ).toBeLessThanOrEqual(0.1);
      }
    }
  });
});
