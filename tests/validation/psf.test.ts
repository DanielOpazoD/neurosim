import { describe, expect, it } from 'vitest';
import { defaultEyeSettings } from '../../src/domain/settings';
import { renderBMode } from '../../src/ultrasound/bmode';
import { lateralFwhmMm, probeBeamSpec, sigmaFromFwhm } from '../../src/ultrasound/beam';
import { buildScan, LINEAR_APERTURE_MM } from '../../src/ultrasound/probe';
import type { Vec3 } from '../../src/core/vec3';

function fwhm(values: ArrayLike<number>, pitch: number): number {
  let peak = -Infinity;
  let peakIndex = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i]! > peak) {
      peak = values[i]!;
      peakIndex = i;
    }
  }
  const threshold = peak - 6;
  let left = peakIndex;
  let right = peakIndex;
  while (left > 0 && values[left - 1]! >= threshold) left--;
  while (right + 1 < values.length && values[right + 1]! >= threshold) right++;
  const crossing = (a: number, b: number): number => {
    const va = values[a]!;
    const vb = values[b]!;
    if (va === vb) return a;
    return a + (threshold - va) / (vb - va);
  };
  const leftEdge = left > 0 ? crossing(left - 1, left) : left;
  const rightEdge = right + 1 < values.length ? crossing(right + 1, right) : right;
  return (rightEdge - leftEdge) * pitch;
}

function sampledBoxGaussianFwhm(boxSamples: number, sigmaSamples: number, pitch: number): number {
  const radius = Math.ceil(boxSamples / 2 + sigmaSamples * 4);
  const values = new Float64Array(2 * radius + 1);
  const first = -Math.floor(boxSamples / 2);
  for (let i = -radius; i <= radius; i++) {
    for (let j = 0; j < boxSamples; j++) {
      const d = i - first - j;
      values[i + radius] = values[i + radius]! + Math.exp(-(d * d) / (2 * sigmaSamples * sigmaSamples));
    }
  }
  const db = values.map((value) => 20 * Math.log10(value));
  return fwhm(db, pitch);
}

function psfSetup() {
  const settings = defaultEyeSettings();
  const pose = {
    origin: [0, 0, 0] as Vec3,
    forward: [0, 0, 1] as Vec3,
    lateral: [1, 0, 0] as Vec3,
    markerAngleRad: 0,
    contactPressure: 0,
  };
  const lineCount = 129;
  const pitch = LINEAR_APERTURE_MM / (lineCount - 1);
  const scan = buildScan(pose, 'linear', lineCount);
  const dz = Math.max(0.08, 1.5 * (1.54 / settings.frequencyMhz));
  const plateRow = Math.round(settings.focusMm / dz);
  const scene = {
    classify(p: Vec3) {
      return Math.abs(p[2] - settings.focusMm) < 0.25 && Math.abs(p[0]) < 0.4 ? 'paredGlobo' : 'vitrio';
    },
  };
  return { settings, pose, pitch, scan, dz, plateRow, scene };
}

describe('validación del PSF', () => {
  it('la placa de 0,8 mm reproduce la predicción caja-gaussiana', () => {
    const { settings, pitch, scan, plateRow, scene } = psfSetup();
    const frame = renderBMode(scene, scan, settings, 'psf');
    const lateral = Array.from({ length: frame.width }, (_, li) => frame.db[plateRow * frame.width + li]!);
    const measured = fwhm(lateral, pitch);
    const beam = probeBeamSpec(settings.transducer, settings);
    const sigmaL = sigmaFromFwhm(lateralFwhmMm(beam, settings.focusMm));
    const expected = sampledBoxGaussianFwhm(Math.max(1, Math.round(0.8 / pitch)), sigmaL / pitch, pitch);
    expect(measured).toBeGreaterThan(expected * 0.85);
    expect(measured).toBeLessThan(expected * 1.15);
  });

  it('mide la PSF pura de una placa de una línea', () => {
    const { settings, pitch, scan, plateRow } = psfSetup();
    const scene = {
      classify(p: Vec3) {
        return Math.abs(p[2] - settings.focusMm) < 0.25 && Math.abs(p[0]) < 0.05 ? 'paredGlobo' : 'vitrio';
      },
    };
    const frame = renderBMode(scene, scan, settings, 'psf-pura', { speckle: false });
    const lateral = Array.from({ length: frame.width }, (_, li) => frame.db[plateRow * frame.width + li]!);
    const measured = fwhm(lateral, pitch);
    const beam = probeBeamSpec(settings.transducer, settings);
    const sigmaL = Math.max(0.6, sigmaFromFwhm(lateralFwhmMm(beam, settings.focusMm)) / pitch);
    const expected = sampledBoxGaussianFwhm(1, sigmaL, pitch);
    expect(measured).toBeGreaterThan(expected * 0.85);
    expect(measured).toBeLessThan(expected * 1.15);
  });

  it('mide el ancho axial y el ensanchamiento por desenfoque', () => {
    const { settings, pitch, scan, plateRow, dz, scene } = psfSetup();
    const frame = renderBMode(scene, scan, settings, 'psf-limpio', { speckle: false });
    const centerLine = Math.floor(scan.lineCount / 2);
    const axial = Array.from({ length: frame.height }, (_, zi) => frame.db[zi * frame.width + centerLine]!);
    const sigmaAxial = Math.max(1, 2.2 / settings.frequencyMhz / dz);
    const axialExpected = sampledBoxGaussianFwhm(Math.ceil(0.5 / dz), sigmaAxial, dz);
    expect(fwhm(axial, dz)).toBeGreaterThan(axialExpected * 0.9);
    expect(fwhm(axial, dz)).toBeLessThan(axialExpected * 1.1);

    const lateral = Array.from({ length: frame.width }, (_, li) => frame.db[plateRow * frame.width + li]!);
    const defocusRow = Math.round((settings.focusMm + 15) / dz);
    const defocused = Array.from(
      { length: frame.width },
      (_, li) => frame.db[defocusRow * frame.width + li]!,
    );
    expect(fwhm(lateral, pitch)).toBeLessThan(fwhm(defocused, pitch));
  });
});
