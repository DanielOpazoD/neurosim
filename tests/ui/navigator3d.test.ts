import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { eyeLocalDir, nerveCenterline, nerveFrame, fromEyeLocal } from '../../src/anatomy/eye';
import { currentPose } from '../../src/app/poses';
import { createInitialState } from '../../src/app/state';
import { describeStaticScene, flowColor, probeBasis } from '../../src/ui/navigator3d';
import { dot } from '../../src/core/vec3';

const sim = buildReferenceCase();

describe('navegador 3D (escena estática)', () => {
  it('describe un tubo por vaso del polígono de Willis', () => {
    const desc = describeStaticScene(sim, 'temporal');
    expect(desc.tubes.filter((t) => t.vesselId)).toHaveLength(sim.head.vessels.length);
  });

  it('la estación ocular describe ambos ojos con nervio, vaina y anillo ONSD', () => {
    const desc = describeStaticScene(sim, 'ojo');
    // Dos globos + dos córneas.
    expect(desc.ellipsoids).toHaveLength(4);
    // Dos nervios + dos vainas.
    expect(desc.tubes).toHaveLength(4);
    expect(desc.lenses).toHaveLength(2);
    expect(desc.bands).toHaveLength(8);
    for (const ring of desc.rings) {
      const expected = fromEyeLocal(sim.eyes.der, nerveCenterline(sim.eyes.der, 3));
      const expectedIzq = fromEyeLocal(sim.eyes.izq, nerveCenterline(sim.eyes.izq, 3));
      const match =
        ring.center.every((v, i) => Math.abs(v - expected[i]!) < 1e-9) ||
        ring.center.every((v, i) => Math.abs(v - expectedIzq[i]!) < 1e-9);
      expect(match).toBe(true);
    }
  });

  it('vaina y anillo DVNO usan el marco de la sección (DEC-57) en coordenadas del paciente', () => {
    const desc = describeStaticScene(sim, 'ojo');
    const sheaths = desc.tubes.filter((t) => t.section);
    expect(sheaths).toHaveLength(2);
    expect(desc.rings).toHaveLength(2);
    (['der', 'izq'] as const).forEach((side, i) => {
      const eye = sim.eyes[side];
      const f = nerveFrame(eye, 3);
      const ring = desc.rings[i]!;
      const t = eyeLocalDir(eye, f.t);
      const u = eyeLocalDir(eye, f.u);
      for (let k = 0; k < 3; k++) {
        expect(ring.tangent[k]).toBeCloseTo(t[k]!, 9);
        expect(ring.majorAxis![k]).toBeCloseTo(u[k]!, 9);
      }
      expect(dot(ring.tangent, ring.majorAxis!)).toBeCloseTo(0, 9);
      expect(ring.minorScale).toBeCloseTo(eye.sheathEcc, 9);
      // El marco local se transforma al paciente (en el ojo izquierdo
      // temporal = −x): antes la tangente del anillo se copiaba sin rotar.
      const sheath = sheaths[i]!.section!;
      expect(sheath.u[3]!.every((v, k) => Math.abs(v - u[k]!) < 1e-9)).toBe(true);
    });
  });

  it('la base de la sonda temporal es ortonormal', () => {
    const s = createInitialState();
    const pose = currentPose(sim, { ...s, station: 'temporal', side: 'der' });
    const b = probeBasis(pose);
    for (const axis of [b.lateral, b.elevation, b.forward]) {
      expect(Math.hypot(axis[0], axis[1], axis[2])).toBeCloseTo(1, 6);
    }
    expect(dot(b.lateral, b.elevation)).toBeCloseTo(0, 6);
    expect(dot(b.lateral, b.forward)).toBeCloseTo(0, 6);
    expect(dot(b.elevation, b.forward)).toBeCloseTo(0, 6);
  });

  it('colorea los vasos por sentido de flujo respecto a la sonda', () => {
    const s = createInitialState();
    const pose = currentPose(sim, { ...s, station: 'temporal', side: 'der' });
    const m1 = sim.head.vessels.find((v) => v.id === 'm1-der')!;
    const a1 = sim.head.vessels.find((v) => v.id === 'a1-der')!;
    expect(flowColor(m1, pose.forward)).toBe('#e85d5d');
    expect(flowColor(a1, pose.forward)).toBe('#4da3ff');
  });
});
