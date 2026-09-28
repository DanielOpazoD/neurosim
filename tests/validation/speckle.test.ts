import { describe, expect, it } from 'vitest';
import { attenuationDbCm, MATERIALS } from '../../src/anatomy/materials';
import { defaultEyeSettings } from '../../src/domain/settings';
import { renderBMode, type BModeFrame } from '../../src/ultrasound/bmode';
import { probeBeamSpec } from '../../src/ultrasound/beam';
import { buildScan } from '../../src/ultrasound/probe';
import { applyPsfAndCompression } from '../../src/ultrasound/postIq';

function fatFrame(seed: string): {
  frame: BModeFrame;
  scan: ReturnType<typeof buildScan>;
  settings: ReturnType<typeof defaultEyeSettings>;
} {
  const settings = defaultEyeSettings();
  const scan = buildScan(
    {
      origin: [0, 0, 0],
      forward: [0, 0, 1],
      lateral: [1, 0, 0],
      markerAngleRad: 0,
      contactPressure: 0,
    },
    'linear',
    129,
  );
  const frame = renderBMode({ classify: () => 'grasaOrbitaria' }, scan, settings, seed, {
    electronicNoise: false,
  });
  return { frame, scan, settings };
}

function envelopeOf({ frame, scan, settings }: ReturnType<typeof fatFrame>): Float32Array {
  const beam = probeBeamSpec(settings.transducer, settings);
  return applyPsfAndCompression(frame.iq, frame.width, frame.height, frame.dzMm, scan, settings, beam)
    .envelope;
}

describe('estadística de speckle coherente', () => {
  it('la envoltura en tejido homogéneo sigue Rayleigh (media/σ ≈ 1,91)', () => {
    const built = fatFrame('speckle-rayleigh');
    const { frame } = built;
    const envelope = envelopeOf(built);
    const li0 = Math.floor(frame.width * 0.15);
    const li1 = Math.floor(frame.width * 0.85);
    // Por filas: dentro de una fila la ganancia (atenuación) es constante,
    // así que la razón media/σ mide la estadística de la envoltura sin
    // mezclar escalas de distinta profundidad.
    const snrs: number[] = [];
    for (let zi = Math.floor(frame.height * 0.3); zi < frame.height * 0.7; zi++) {
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      for (let li = li0; li < li1; li++) {
        const v = envelope[zi * frame.width + li]!;
        sum += v;
        sum2 += v * v;
        n++;
      }
      const mean = sum / n;
      const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      if (std > 0) snrs.push(mean / std);
    }
    snrs.sort((a, b) => a - b);
    const snr = snrs[Math.floor(snrs.length / 2)]!;
    console.log(`speckle SNR mediana=${snr.toFixed(3)} filas=${snrs.length}`);
    expect(snr).toBeGreaterThanOrEqual(1.6);
    expect(snr).toBeLessThanOrEqual(2.2);
  });

  it('la envoltura somera conserva la calibración de scatterAmp', () => {
    // Con normalización de energía de la PSF, outputPower 0 y atenuación
    // despreciable (<2 mm), la media de la envoltura ≈ scatterAmp·√(π/2).
    const settings = { ...defaultEyeSettings(), outputPowerDb: 0 };
    const scan = buildScan(
      {
        origin: [0, 0, 0],
        forward: [0, 0, 1],
        lateral: [1, 0, 0],
        markerAngleRad: 0,
        contactPressure: 0,
      },
      'linear',
      129,
    );
    const frame = renderBMode({ classify: () => 'grasaOrbitaria' }, scan, settings, 'speckle-cal', {
      electronicNoise: false,
    });
    const beam = probeBeamSpec(settings.transducer, settings);
    const { envelope } = applyPsfAndCompression(
      frame.iq,
      frame.width,
      frame.height,
      frame.dzMm,
      scan,
      settings,
      beam,
    );
    let sum = 0;
    let n = 0;
    const alpha = attenuationDbCm(MATERIALS.grasaOrbitaria, settings.frequencyMhz);
    let expectedSum = 0;
    for (let zi = 1; zi * frame.dzMm < 2; zi++) {
      const attLin = Math.pow(10, (-alpha * ((zi * frame.dzMm) / 10) * 2) / 20);
      for (let li = Math.floor(frame.width * 0.15); li < frame.width * 0.85; li++) {
        sum += envelope[zi * frame.width + li]!;
        expectedSum += 0.5 * Math.sqrt(Math.PI / 2) * attLin;
        n++;
      }
    }
    const expected = expectedSum / n;
    console.log(`envMedia=${(sum / n).toFixed(4)} esperada=${expected.toFixed(4)} n=${n}`);
    expect(sum / n).toBeGreaterThanOrEqual(0.7 * expected);
    expect(sum / n).toBeLessThanOrEqual(1.3 * expected);
  });

  it('misma semilla → mismo IQ complejo (determinista)', () => {
    const a = fatFrame('speckle-det');
    const b = fatFrame('speckle-det');
    expect(Array.from(b.frame.iq)).toEqual(Array.from(a.frame.iq));
  });
});
