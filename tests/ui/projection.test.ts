import { describe, expect, it } from 'vitest';
import { project } from '../../src/ui/projection';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { currentPose } from '../../src/app/poses';
import { createInitialState } from '../../src/app/state';
import { buildScan } from '../../src/ultrasound/probe';
import { navigatorCameraPreset } from '../../src/ui/navigator3d';

describe('proyección ortográfica del navegador', () => {
  it('conserva distancias en el plano de cámara sin rotación', () => {
    const a = project([1, 2, 0], { yawDeg: 0, pitchDeg: 0 });
    const b = project([4, 6, 0], { yawDeg: 0, pitchDeg: 0 });
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(5);
  });

  it('define yaw positivo como +z hacia +x de pantalla', () => {
    const origin = project([0, 0, 0], { yawDeg: 90, pitchDeg: 0 });
    const anterior = project([0, 0, 1], { yawDeg: 90, pitchDeg: 0 });
    expect(anterior.x - origin.x).toBeCloseTo(1);
  });

  it('mantiene la huella ocular dentro del canvas en ambos presets', () => {
    const sim = buildReferenceCase();
    const s = createInitialState();
    const eye = sim.eyes.der;
    const pose = currentPose(sim, s);
    const scan = buildScan(pose, s.settings.transducer, 64);
    for (const station of ['ojo', 'temporal'] as const) {
      const preset = navigatorCameraPreset(station, 'der');
      const target = station === 'ojo' ? eye.center : sim.head.skullCenter;
      const points = scan.lines.flatMap((line) => [
        line.origin,
        line.origin.map((v, i) => v + line.dir[i]! * 60) as [number, number, number],
      ]);
      const projected = points.map((point) => project(point, { ...preset, target, scale: 1 }));
      expect(projected.every((point) => Math.abs(point.x) < 1000 && Math.abs(point.y) < 1000)).toBe(true);
    }
  });
});
