import { describe, expect, it } from 'vitest';
import type { MaterialId } from '../../src/anatomy/materials';
import type { Vec3 } from '../../src/core/vec3';
import { defaultEyeSettings, defaultTemporalSettings } from '../../src/domain/settings';
import { interfaceNormal, refractDirection, renderBMode } from '../../src/ultrasound/bmode';
import { buildScan } from '../../src/ultrasound/probe';

const scan = buildScan(
  { origin: [0, 0, 0], forward: [0, 0, 1], lateral: [1, 0, 0], markerAngleRad: 0, contactPressure: 0 },
  'linear',
  33,
);
const settings = { ...defaultEyeSettings(), frequencyMhz: 7.5, depthMm: 50, outputPowerDb: 0, tgcDb: [0, 0] };
const render = (
  classify: (p: Vec3) => MaterialId,
  outputPowerDb = 0,
  electronicNoise = false,
  gainDb = settings.gainDb,
) =>
  renderBMode({ classify }, scan, { ...settings, outputPowerDb, gainDb }, 'causal-bmode', {
    axialStepMm: 0.1,
    electronicNoise,
  });
const scenes: Record<string, (p: Vec3) => MaterialId> = {
  lateral: (p) => (Math.abs(p[0]) < 1 ? 'esclera' : 'vitrio'),
  reverberacion: (p) => (p[2] < 10 ? 'piel' : p[2] < 10.5 ? 'hueso' : 'vitrio'),
  espejo: (p) => (p[2] < 20 ? 'vitrio' : p[2] < 21 ? 'hueso' : 'vitrio'),
};

