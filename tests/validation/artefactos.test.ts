import { describe, expect, it } from 'vitest';
import { attenuationDbCm, MATERIALS, type MaterialId } from '../../src/anatomy/materials';
import type { AcquisitionSettings, ProbePose } from '../../src/domain/contracts';
import { defaultEyeSettings } from '../../src/domain/settings';
import { renderBMode } from '../../src/ultrasound/bmode';
import { buildScan } from '../../src/ultrasound/probe';

const pose: ProbePose = {
  origin: [0, 0, 0],
  forward: [0, 0, 1],
  lateral: [1, 0, 0],
  markerAngleRad: 0,
  contactPressure: 0,
};

function settings(depthMm = 60): AcquisitionSettings {
  return { ...defaultEyeSettings(), depthMm, frequencyMhz: 7.5 };
}

function frameFor(classify: (zMm: number) => MaterialId, depthMm = 60) {
  const scan = buildScan(pose, 'linear', 65);
  return renderBMode({ classify: (p) => classify(p[2]) }, scan, settings(depthMm), 'artifact-validation', {
    axialStepMm: 0.1,
    speckle: false,
  });
}

function centerProfile(frame: ReturnType<typeof frameFor>): number[] {
  const line = Math.floor(frame.width / 2);
  return Array.from({ length: frame.height }, (_, zi) => frame.db[zi * frame.width + line]!);
}

function peakAt(profile: readonly number[], depthMm: number, targetMm: number, windowMm = 0.4): number {
  const row = Math.round((targetMm / depthMm) * (profile.length - 1));
  const radius = Math.max(1, Math.round((windowMm / depthMm) * profile.length));
  return Math.max(...profile.slice(Math.max(0, row - radius), row + radius + 1));
}

describe('artefactos acústicos emergentes', () => {
  it('genera réplicas de reverberación a dos y tres profundidades', () => {
    const profile = centerProfile(frameFor((z) => (z < 10 ? 'piel' : z < 10.5 ? 'hueso' : 'vitrio')));
    const p20 = peakAt(profile, 60, 20);
    const p30 = peakAt(profile, 60, 30);
    expect(p20).toBeGreaterThan(-80);
    expect(p30).toBeGreaterThan(-90);
    expect(p20).toBeGreaterThan(p30);
  });

  it('copia un tramo anterior como espejo más débil', () => {
    const profile = centerProfile(
      frameFor((z) =>
        z < 25 ? 'vitrio' : z < 25.5 ? 'paredGlobo' : z < 30 ? 'vitrio' : z < 30.5 ? 'hueso' : 'vitrio',
      ),
    );
    expect(peakAt(profile, 60, 35)).toBeGreaterThan(-85);
    expect(peakAt(profile, 60, 35)).toBeLessThan(peakAt(profile, 60, 25) + 1);
  });

  it('genera al menos cuatro ecos regulares tras una lámina ósea fina', () => {
    const profile = centerProfile(frameFor((z) => (z < 20 ? 'vitrio' : z < 20.5 ? 'hueso' : 'vitrio')));
    const peaks = [21, 21.5, 22, 22.5, 23, 23.5].map((depth) => peakAt(profile, 60, depth, 0.2));
    expect(peaks.filter((value) => value > -90).length).toBeGreaterThanOrEqual(4);
  });

  it('mantiene explícita la ley de potencia en materiales de referencia', () => {
    expect(attenuationDbCm(MATERIALS.vitrio, 7.5)).toBeCloseTo(0.12 * 7.5, 10);
  });
});
