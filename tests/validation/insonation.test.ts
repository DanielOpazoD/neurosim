import { describe, expect, it } from 'vitest';
import type { HeadGeometry, Vessel } from '../../src/anatomy/head';
import { angleCorrectionErrorFactor, insonationAngles } from '../../src/doppler/insonation';

function syntheticHead(): HeadGeometry {
  const vessel: Vessel = {
    id: 'synthetic',
    side: 'media',
    points: [
      [0, 0, 0],
      [10, 0, 0],
    ],
    controlPoints: [
      [0, 0, 0],
      [10, 0, 0],
    ],
    aabb: { min: [-1, -1, -1], max: [11, 1, 1] },
    radiusMm: 1,
    flowSign: 1,
    flowMlMin: 1,
    meanCms: 55,
    psvCms: 90,
    edvCms: 35,
  };
  return { vessels: [vessel] } as unknown as HeadGeometry;
}

describe('ángulos de insonación', () => {
  it('coincide con el ángulo proyectado en un plano 2D', () => {
    const beam = [0.5, 0, Math.sqrt(3) / 2] as [number, number, number];
    const angles = insonationAngles(syntheticHead(), [5, 0, 0], beam, [Math.sqrt(3) / 2, 0, -0.5], [0, 1, 0]);
    expect(angles.realDeg).toBeCloseTo(60, 6);
    expect(angles.projectedDeg).toBeCloseTo(60, 6);
    expect(angles.elevationTiltDeg).toBeCloseTo(0, 6);
  });

  it('distingue la inclinación elevacional del ángulo proyectado', () => {
    const tilted = insonationAngles(
      syntheticHead(),
      [5, 0, 0],
      [0.5, Math.sqrt(3) / 2, 0] as [number, number, number],
      [0, 0, 1],
      [-Math.sqrt(3) / 2, 0.5, 0],
    );
    expect(tilted.realDeg).toBeGreaterThan(tilted.projectedDeg);
    expect(tilted.vesselId).toBe('synthetic');
  });

  it('calcula el factor de error de corrección angular', () => {
    expect(angleCorrectionErrorFactor(60, 0)).toBeCloseTo(0.5, 8);
  });
});
