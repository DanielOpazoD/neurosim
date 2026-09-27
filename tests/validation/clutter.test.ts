import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { vesselClosest } from '../../src/anatomy/head';
import { tissueVelocityMmS, handTremorVelocityMmS } from '../../src/doppler/clutter';
import { cross, normalize, add, scale, sub } from '../../src/core/vec3';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import type { GateGeometry } from '../../src/doppler/sampleVolume';

describe('clutter tisular determinista', () => {
  it('es periódico, de media casi nula y menor de 3 mm/s', () => {
    const sim = buildReferenceCase();
    const point = add(sim.head.skullCenter, [0, 0, 0]);
    const period = sim.respiration.periodS;
    const first = tissueVelocityMmS({
      head: sim.head,
      point,
      cardiacPhase: 0.2,
      heartRateBpm: sim.patient.physiology.heartRateBpm,
      tSec: 0,
    });
    const second = tissueVelocityMmS({
      head: sim.head,
      point,
      cardiacPhase: 1.2,
      heartRateBpm: sim.patient.physiology.heartRateBpm,
      tSec: period,
    });
    expect(Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2])).toBeLessThan(1e-6);

    const mean = [0, 0, 0];
    let max = 0;
    for (let i = 0; i < 200; i += 1) {
      const phase = i / 200;
      const v = tissueVelocityMmS({
        head: sim.head,
        point,
        cardiacPhase: phase,
        heartRateBpm: sim.patient.physiology.heartRateBpm,
        tSec: phase * period,
      });
      mean[0]! += v[0];
      mean[1]! += v[1];
      mean[2]! += v[2];
      max = Math.max(max, Math.hypot(v[0], v[1], v[2]));
    }
    expect(Math.hypot(mean[0]! / 200, mean[1]! / 200, mean[2]! / 200)).toBeLessThan(0.35);
    expect(max).toBeLessThan(3);
  });

  it('decae con la distancia a la pared', () => {
    const sim = buildReferenceCase();
    const vessel = sim.head.vessels.find((item) => item.id === 'm1-der')!;
    const target = vessel.points[2]!;
    const tangent = vesselClosest(vessel, target).tangent;
    const radial = normalize(cross(tangent, [0, 1, 0]));
    const near = add(target, scale(radial, 1.5));
    const far = add(target, scale(radial, 5));
    const args = { head: sim.head, cardiacPhase: 0.2, heartRateBpm: 70, tSec: 0 };
    const vNear = tissueVelocityMmS({ ...args, point: near });
    const vFar = tissueVelocityMmS({ ...args, point: far });
    expect(Math.hypot(vFar[0], vFar[1])).toBeLessThan(Math.hypot(vNear[0], vNear[1]));
  });

  it('produce el mismo temblor para la misma semilla', () => {
    expect(handTremorVelocityMmS(0.123, 42)).toEqual(handTremorVelocityMmS(0.123, 42));
    expect(handTremorVelocityMmS(0.123, 42)).not.toEqual(handTremorVelocityMmS(0.123, 43));
  });

  it('hace observable el compromiso del filtro de pared en PW', () => {
    const sim = buildReferenceCase();
    const vessel = sim.head.vessels.find((item) => item.id === 'm1-der')!;
    const target = vessel.points[2]!;
    const beamDir = normalize(sub(target, sim.head.windowCenter.der));
    const gate: GateGeometry = {
      center: target,
      beamDir,
      lateral: normalize([-beamDir[2], 0, beamDir[0]]),
      elevation: normalize([
        beamDir[1] * beamDir[2],
        beamDir[2] * beamDir[2] + beamDir[0] * beamDir[0],
        -beamDir[1] * beamDir[0],
      ]),
      lengthMm: 6,
      lateralSigmaMm: 2.5,
      elevationSigmaMm: 5,
      pulseSigmaMm: 0.8,
      apertureAngleSigmaRad: 0.04,
      transmission: 0.5,
    };
    const lowBandPower = (wallFilterHz: number): number => {
      const chain = new PwDopplerChain(sim.head, sim.patient.seed);
      chain.setGate(gate);
      chain.begin(6000, 2e6, 20, wallFilterHz, 0);
      let t = 0;
      for (let i = 0; i < 32; i += 1) {
        chain.step(sim.physStateAt(t), [0, 0, 0], 0.064);
        chain.flush();
        t += 0.064;
      }
      return chain.spectral.columns.reduce((sum, column) => {
        const n = column.powerDb.length;
        return (
          sum +
          column.powerDb.reduce((band, db, index) => {
            const f = ((index - n / 2) * column.prfHz) / n;
            return band + (Math.abs(f) < 100 ? 10 ** (db / 10) : 0);
          }, 0)
        );
      }, 0);
    };
    expect(lowBandPower(50)).toBeGreaterThan(lowBandPower(200));
  }, 30000);
});
