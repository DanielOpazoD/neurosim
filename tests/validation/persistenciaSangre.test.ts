import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import { m1Gate } from './helpers';

describe('persistencia de sangre en la puerta', () => {
  it('mantiene sangre en tres posiciones de M1 durante 30 s', () => {
    const sim = buildReferenceCase();
    const m1 = sim.head.vessels.find((v) => v.id === 'm1-der')!;
    // M1 viene remuestreado a ~1 mm: tomar puntos al 25/50/75 % de la curva.
    const at = (f: number) => m1.points[Math.min(m1.points.length - 1, Math.floor(m1.points.length * f))]!;
    for (const target of [at(0.25), at(0.5), at(0.75)]) {
      const chain = new PwDopplerChain(sim.head, sim.patient.seed);
      chain.setGate(m1Gate(sim, target));
      chain.begin(6000, 2e6, 20, 100, 0);
      let t = 0;
      let next = 5;
      while (t < 30) {
        chain.step(sim.physStateAt(t), [0, 0, 0], 0.064);
        chain.flush();
        t += 0.064;
        if (t >= next) {
          expect(chain.sampleVolume.lastComposition.bloodFraction).toBeGreaterThanOrEqual(0.03);
          next += 10;
        }
      }
    }
  }, 90000);
});
