import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { inTemporalWindow } from '../../src/anatomy/head';
import { headScene } from '../../src/app/renderRequest';
import { defaultTemporalSettings } from '../../src/domain/settings';
import { buildScan } from '../../src/ultrasound/probe';
import { renderBMode } from '../../src/ultrasound/bmode';
import { skullAttenuationDb } from '../../src/ultrasound/attenuation';
import { temporalPose } from './helpers';

describe('ventana temporal y B-mode', () => {
  const sim = buildReferenceCase();
  it('distingue pertenencia de ambas ventanas', () => {
    for (const side of ['der', 'izq'] as const) {
      expect(inTemporalWindow(sim.head, side, sim.head.windowCenter[side])).toBe(true);
      expect(inTemporalWindow(sim.head, side, sim.head.windowCenter[side === 'der' ? 'izq' : 'der'])).toBe(
        false,
      );
    }
  });
  for (const side of ['der', 'izq'] as const)
    it(`calidad afecta señal profunda, no piel, lado ${side}`, () => {
      const scan = buildScan(temporalPose(sim, side), 'sector', 1),
        settings = defaultTemporalSettings();
      const weak = { ...sim.head, windowQuality: sim.head.windowQuality / 2 };
      const high = renderBMode(headScene(sim.head, 'window'), scan, settings, 'window', {
        electronicNoise: false,
      });
      const low = renderBMode(headScene(weak, 'window'), scan, settings, 'window', {
        electronicNoise: false,
      });
      let energy = 0,
        error = 0;
      for (let z = 0; z < high.height; z++) {
        if (z * high.dzMm < 3) {
          expect(low.iq[z * 2]).toBe(high.iq[z * 2]);
          expect(low.iq[z * 2 + 1]).toBe(high.iq[z * 2 + 1]);
        }
        if (z * high.dzMm > 40 && z * high.dzMm < 70) {
          const h = high.iq[z * 2 + 1]!,
            l = low.iq[z * 2 + 1]!;
          energy += h * h;
          error += (l - h / 2) ** 2;
        }
      }
      expect(energy).toBeGreaterThan(1e-8);
      expect(error / energy).toBeLessThan(1e-8);
      const from = scan.apex,
        to = sim.head.midbrainCenter;
      expect(skullAttenuationDb(weak, from, to, 2) - skullAttenuationDb(sim.head, from, to, 2)).toBeCloseTo(
        6.0205999,
        5,
      );
    });
});
