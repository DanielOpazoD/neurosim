import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/core/vec3';
import { defaultEyeSettings, defaultTemporalSettings } from '../../src/domain/settings';
import { renderBMode, refractDirection } from '../../src/ultrasound/bmode';
import { elevationFwhmMm, lateralFwhmMm, probeBeamSpec, sigmaFromFwhm } from '../../src/ultrasound/beam';
import { buildScan } from '../../src/ultrasound/probe';

describe('modelo analítico del haz', () => {
  it('cumple FWHM = lambda F / D en foco', () => {
    const spec = {
      apertureMm: 12,
      elevationApertureMm: 4,
      focusMm: 35,
      elevationFocusMm: 25,
      frequencyMhz: 7.5,
      soundSpeedMs: 1540,
    };
    const expected = (1540 / (7.5 * 1000)) * (35 / 12);
    expect(lateralFwhmMm(spec, 35)).toBeCloseTo(expected, 6);
    expect(elevationFwhmMm(spec, 25)).toBeCloseTo((1540 / (7.5 * 1000)) * (25 / 4), 6);
    expect(lateralFwhmMm(spec, 35)).toBeCloseTo(0.6, 1);
  });

  it('ensancha el haz al alejarse del foco', () => {
    const settings = defaultEyeSettings();
    const spec = probeBeamSpec('linear', settings);
    expect(lateralFwhmMm(spec, settings.focusMm)).toBeLessThan(lateralFwhmMm(spec, settings.focusMm + 10));
    expect(lateralFwhmMm(spec, settings.focusMm + 10)).toBeLessThan(
      lateralFwhmMm(spec, settings.focusMm + 20),
    );
  });

  it('reduce sigma en líneas para un sector al crecer el pitch con z', () => {
    const settings = defaultTemporalSettings();
    const spec = probeBeamSpec('sector', settings);
    const pitchAt = (zMm: number) => (zMm * (40 * Math.PI)) / 180 / (64 - 1);
    const sigmaInLines = (zMm: number) => sigmaFromFwhm(lateralFwhmMm(spec, zMm)) / pitchAt(zMm);
    expect(sigmaInLines(30)).toBeGreaterThan(sigmaInLines(90));
  });
});

describe('refracción del cristalino', () => {
  it('rota el rayo según Snell y conserva la dirección en reflexión total', () => {
    const refracted = refractDirection([Math.sin(0.2), 0, Math.cos(0.2)], [0, 0, -1], 1532 / 1641);
    expect(refracted[0]).toBeLessThan(Math.sin(0.2));
    expect(refracted[2]).toBeGreaterThan(0);
    expect(refractDirection([1, 0, 0], [0, 0, -1], 2)).toEqual([1, 0, 0]);
  });

  it('hace aparecer más superficial una placa posterior al cristalino', () => {
    const settings = defaultEyeSettings();
    const pose = {
      origin: [0, 0, 0] as Vec3,
      forward: [0, 0, 1] as Vec3,
      lateral: [1, 0, 0] as Vec3,
      markerAngleRad: 0,
      contactPressure: 0,
    };
    const scan = buildScan(pose, 'linear', 65);
    const scene = {
      classify(p: Vec3) {
        if (Math.abs(p[2] - 24) < 0.25) return 'paredGlobo' as const;
        if (p[0] * p[0] + (p[2] - 10) * (p[2] - 10) < 16) return 'cristalino' as const;
        return 'vitrio' as const;
      },
    };
    const frame = renderBMode(scene, scan, settings, 'crystal-refraction', {
      axialStepMm: 0.1,
      speckle: false,
    });
    const peakAt = (lineIndex: number): number => {
      let best = -Infinity;
      let bestRow = 0;
      for (let zi = 180; zi < 300; zi++) {
        const value = frame.db[zi * frame.width + lineIndex]!;
        if (value > best) {
          best = value;
          bestRow = zi;
        }
      }
      return bestRow;
    };
    const center = peakAt(32);
    const outside = peakAt(0);
    expect(center).toBeLessThan(outside);
  });
});
