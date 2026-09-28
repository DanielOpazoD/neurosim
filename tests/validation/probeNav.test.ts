import { describe, expect, it } from 'vitest';
import { buildReferenceHead, surfacePoint } from '../../src/anatomy/head';
import { eyePose, temporalPose, type PoseInput } from '../../src/app/poses';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { cross, dist, normalize, sub, type Vec3 } from '../../src/core/vec3';
import { SeededRandom } from '../../src/core/random';
import { skullAttenuationDb } from '../../src/ultrasound/attenuation';
import { rotateAround } from '../../src/ultrasound/probe';

const sim = buildReferenceCase();
const base: PoseInput = {
  side: 'der',
  station: 'temporal',
  tiltDeg: 0,
  offsetMm: 0,
  rotDeg: 0,
  press: 0.3,
};

describe('navegación de sonda (offsetV / tiltV)', () => {
  it('offsetVMm desplaza el origen del ojo N mm sobre el eje de elevación', () => {
    const p0 = eyePose(sim, { ...base, station: 'ojo' });
    const pV = eyePose(sim, { ...base, station: 'ojo', offsetVMm: 10 });
    const elev = normalize(cross(p0.lateral, p0.forward));
    const delta = sub(pV.origin, p0.origin);
    expect(dist(pV.origin, p0.origin)).toBeCloseTo(10, 9);
    expect(delta[0]).toBeCloseTo(elev[0] * 10, 9);
    expect(delta[1]).toBeCloseTo(elev[1] * 10, 9);
    expect(delta[2]).toBeCloseTo(elev[2] * 10, 9);
  });

  it('offsetVMm desplaza el origen temporal sobre la superficie craneal', () => {
    const p0 = temporalPose(sim, base);
    const pV = temporalPose(sim, { ...base, offsetVMm: 12 });
    // La cara se aleja de la ventana pero sigue pegada al cuero cabelludo.
    const projected = surfacePoint(sim.head, pV.origin, 0);
    expect(dist(projected, pV.origin)).toBeCloseTo(7.7, 0);
    expect(dist(pV.origin, p0.origin)).toBeGreaterThan(8);
  });

  it('tiltVDeg rota el haz alrededor del eje de elevación', () => {
    const p0 = temporalPose(sim, base);
    const pV = temporalPose(sim, { ...base, tiltVDeg: 15 });
    const elev = normalize(cross(p0.lateral, p0.forward));
    const expected = normalize(rotateAround(p0.forward, elev, (15 * Math.PI) / 180));
    expect(pV.forward[0]).toBeCloseTo(expected[0], 12);
    expect(pV.forward[1]).toBeCloseTo(expected[1], 12);
    expect(pV.forward[2]).toBeCloseTo(expected[2], 12);
    // La elevación es perpendicular a forward y a lateral.
    expect(
      Math.abs(elev[0] * p0.forward[0] + elev[1] * p0.forward[1] + elev[2] * p0.forward[2]),
    ).toBeLessThan(1e-9);
  });

  it('offsetVMm=0 y tiltVDeg=0 son bit-idénticos a no pasarlos', () => {
    for (const station of ['ojo', 'temporal'] as const) {
      const input: PoseInput = { ...base, station };
      const poseA = station === 'ojo' ? eyePose(sim, input) : temporalPose(sim, input);
      const poseB =
        station === 'ojo'
          ? eyePose(sim, { ...input, offsetVMm: 0, tiltVDeg: 0 })
          : temporalPose(sim, { ...input, offsetVMm: 0, tiltVDeg: 0 });
      expect(poseB.origin).toEqual(poseA.origin);
      expect(poseB.forward).toEqual(poseA.forward);
      expect(poseB.lateral).toEqual(poseA.lateral);
    }
  });
});

describe('cuero cabelludo y atenuación al deslizar', () => {
  it('surfacePoint devuelve un punto a nivel 1 + scalp/R_dir (1e-6)', () => {
    const head = buildReferenceHead(new SeededRandom('surface-point'));
    const probe: Vec3 = [head.skullCenter[0] + 60, head.skullCenter[1] + 10, head.skullCenter[2] + 5];
    const scalp = 7.7;
    const out = surfacePoint(head, probe, scalp);
    // Nivel del elipsoide del punto resultante.
    const d = sub(out, head.skullCenter);
    const r = head.skullRadii;
    const level = Math.hypot(d[0] / r[0], d[1] / r[1], d[2] / r[2]);
    // Radio local del elipsoide en esa dirección (mm).
    const u: Vec3 = [d[0]! / r[0]! / level, d[1]! / r[1]! / level, d[2]! / r[2]! / level];
    const rDir = Math.hypot(u[0]! * r[0]!, u[1]! * r[1]!, u[2]! * r[2]!);
    expect(level).toBeCloseTo(1 + scalp / rDir, 6);
    // Sin scalp → exactamente sobre el elipsoide.
    const on = surfacePoint(head, probe, 0);
    const dd = sub(on, head.skullCenter);
    expect(Math.hypot(dd[0] / r[0], dd[1] / r[1], dd[2] / r[2])).toBeCloseTo(1, 6);
  });

  it('deslizar 18 mm superior mete hueso: ≥8 dB más de atenuación', () => {
    const head = sim.head;
    const att = (offsetVMm: number) =>
      skullAttenuationDb(head, temporalPose(sim, { ...base, offsetVMm }).origin, head.midbrainCenter, 2);
    const a0 = att(0);
    const a18 = att(18);
    expect(a18 - a0).toBeGreaterThanOrEqual(8);
  });
});
