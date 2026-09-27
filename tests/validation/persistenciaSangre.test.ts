import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import { m1Gate } from './helpers';

describe('persistencia de sangre en la puerta', () => {
  it('mantiene sangre en tres posiciones de M1 durante 30 s', () => {
    const sim = buildReferenceCase();
    const m1 = sim.head.vessels.find((v) => v.id === 'm1-der')!;
    for (const target of [m1.points[1]!, m1.points[2]!, m1.points[3]!]) {
      const chain = new PwDopplerChain(sim.head, sim.flow, sim.patient.seed);
      chain.setGate(m1Gate(sim, target));
      chain.begin(6000, 2e6, 20, 100, 0);
      let t = 0;
      let next = 5;
      while (t < 30) {
        chain.step({ t, cardiacPhase: sim.cardiac.phaseAt(t), heartRateBpm: 70 }, [0, 0, 0], 0.064);
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
