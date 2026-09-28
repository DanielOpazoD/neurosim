import { describe, expect, it } from 'vitest';
import { colorDopplerRgb } from '../../src/ui/canvasDraw';

const NYQ = 30;

const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('colorDopplerRgb', () => {
  it('hacia la sonda (+v) pinta canal rojo dominante', () => {
    const [r, g, b] = colorDopplerRgb(NYQ * 0.8, NYQ);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(b).toBeLessThanOrEqual(60);
  });

  it('alejándose (-v) pinta canal azul dominante', () => {
    const [r, g, b] = colorDopplerRgb(-NYQ * 0.8, NYQ);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    expect(r).toBeLessThanOrEqual(60);
  });

  it('el brillo crece monótonamente con |v| más allá del umbral', () => {
    let prev = lum(colorDopplerRgb(NYQ * 0.2, NYQ));
    for (const x of [0.4, 0.6, 0.8, 1.0]) {
      const l = lum(colorDopplerRgb(NYQ * x, NYQ));
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
    prev = lum(colorDopplerRgb(-NYQ * 0.2, NYQ));
    for (const x of [0.4, 0.6, 0.8, 1.0]) {
      const l = lum(colorDopplerRgb(-NYQ * x, NYQ));
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it('por debajo de 0.15·Nyquist queda en versión tenue', () => {
    const dim = lum(colorDopplerRgb(NYQ * 0.1, NYQ));
    const bright = lum(colorDopplerRgb(NYQ * 0.2, NYQ));
    expect(dim).toBeLessThan(bright);
    expect(dim).toBeGreaterThan(0);
  });

  it('satura en Nyquist sin desbordar', () => {
    const [r, g, b] = colorDopplerRgb(NYQ * 3, NYQ);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeLessThanOrEqual(255);
    const [r2, g2, b2] = colorDopplerRgb(-NYQ * 3, NYQ);
    expect(r2).toBeLessThanOrEqual(255);
    expect(g2).toBeLessThanOrEqual(255);
    expect(b2).toBeLessThanOrEqual(255);
  });
});