describe('causalidad de interfaces y emisión B-mode', () => {
  it('conserva el signo relativo de la normal al reflejar el plano', () => {
    for (const sign of [-1, 1]) {
      const scene = { classify: (p: Vec3): MaterialId => (p[2] + sign * p[0] < 0 ? 'vitrio' : 'esclera') };
      const n = interfaceNormal(scene, [0, 0, 0], 'vitrio')!;
      expect(Math.abs((sign * n[0] + n[2]) / Math.sqrt(2))).toBeCloseTo(1, 6);
    }
  });

  it('el retorno axial sin speckle es mayor a incidencia normal que oblicua', () => {
    const peak = (slope: number) => {
      const frame = renderBMode(
        { classify: (p): MaterialId => (p[2] + slope * p[0] < 10 ? 'vitrio' : 'esclera') },
        scan,
        settings,
        'plano',
        { axialStepMm: 0.1, speckle: false, lateralInterfaces: false, txFocusGain: false },
      );
      const line = Math.floor(frame.width / 2);
      return Math.max(
        ...Array.from({ length: 120 }, (_, z) => Math.abs(frame.iq[2 * (z * frame.width + line)]!)),
      );
    };
    expect(peak(0)).toBeGreaterThan(peak(1) * 1.1);
    expect(peak(1)).toBeCloseTo(peak(-1), 6);
  });

  it('Snell acústico aleja de la normal al entrar en un medio más rápido y es reversible', () => {
    const incident: Vec3 = [0.5, 0, Math.sqrt(3) / 2];
    const transmitted = refractDirection(incident, [0, 0, 1], 1532, 1641);
    expect(transmitted[0]).toBeCloseTo(0.5355744125, 8);
    const restored = refractDirection(transmitted, [0, 0, -1], 1641, 1532);
    restored.forEach((v, i) => expect(v).toBeCloseTo(incident[i]!, 10));
  });

  it('la marcha del rayo desvía hacia el lado correcto en una cuña de cristalino', () => {
    const samples: Vec3[] = [];
    const wedgeScan = buildScan(
      { origin: [-2, 0, 0], forward: [0, 0, 1], lateral: [1, 0, 0], markerAngleRad: 0, contactPressure: 0 },
      'linear',
      1,
    );
    renderBMode(
      {
        classify: (p): MaterialId => (p[2] + p[0] < 10 ? 'vitrio' : 'cristalino'),
        scatterScale: (p) => {
          samples.push([...p]);
          return 1;
        },
      },
      wedgeScan,
      { ...settings, depthMm: 30 },
      'snell-wedge',
      { axialStepMm: 0.1, electronicNoise: false },
    );
    expect(samples.at(-1)![0]).toBeLessThan(-2.1);
  });

  it('el ruido receptor no depende de las interfaces ni produce una copia especular', () => {
    const empty = render(() => 'vitrio', 0, true);
    const emptySignal = render(() => 'vitrio');
    const mirror = render(scenes.espejo!, 0, true);
    const mirrorSignal = render(scenes.espejo!);
    let energy = 0;
    let error = 0;
    for (let i = 0; i < empty.iq.length; i++) {
      const noise = empty.iq[i]! - emptySignal.iq[i]!;
      const residual = mirror.iq[i]! - mirrorSignal.iq[i]! - noise;
      energy += noise * noise;
      error += residual * residual;
    }
    expect(error / energy).toBeLessThan(1e-8);
  });

  for (const [frequencyMhz, depthMm, kind] of [
    [7.5, 30, 'linear'],
    [15, 60, 'linear'],
    [2, 80, 'sector'],
    [4, 120, 'sector'],
  ] as const) {
    it(`conserva estructura IQ al compensar emisión en ${kind}, ${frequencyMhz} MHz, ${depthMm} mm`, () => {
      const s = {
        ...(kind === 'linear' ? defaultEyeSettings() : defaultTemporalSettings()),
        frequencyMhz,
        depthMm,
      };
      const geometry = buildScan(
        { origin: [0, 0, 0], forward: [0, 0, 1], lateral: [1, 0, 0], markerAngleRad: 0, contactPressure: 0 },
        kind,
        33,
      );
      const make = (outputPowerDb: number, gainDb: number) =>
        renderBMode(
          { classify: scenes.reverberacion! },
          geometry,
          { ...s, outputPowerDb, gainDb },
          'frequency-matrix',
          { electronicNoise: false },
        );
      const high = make(0, 0);
      const low = make(-20, 20);
      let count = 0;
      for (let i = 0; i < high.db.length; i++) {
        // Evitar el suelo aditivo 1e-6: solo señal resoluble, no píxeles recortados.
        if (high.db[i]! > -50) {
          expect(Math.abs(high.db[i]! - low.db[i]!)).toBeLessThan(0.1);
          count++;
        }
      }
      expect(count).toBeGreaterThan(10);
      expect(low.scan).toBe(high.scan);
      expect(low.dzMm).toBe(high.dzMm);
    });
  }

  for (const [name, classify] of Object.entries(scenes)) {
    it(`${name}: todo IQ acústico escala con emisión, sin cambiar su geometría`, () => {
      const high = render(classify);
      const low = render(classify, -20);
      let peak = 0;
      let maxError = 0;
      for (let i = 0; i < high.iq.length; i++) {
        peak = Math.max(peak, Math.abs(high.iq[i]!));
        maxError = Math.max(maxError, Math.abs(low.iq[i]! - high.iq[i]! * 0.1));
      }
      expect(peak).toBeGreaterThan(0.01);
      expect(maxError / peak).toBeLessThan(2e-6);
    });

    it(`${name}: el ruido receptor no se refleja ni depende de la emisión`, () => {
      const high = render(classify, 0, true);
      const highSignal = render(classify);
      const low = render(classify, -20, true);
      const lowSignal = render(classify, -20);
      let noiseEnergy = 0;
      let errorEnergy = 0;
      for (let i = 0; i < high.iq.length; i++) {
        const noise = high.iq[i]! - highSignal.iq[i]!;
        const residual = low.iq[i]! - lowSignal.iq[i]! - noise;
        noiseEnergy += noise * noise;
        errorEnergy += residual * residual;
      }
      expect(noiseEnergy).toBeGreaterThan(0);
      expect(errorEnergy / noiseEnergy).toBeLessThan(1e-8);
    });
  }
});
