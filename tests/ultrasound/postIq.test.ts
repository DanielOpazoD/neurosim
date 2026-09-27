import { describe, expect, it } from 'vitest';
import { buildScan } from '../../src/ultrasound/probe';
import { lateralFwhmMm, probeBeamSpec, sigmaFromFwhm, sidelobeLevelDb } from '../../src/ultrasound/beam';
import { beamKernel, gaussKernel, psfKernelsTexture } from '../../src/ultrasound/postIq';
import { defaultEyeSettings } from '../../src/domain/settings';
import type { ProbePose } from '../../src/domain/contracts';
import { FISICA_US } from '../../src/ultrasound/params';

describe('kernels post-IQ compartidos con WebGL2', () => {
  it('reproduce exactamente los coeficientes axiales y laterales de CPU', () => {
    const settings = defaultEyeSettings();
    const pose: ProbePose = {
      origin: [0, 0, 0],
      forward: [0, 0, 1],
      lateral: [1, 0, 0],
      markerAngleRad: 0,
      contactPressure: 0.3,
    };
    const scan = buildScan(pose, 'linear', 16);
    const beam = probeBeamSpec('linear', settings);
    const dz = 0.2;
    const kernels = psfKernelsTexture(scan.lineCount, 40, dz, scan, beam);
    expect(kernels.axial.w).toEqual(
      gaussKernel(Math.max(1, FISICA_US.params.axialPulseMmMhz.value / settings.frequencyMhz / dz)).w,
    );
    const epsilon = 10 ** (-28 / 20);
    for (let zi = 0; zi < 40; zi++) {
      const zMm = zi * dz;
      const pitch = scan.widthMmOrRad / (scan.lineCount - 1);
      const expected = beamKernel(Math.max(0.6, sigmaFromFwhm(lateralFwhmMm(beam, zMm)) / pitch), epsilon);
      const row = kernels.lateral.slice(
        zi * (kernels.lateralRadius * 2 + 1),
        (zi + 1) * (kernels.lateralRadius * 2 + 1),
      );
      const padded = new Float32Array(row.length);
      for (let i = -kernels.lateralRadius; i <= kernels.lateralRadius; i++) {
        padded[i + kernels.lateralRadius] = Math.abs(i) <= expected.r ? expected.w[i + expected.r]! : 0;
      }
      expect(row).toEqual(padded);
    }
    expect(sidelobeLevelDb(beam)).toBe(-28);
  });
});
