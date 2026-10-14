import { describe, expect, it } from 'vitest';
import { lindegaardIndex, lindegaardInterpretation, lindegaardRatio } from '../../src/doppler/measureMca';

describe('interpretación contextual de Lindegaard', () => {
  it.each([0, Number.NaN, Infinity, -Infinity])('no divide por ACI inválida %s', (ica) => {
    expect(lindegaardRatio(40, ica)).toBeNaN();
    expect(lindegaardInterpretation(lindegaardIndex(40, ica, 45))).toContain('No interpretable');
  });

  it.each([0, Number.NaN, Infinity, -Infinity])('no interpreta ACM inválida %s', (mca) => {
    expect(lindegaardRatio(mca, 45)).toBeNaN();
  });

  it('no convierte una ACI medida inválida en una referencia válida silenciosamente', () => {
    const li = lindegaardIndex(150, 0, 45);
    expect(li.icaSource).toBe('medida');
    expect(li.ratio).toBeNaN();
  });

  it('conserva magnitudes de velocidades monodireccionales negativas', () => {
    expect(lindegaardRatio(-180, -45)).toBe(4);
  });

  it('no gradúa con una referencia ni con cociente alto y velocidad baja', () => {
    expect(lindegaardInterpretation(lindegaardIndex(40, 5, 45))).toContain('discordantes');
    expect(lindegaardInterpretation(lindegaardIndex(240, null, 30))).toContain('referencia');
    expect(lindegaardInterpretation(lindegaardIndex(240, null, 30))).not.toContain('grave');
  });

  it.each([
    [119.9, 2.9, 'sin patrón'],
    [120, 3, 'leve-moderado'],
    [150, 6, 'leve-moderado'],
    [200, 6, 'leve-moderado'],
    [200, 6.1, 'discordantes'],
    [200.1, 6, 'discordantes'],
    [201, 6.1, 'grave'],
    [201, 2.9, 'hiperemia'],
    [40, 8, 'discordantes'],
  ])('contextualiza ACM %s y ratio %s', (mca, ratio, text) => {
    expect(lindegaardInterpretation(lindegaardIndex(mca, mca / ratio, 45))).toContain(text);
  });
});
