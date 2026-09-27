import { describe, expect, it } from 'vitest';
import { applyAgc, lowPass, separateDirectional } from '../src/doppler/audioShaping';

function tone(
  length: number,
  frequency: number,
  sampleRate: number,
  amplitude = 1,
): {
  re: Float32Array;
  im: Float32Array;
} {
  const re = new Float32Array(length);
  const im = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const phase = (2 * Math.PI * frequency * i) / sampleRate;
    re[i] = amplitude * Math.cos(phase);
    im[i] = amplitude * Math.sin(phase);
  }
  return { re, im };
}

function rms(values: Float32Array): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

describe('moldeo puro del audio Doppler', () => {
  it('separa una sinusoide direccional con al menos 30 dB', () => {
    const { re, im } = tone(4096, 250, 4000);
    const separated = separateDirectional(re, im);
    const ratioDb = 20 * Math.log10(rms(separated.positive) / Math.max(1e-9, rms(separated.negative)));
    expect(ratioDb).toBeGreaterThanOrEqual(30);
  });

  it('mantiene continuidad entre saltos de overlap-add', () => {
    const { re, im } = tone(4096, 250, 4000);
    const output = separateDirectional(re, im).positive;
    const scale = Math.max(1e-6, rms(output));
    let largestBoundaryJump = 0;
    for (let i = 512; i < output.length - 512; i += 128) {
      const expected = re[i]! - re[i - 1]!;
      const actual = output[i]! - output[i - 1]!;
      largestBoundaryJump = Math.max(largestBoundaryJump, Math.abs(actual - expected));
    }
    expect(largestBoundaryJump / scale).toBeLessThan(0.05);
  });

  it('atenúa al menos 12 dB sobre el corte', () => {
    const sampleRate = 4000;
    const cutoff = (0.45 * sampleRate) / 2;
    const { re } = tone(8192, cutoff * 1.75, sampleRate);
    const filtered = lowPass(re, sampleRate, cutoff);
    const ratioDb = 20 * Math.log10(rms(filtered.slice(2000)) / rms(re.slice(2000)));
    expect(ratioDb).toBeLessThanOrEqual(-12);
  });

  it('normaliza niveles absolutos con un AGC lento', () => {
    const sampleRate = 4000;
    const a = tone(8192, 250, sampleRate, 0.2).re;
    const b = tone(8192, 250, sampleRate, 2).re;
    const outA = applyAgc(a, sampleRate, { level: 0 }, 0.5);
    const outB = applyAgc(b, sampleRate, { level: 0 }, 0.5);
    const ratio = rms(outA.slice(4000)) / rms(outB.slice(4000));
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
  });
});
