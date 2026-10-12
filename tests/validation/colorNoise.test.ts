import { SeededRandom } from '../../src/core/random';
import { DOPPLER } from '../../src/doppler/params';
import { expect, it, vi } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { defaultTemporalSettings } from '../../src/domain/settings';
import { renderColorDoppler } from '../../src/doppler/color';
import { buildScan } from '../../src/ultrasound/probe';
import { temporalPose } from './helpers';

it('la pérdida creciente acaba en señal no disponible, no color de ruido', () => {
  const sim = buildReferenceCase(),
    settings = defaultTemporalSettings(),
    pose = temporalPose(sim, 'der');
  const counts = [0, 40, 60, 80, 100, 120, Infinity].map((loss) => {
    const g = renderColorDoppler(
      { ...sim.head, attenuationDb: () => loss },
      sim.flow,
      buildScan(pose, 'sector', 64),
      pose,
      settings,
      sim.patient.seed,
      0.2,
      settings.colorBox,
    );
    return g.vel.filter(Number.isFinite).length;
  });
  console.info('celdas disponibles por pérdida', counts);
  expect(counts[0]).toBeGreaterThan(10);
  expect(counts[3]).toBeLessThan(counts[0]!);
  expect(counts[4]).toBe(0);
  expect(counts[5]).toBe(0);
  expect(counts[6]).toBe(0);
});

it('sin eco: cota empírica de falsas detecciones sobre 49152 celdas y ganancia alta', () => {
  const sim = buildReferenceCase(),
    settings = { ...defaultTemporalSettings(), dopplerGainDb: 30 },
    pose = temporalPose(sim, 'der');
  const scene = {
    ...sim.head,
    vessels: [
      {
        ...sim.head.vessels[0]!,
        radiusMm: 10000,
        aabb: {
          min: [-10000, -10000, -10000] as [number, number, number],
          max: [10000, 10000, 10000] as [number, number, number],
        },
      },
    ],
    attenuationDb: () => Infinity,
  };
  let accepted = 0,
    total = 0;
  const firstNoiseSamples = new Set<number>();
  const gaussian = SeededRandom.prototype.gaussian;
  let gaussianCalls = 0;
  const spy = vi.spyOn(SeededRandom.prototype, 'gaussian').mockImplementation(function (this: SeededRandom) {
    const value = gaussian.call(this);
    if (gaussianCalls++ % (2 * DOPPLER.params.colorEnsemble.value) === 0) firstNoiseSamples.add(value);
    return value;
  });
  try {
    for (const seed of [17, 103, 601, 20261012]) {
      const g = renderColorDoppler(
        scene,
        sim.flow,
        buildScan(pose, 'sector', 64),
        pose,
        settings,
        seed,
        0.2,
        settings.colorBox,
      );
      accepted += g.vel.filter(Number.isFinite).length;
      total += g.vel.length;
      for (let i = 0; i < g.vel.length; i++) if (!Number.isFinite(g.vel[i])) expect(g.pow[i]).toBe(0);
    }
  } finally {
    spy.mockRestore();
  }
  expect(firstNoiseSamples.size).toBeGreaterThan(total * 0.99);
  console.info('falsos colores sin eco', { accepted, total, rate: accepted / total });
  expect(total).toBe(49152);
  expect(accepted / total).toBeLessThanOrEqual(1e-4);
});
