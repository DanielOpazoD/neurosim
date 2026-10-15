import { describe, expect, it } from 'vitest';
import { attenuationDbCm, MATERIALS, type MaterialId } from '../../src/anatomy/materials';
import { dist, type Vec3 } from '../../src/core/vec3';
import { defaultTemporalSettings } from '../../src/domain/settings';
import { pathAttenuationDb } from '../../src/ultrasound/attenuation';
import { renderBMode } from '../../src/ultrasound/bmode';
import { FISICA_US } from '../../src/ultrasound/params';
import { buildScan } from '../../src/ultrasound/probe';
import { scatterComplex } from '../../src/ultrasound/speckle';

const seed = 'absorcion-fisica';
const cRef = FISICA_US.params.soundSpeedMs.value;
const scan = buildScan(
  { origin: [0, 0, 0], forward: [0, 0, 1], lateral: [1, 0, 0], markerAngleRad: 0, contactPressure: 0 },
  'sector',
  1,
);

function acquire(classify: (p: Vec3) => MaterialId, frequencyMhz: number, axialStepMm: number) {
  const points: Vec3[] = [];
  const frame = renderBMode(
    {
      classify,
      scatterScale: (p) => {
        points.push([...p]);
        return 1;
      },
    },
    scan,
    { ...defaultTemporalSettings(), frequencyMhz, depthMm: 60, outputPowerDb: 0 },
    seed,
    { axialStepMm, electronicNoise: false, txFocusGain: false, lateralInterfaces: false },
  );
  const lossDbAt = (row: number) => {
    const p = points[row]!;
    const [, sourceIm] = scatterComplex(`speckle-${seed}`, p, MATERIALS[classify(p)].scatterAmp);
    return -20 * Math.log10(Math.abs(frame.iq[row * 2 + 1]! / sourceIm));
  };
  return { frame, points, lossDbAt };
}

describe('absorción B-mode por distancia física (DEC-83)', () => {
  for (const material of ['grasaOrbitaria', 'tejidoCerebral', 'piel', 'hueso'] as const) {
    for (const frequency of [2, 4]) {
      it(`${material}, ${frequency} MHz: A = 2·α(f)·L sin confundir L con profundidad reconstruida`, () => {
        const classify = () => material;
        const { frame, points, lossDbAt } = acquire(classify, frequency, 0.2);
        for (const row of [0, 10, 25, 50]) {
          const physicalMm = dist(scan.apex, points[row]!);
          const displayedMm = row * frame.dzMm;
          expect(physicalMm).toBeCloseTo((displayedMm * MATERIALS[material].cMs) / cRef, 9);
          const expected = (2 * attenuationDbCm(MATERIALS[material], frequency) * physicalMm) / 10;
          expect(lossDbAt(row)).toBeCloseTo(expected, 5);
          expect(lossDbAt(row)).toBeCloseTo(
            pathAttenuationDb(classify, scan.apex, points[row]!, frequency),
            5,
          );
        }
      });
    }
  }

  for (const thicknessMm of [2, 6]) {
    for (const frequency of [2, 4]) {
      it(`placa de ${thicknessMm} mm a ${frequency} MHz: converge a absorción analítica`, () => {
        const classify = (p: Vec3): MaterialId =>
          p[2] >= 4 && p[2] < 4 + thicknessMm ? 'hueso' : 'tejidoCerebral';
        const boneAlpha = attenuationDbCm(MATERIALS.hueso, frequency);
        const tissueAlpha = attenuationDbCm(MATERIALS.tejidoCerebral, frequency);
        for (const dz of [0.4, 0.1, 0.025]) {
          const { frame, points, lossDbAt } = acquire(classify, frequency, dz);
          const row = frame.height - 1;
          const lengthMm = points[row]![2];
          const expected = (2 * (boneAlpha * thicknessMm + tissueAlpha * (lengthMm - thicknessMm))) / 10;
          // Marcha de primer orden: cada cruce se localiza dentro de un paso físico.
          const boundDb =
            (2 *
              Math.abs(boneAlpha - tissueAlpha) *
              dz *
              (MATERIALS.hueso.cMs + MATERIALS.tejidoCerebral.cMs)) /
            cRef /
            10;
          expect(Math.abs(lossDbAt(row) - expected)).toBeLessThan(boundDb + 1e-5);
        }
      });
    }
  }
});
