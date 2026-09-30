import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { eyeLocalDir, nerveCenterline, nerveFrame, fromEyeLocal } from '../../src/anatomy/eye';
import { currentPose } from '../../src/app/poses';
import { createInitialState } from '../../src/app/state';
import { describeStaticScene, eyeNavigatorFrame, flowColor, probeBasis } from '../../src/ui/navigator3d';
import { dist, dot, type Vec3 } from '../../src/core/vec3';

const sim = buildReferenceCase();

describe('navegador 3D (escena estática)', () => {
  it('describe un tubo por vaso del polígono de Willis', () => {
    const desc = describeStaticScene(sim, 'temporal');
    expect(desc.tubes.filter((t) => t.vesselId)).toHaveLength(sim.head.vessels.length);
  });

  it('la estación ocular describe solo la órbita explorada con nervio, vaina y anillo ONSD', () => {
    for (const side of ['der', 'izq'] as const) {
      const desc = describeStaticScene(sim, 'ojo', side);
      // Globo + córnea, nervio + vaina, cristalino, 4 rectos (N15b: sin el otro ojo).
      expect(desc.ellipsoids).toHaveLength(2);
      expect(desc.tubes).toHaveLength(2);
      expect(desc.lenses).toHaveLength(1);
      expect(desc.bands).toHaveLength(4);
      // Rectos muy translúcidos: el nervio y la vaina se leen a través.
      for (const band of desc.bands) expect(band.opacity).toBe(0.25);
      expect(desc.rings).toHaveLength(1);
      const expected = fromEyeLocal(sim.eyes[side], nerveCenterline(sim.eyes[side], 3));
      expect(desc.rings[0]!.center.every((v, i) => Math.abs(v - expected[i]!) < 1e-9)).toBe(true);
      const other = sim.eyes[side === 'der' ? 'izq' : 'der'];
      for (const e of desc.ellipsoids) expect(dist(e.center, other.center)).toBeGreaterThan(30);
    }
  });

  it('encuadre ocular: huella de la sonda, globo y anillo a 3 mm dentro del radio', () => {
    for (const side of ['der', 'izq'] as const) {
      const eye = sim.eyes[side];
      const { target, radiusMm } = eyeNavigatorFrame(sim, side);
      const pose = currentPose(sim, { ...createInitialState(), station: 'ojo', side });
      // Objetivo entre la cara de la sonda y el centro del globo.
      const toProbe = dist(target, pose.origin);
      const toCenter = dist(target, eye.center);
      expect(Math.abs(toProbe - toCenter)).toBeLessThan(1e-9);
      expect(toProbe + toCenter).toBeCloseTo(dist(pose.origin, eye.center), 9);
      // Extremos de la huella (±25 mm lateral), polo posterior y anillo DVNO.
      const lat = pose.lateral;
      for (const sgn of [-1, 1]) {
        const end: Vec3 = [
          pose.origin[0] + lat[0] * 25 * sgn,
          pose.origin[1] + lat[1] * 25 * sgn,
          pose.origin[2] + lat[2] * 25 * sgn,
        ];
        expect(dist(end, target)).toBeLessThan(radiusMm);
      }
      const ring = fromEyeLocal(eye, nerveCenterline(eye, 3));
      expect(dist(ring, target)).toBeLessThan(radiusMm);
      expect(dist(eye.center, target) + eye.globeRadiusMm).toBeLessThan(radiusMm);
      expect(radiusMm).toBeLessThan(32);
    }
  });

  it('vaina y anillo DVNO usan el marco de la sección (DEC-57) en coordenadas del paciente', () => {
    (['der', 'izq'] as const).forEach((side) => {
      const desc = describeStaticScene(sim, 'ojo', side);
      const sheaths = desc.tubes.filter((t) => t.section);
      expect(sheaths).toHaveLength(1);
      expect(desc.rings).toHaveLength(1);
      const eye = sim.eyes[side];
      const f = nerveFrame(eye, 3);
      const ring = desc.rings[0]!;
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
      const sheath = sheaths[0]!.section!;
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
