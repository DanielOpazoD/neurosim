import { describe, expect, it } from 'vitest';
import {
  flowForMeanVelocity,
  meanVelocityForFlow,
  meanNormalizedProfile,
  radialProfileMean,
} from '../../src/core/flowProfile';
import { CerebralFlow, vesselAxialVelocityCms, vesselMeanVelocityCms } from '../../src/physiology/flow';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { vesselRadiusAt, type Vessel } from '../../src/anatomy/head';

const sim = buildReferenceCase();
function tube(patch: Partial<Vessel> = {}): Vessel {
  return {
    id: 'tubo',
    side: 'media',
    points: [
      [0, 0, -50],
      [0, 0, 50],
    ],
    controlPoints: [
      [0, 0, -50],
      [0, 0, 50],
    ],
    radiusMm: 2,
    aabb: { min: [-2, -2, -52], max: [2, 2, 52] },
    flowSign: 1,
    flowMlMin: 180,
    meanSpatialCms: meanVelocityForFlow(180, 2),
    psvCms: 90,
    edvCms: 35,
    ...patch,
  };
}

/** Cuadratura polar uniforme en área: integra el campo real, no su fórmula de caudal. */
function integratedFlow(v: Vessel, phase: number, z = 0, hemo = false): number {
  const flow = new CerebralFlow({ vessels: [v] }, sim.patient.physiology);
  const radius = vesselRadiusAt(v, z + 50);
  const rings = 32;
  const angles = 8;
  let sum = 0;
  for (let i = 0; i < rings; i++) {
    const r = radius * Math.sqrt((i + 0.5) / rings);
    for (let j = 0; j < angles; j++) {
      const a = (2 * Math.PI * (j + 0.5)) / angles;
      sum += flow.velocityAt(
        [r * Math.cos(a), r * Math.sin(a), z],
        phase,
        1,
        hemo ? sim.physStateAt(0).hemo : undefined,
      )[2];
    }
  }
  return (sum / (rings * angles)) * Math.PI * radius ** 2 * 0.06;
}

describe('conservación de caudal y semántica de velocidades (DEC-75)', () => {
  it.each([0, 0.85, 1])('normaliza por área el perfil con peso %s', (weight) => {
    let mean = 0;
    for (let i = 0; i < 1000; i++) mean += meanNormalizedProfile(Math.sqrt((i + 0.5) / 1000), weight) / 1000;
    expect(mean).toBeCloseTo(1, 10);
    expect(meanNormalizedProfile(0, weight)).toBeCloseTo(1 / radialProfileMean(weight), 10);
    expect(meanNormalizedProfile(1.1, weight)).toBe(0);
  });

  it('separa la media espacial de la axial y conserva conversiones de unidades', () => {
    const v = tube();
    expect(radialProfileMean()).toBeCloseTo(0.575, 12);
    expect(flowForMeanVelocity(v.meanSpatialCms, v.radiusMm)).toBeCloseTo(v.flowMlMin, 12);
    expect(vesselAxialVelocityCms(v, 0.2) * radialProfileMean()).toBeCloseTo(
      vesselMeanVelocityCms(v, 0.2),
      12,
    );
    expect(flowForMeanVelocity(meanVelocityForFlow(-37, 1.4), 1.4)).toBeCloseTo(-37, 12);
  });

  it.each([{}, { venous: true }, { waveform: 'alta' as const }, { flowSign: -1 as const }])(
    'integra Q temporal y espacial con error <1%%: %j',
    (patch) => {
      const v = tube(patch);
      let q = 0;
      for (let i = 0; i < 128; i++) q += integratedFlow(v, i / 128) / 128;
      expect(Math.abs(q - v.flowSign * v.flowMlMin) / v.flowMlMin).toBeLessThan(0.01);
    },
  );

  it('preserva el caudal instantáneo en la garganta y en una sección proximal', () => {
    const v = tube({ stenosis: { sMm: 50, lengthMm: 8, radiusScale: 0.5 } });
    for (const phase of [0.1, 0.3, 0.7]) {
      const expected = flowForMeanVelocity(vesselMeanVelocityCms(v, phase), v.radiusMm);
      expect(integratedFlow(v, phase, -20)).toBeCloseTo(expected, 8);
      expect(integratedFlow(v, phase, 0)).toBeCloseTo(expected, 8);
    }
  });

  it('el estado hemodinámico basal conserva el caudal nominal sobre un ciclo', () => {
    const v = tube();
    let q = 0;
    for (let i = 0; i < 128; i++) q += integratedFlow(v, i / 128, 0, true) / 128;
    expect(Math.abs(q - v.flowMlMin) / v.flowMlMin).toBeLessThan(0.01);
  });

  it('todas las escenas construidas relacionan Q con la media espacial, no con TAMax', () => {
    for (const scene of [sim.head, sim.eyes.der, sim.eyes.izq, sim.neck.der, sim.neck.izq])
      for (const v of scene.vessels)
        expect(flowForMeanVelocity(v.meanSpatialCms, v.radiusMm)).toBeCloseTo(v.flowMlMin, 8);
  });

  it.each([-1, 2, NaN, Infinity])('rechaza peso no físico %s', (weight) => {
    expect(() => meanNormalizedProfile(0.5, weight)).toThrow();
  });
});
