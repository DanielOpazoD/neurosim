import { describe, expect, it } from 'vitest';
import {
  assessPwTrace,
  measureBeats,
  observedTrace,
  smoothSpectrum,
  summarizeBeats,
} from '../../src/doppler/measureMca';
import type { SpectralColumn } from '../../src/doppler/spectral';

const beats = [{ tStart: 0, rr: 1 }];
const trace = (velocity: (i: number) => number) =>
  Array.from({ length: 100 }, (_, i) => ({
    t: i / 100,
    vCms: velocity(i),
    stepS: 0.01,
  }));
const columns = (signs: number[]): SpectralColumn[] =>
  signs.map((sign, i) => {
    const powerDb = new Float32Array(128).fill(-80);
    for (let k = 4; k <= 18; k++) {
      if (sign >= 1) powerDb[64 + k] = -20;
      if (sign <= -1 || sign === 2) powerDb[64 - k] = -20;
    }
    return { t: i / 100, prfHz: 6000, powerDb, stepS: 0.01 };
  });
const opts = { f0Hz: 2e6, angleCorrectionRad: 0, invert: false, fftSize: 128 };

describe('validez de medidas PW', () => {
  it('no rectifica una onda oscilante ni calcula sus índices', () => {
    const t = trace((i) => (i < 25 ? 120 : -40));
    expect(measureBeats(t, beats)).toEqual([]);
    const a = assessPwTrace(t, beats);
    expect(a.status).toBe('bidireccional');
    expect(a.summary).toBeNull();
    expect(Math.abs(a.signedEnvelopeMeanCms!)).toBeLessThan(2);
  });

  it('conserva la dirección negativa con PI/IR finitos', () => {
    const a = assessPwTrace(
      trace((i) => (i < 20 ? -100 : -40)),
      beats,
    );
    expect(a.status).toBe('valida');
    expect(a.direction).toBe('negativo');
    expect(a.summary).toMatchObject({ psvCms: -100, edvCms: -40, ri: 0.6 });
    expect(a.summary!.taMaxCms).toBeLessThan(0);
  });

  it('no combina latidos de signos opuestos', () => {
    const pos = measureBeats(
      trace(() => 50),
      beats,
    );
    const neg = measureBeats(
      trace(() => -50),
      beats,
    );
    expect(summarizeBeats([...pos, ...neg])).toBeNull();
  });

  it('distingue latidos válidos de la aceptación de la captura completa', () => {
    const t = [...trace((i) => (i < 50 ? 50 : -50)), ...trace(() => 50).map((p) => ({ ...p, t: p.t + 1 }))];
    const windows = [...beats, { tStart: 1, rr: 1 }];
    expect(measureBeats(t, windows)).toHaveLength(1);
    expect(assessPwTrace(t, windows)).toMatchObject({ status: 'bidireccional', summary: null });
  });

  it.each([0, Number.NaN])('ausencia de detección no es un diagnóstico de cese (%s)', (v) => {
    const a = assessPwTrace(
      trace(() => v),
      beats,
    );
    expect(a.status).toBe('sin-senal');
    expect(a.summary).toBeNull();
    expect(
      measureBeats(
        trace(() => v),
        beats,
      ),
    ).toEqual([]);
  });

  it('no cuenta un hueco de 0,81 s como cobertura válida', () => {
    const t = trace(() => 50).filter((p) => p.t < 0.1 || p.t >= 0.9);
    const a = assessPwTrace(t, beats);
    expect(a.status).toBe('cobertura-insuficiente');
    expect(a.coverageFraction).toBeLessThan(0.2);
    expect(measureBeats(t, beats)).toEqual([]);
  });

  it('usa la cadencia adquirida, no la cadencia aparente tras perder columnas', () => {
    const t = trace(() => 50).filter((_, i) => i % 3 === 0);
    expect(assessPwTrace(t, beats)).toMatchObject({ status: 'cobertura-insuficiente', summary: null });
  });

  it.each(['duplicado', 'desordenado'] as const)('rechaza tiempo %s sin ocultarlo ordenando', (kind) => {
    const t = trace(() => 50);
    t[50]!.t = kind === 'duplicado' ? t[49]!.t : 0.1;
    expect(assessPwTrace(t, beats).status).toBe('tiempo-invalido');
    expect(measureBeats(t, beats)).toEqual([]);
  });

  it('una captura continua conserva cobertura y medias', () => {
    const a = assessPwTrace(
      trace(() => 50),
      beats,
    );
    expect(a.status).toBe('valida');
    expect(a.coverageFraction).toBeCloseTo(1);
    expect(a.signedEnvelopeMeanCms).toBeCloseTo(50);
    expect(a.summary).toMatchObject({ psvCms: 50, edvCms: 50, pi: 0, ri: 0 });
    expect(a.summary!.taMaxCms).toBeCloseTo(50);
  });

  it('no rellena un dropout aislado mediante suavizado', () => {
    const t = observedTrace(columns([1, 1, 1, 1, 0, 1, 1, 1, 1]), opts);
    expect(t[4]!.vCms).toBeNaN();
    expect(t.filter((p) => p.vCms < 0)).toHaveLength(0);
  });

  it('mantiene ambas envolventes cuando coexisten en una columna', () => {
    const t = observedTrace(columns(Array(100).fill(2)), opts);
    expect(t[50]!.positiveCms).toBeGreaterThan(0);
    expect(t[50]!.negativeCms).toBeLessThan(0);
    expect(assessPwTrace(t, beats)).toMatchObject({ status: 'bidireccional', summary: null });
  });

  it('invertir intercambia los semiplanos y el signo, no la validez', () => {
    const cols = columns(Array(100).fill(-1));
    const normal = observedTrace(cols, opts);
    const inverted = observedTrace(cols, { ...opts, invert: true });
    expect(normal[50]!.negativeCms).toBeLessThan(0);
    expect(inverted[50]!.positiveCms).toBeCloseTo(-normal[50]!.negativeCms!);
    expect(assessPwTrace(inverted, beats).status).toBe('valida');
  });

  it('no suaviza entre columnas separadas por una discontinuidad', () => {
    const cols = columns([1, -1]);
    cols[1]!.t = 1;
    const together = smoothSpectrum(cols);
    expect(together[0]!.powerDb).toEqual(smoothSpectrum([cols[0]!])[0]!.powerDb);
    expect(together[0]!.stepS).toBe(0.01);
  });
});
