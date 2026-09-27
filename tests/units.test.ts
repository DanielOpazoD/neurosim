import { describe, expect, it } from 'vitest';
import {
  dopplerShiftHz,
  nyquistVelocityCms,
  velocityFromShiftMmS,
  wrapToNyquist,
  prfFromNyquistCms,
  C_RECONSTRUCTION_MM_S,
} from '../src/core/units';
import { SeededRandom } from '../src/core/random';
import { SimulationClock } from '../src/core/clock';

describe('conversión Doppler', () => {
  it('fD = 2·f0·v/c: 1 m/s hacia la sonda a 2 MHz ≈ 2597 Hz', () => {
    const f = dopplerShiftHz(1000, 2e6); // 1000 mm/s
    expect(f).toBeCloseTo((2 * 2e6 * 1000) / C_RECONSTRUCTION_MM_S, 3);
  });
  it('velocityFromShiftMmS invierte dopplerShiftHz a ángulo 0', () => {
    const v = 850; // mm/s
    const f = dopplerShiftHz(v, 2e6);
    expect(velocityFromShiftMmS(f, 2e6, 0)).toBeCloseTo(v, 6);
  });
  it('ángulo de corrección 60° dobla la velocidad rotulada', () => {
    const f = dopplerShiftHz(500, 2e6);
    const v0 = velocityFromShiftMmS(f, 2e6, 0);
    const v60 = velocityFromShiftMmS(f, 2e6, Math.PI / 3);
    expect(v60).toBeCloseTo(2 * v0, 6);
  });
  it('wrapToNyquist pliega f > PRF/2 al lado opuesto', () => {
    expect(wrapToNyquist(3000, 4000)).toBeCloseTo(-1000);
    expect(wrapToNyquist(-3000, 4000)).toBeCloseTo(1000);
  });
  it('prfFromNyquistCms es la inversa de nyquistVelocityCms', () => {
    const prf = prfFromNyquistCms(60, 2e6);
    expect(nyquistVelocityCms(prf, 2e6, 0)).toBeCloseTo(60, 6);
  });
});

describe('reloj y semilla', () => {
  it('SimulationClock avanza en pasos fijos de dt', () => {
    const c = new SimulationClock(0.004);
    expect(c.requestSteps(0.1)).toBe(25);
    for (let i = 0; i < 25; i++) c.advance();
    expect(c.t).toBeCloseTo(0.1, 9);
  });
  it('SeededRandom es determinista y fork separa secuencias', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    expect(a.uint32()).toBe(b.uint32());
    const f1 = a.fork('x').uint32();
    const f2 = new SeededRandom(43).fork('x').uint32();
    expect(f1).not.toBe(f2);
  });
});
