import { describe, expect, it } from 'vitest';
import { ensembleWallFilter, kasaiEstimate, kasaiVariance, kasaiVelocityCms } from '../../src/doppler/kasai';

function tone(fdHz: number, prfHz: number, n: number): [Float32Array, Float32Array] {
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let k = 0; k < n; k += 1) {
    const phase = (2 * Math.PI * fdHz * k) / prfHz;
    re[k] = Math.cos(phase);
    im[k] = Math.sin(phase);
  }
  return [re, im];
}

describe('autocorrelación de Kasai', () => {
  it('recupera la velocidad de un tono monocromático con menos de 1 % de error', () => {
    const prf = 4000;
    const f0 = 2e6;
    const expectedCms = 42;
    const fd = (2 * f0 * (expectedCms / 100)) / 1540;
    const [re, im] = tone(-fd, prf, 32);
    const estimate = kasaiEstimate(re, im, re.length);
    expect(
      Math.abs(kasaiVelocityCms(estimate.r1Re, estimate.r1Im, prf, f0) - expectedCms) / expectedCms,
    ).toBeLessThan(0.01);
  });

  it('conserva el signo positivo hacia la sonda', () => {
    const [re, im] = tone(-500, 4000, 16);
    const estimate = kasaiEstimate(re, im, re.length);
    expect(kasaiVelocityCms(estimate.r1Re, estimate.r1Im, 4000, 2e6)).toBeGreaterThan(0);
  });

  it('pliega aliasing de 0,75·PRF a aproximadamente −0,25·PRF', () => {
    const prf = 4000;
    const [re, im] = tone(-0.75 * prf, prf, 32);
    const estimate = kasaiEstimate(re, im, re.length);
    const aliasedHz = (kasaiVelocityCms(estimate.r1Re, estimate.r1Im, prf, 2e6) * (2 * 2e6)) / (1540 * 100);
    expect(aliasedHz).toBeCloseTo(-0.25 * prf, -1);
  });

  it('da varianza baja para flujo uniforme y alta para velocidades opuestas', () => {
    const [uniformRe, uniformIm] = tone(-600, 4000, 16);
    const uniform = kasaiEstimate(uniformRe, uniformIm, uniformRe.length);
    expect(kasaiVariance(uniform.r0, uniform.r1Re, uniform.r1Im)).toBeLessThan(0.15);

    const re = new Float32Array(16);
    const im = new Float32Array(16);
    for (let k = 0; k < 16; k += 1) {
      const a = (2 * Math.PI * 600 * k) / 4000;
      re[k] = 2 * Math.cos(a);
      im[k] = 0;
    }
    const mixed = kasaiEstimate(re, im, re.length);
    expect(kasaiVariance(mixed.r0, mixed.r1Re, mixed.r1Im)).toBeGreaterThan(0.3);
  });

  it('anula un ensemble constante con el filtro de pared', () => {
    const re = new Float32Array([2, 2, 2, 2]);
    const im = new Float32Array([1, 1, 1, 1]);
    ensembleWallFilter(re, im, re.length);
    expect([...re]).toEqual([0, 0, 0, 0]);
    expect([...im]).toEqual([0, 0, 0, 0]);
  });
});
