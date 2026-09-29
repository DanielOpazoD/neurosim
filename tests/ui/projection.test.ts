import { describe, expect, it } from 'vitest';
import { project } from '../../src/ui/projection';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { currentPose } from '../../src/app/poses';
import { createInitialState } from '../../src/app/state';
import { buildScan } from '../../src/ultrasound/probe';
import { navigatorCameraPreset, navigatorFrame } from '../../src/ui/navigator3d';
import { viewPreset } from '../../src/ui/viewLink';
import { cross, dot, normalize, sub } from '../../src/core/vec3';

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

  it('encuadra el polígono temporal y el globo ocular con escala legible', () => {
    const sim = buildReferenceCase();
    const temporalFrame = navigatorFrame(sim, 'temporal', 'der', 300);
    // Proyección ortográfica sobre la base real de la cámara enlazada (DEC-59).
    const view = viewPreset('temporal', 'der');
    const right = normalize(cross(view.up, view.dir));
    const up = view.up;
    const m1 = sim.head.vessels.find((vessel) => vessel.id === 'm1-der');
    expect(m1).toBeDefined();
    const m1Projected = m1!.points.map((point) => {
      const q = sub(point, temporalFrame.target);
      return { x: dot(q, right) * temporalFrame.scale, y: dot(q, up) * temporalFrame.scale };
    });
    const m1Extent = Math.max(
      Math.max(...m1Projected.map((point) => point.x)) - Math.min(...m1Projected.map((point) => point.x)),
      Math.max(...m1Projected.map((point) => point.y)) - Math.min(...m1Projected.map((point) => point.y)),
    );
    expect(m1Extent).toBeGreaterThanOrEqual(40);

    const eye = sim.eyes.der;
    const eyeFrame = navigatorFrame(sim, 'ojo', 'der', 300);
    const eyeCamera = {
      ...navigatorCameraPreset('ojo', 'der'),
      target: eyeFrame.target,
      scale: eyeFrame.scale,
    };
    const yaw = (eyeCamera.yawDeg * Math.PI) / 180;
    const pitch = (eyeCamera.pitchDeg * Math.PI) / 180;
    const basis = {
      right: [Math.cos(yaw), 0, Math.sin(yaw)] as const,
      up: [Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw)] as const,
    };
    const visibleRadius = eye.globeRadiusMm + 0.5;
    const globeProjected = [basis.right, basis.up].flatMap((axis) =>
      [-1, 1].map((sign) =>
        project(
          [
            eye.center[0] + axis[0] * visibleRadius * sign,
            eye.center[1] + axis[1] * visibleRadius * sign,
            eye.center[2] + axis[2] * visibleRadius * sign,
          ],
          eyeCamera,
        ),
      ),
    );
    const globeDiameter = Math.max(
      Math.max(...globeProjected.map((point) => point.x)) -
        Math.min(...globeProjected.map((point) => point.x)),
      Math.max(...globeProjected.map((point) => point.y)) -
        Math.min(...globeProjected.map((point) => point.y)),
    );
    expect(globeDiameter).toBeGreaterThanOrEqual(120);
  });
});
