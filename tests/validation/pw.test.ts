import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../src/core/random';
import { C_RECONSTRUCTION_MM_S, dopplerShiftHz } from '../../src/core/units';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { measureBeats, observedTrace, summarizeBeats } from '../../src/doppler/measureMca';
import { SpectralProcessor } from '../../src/doppler/spectral';
import { WallFilter } from '../../src/doppler/wallFilter';
import { vesselVelocityCms } from '../../src/physiology/flow';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import { m1Gate } from './helpers';

function measureSynthetic(): {
  summary: ReturnType<typeof summarizeBeats>;
  expectedTa: number;
} {
  const sim = buildReferenceCase();
  const vessel = sim.head.vessels.find((v) => v.id === 'm1-der')!;
  const prfHz = 6000;
  const f0Hz = 2e6;
  const dt = 1 / prfHz;
  const sampleCount = prfHz * 4;
  const spectral = new SpectralProcessor({ fftSize: 128, hop: 24 });
  const wallFilter = new WallFilter(100, prfHz);
  spectral.sync(0, prfHz);
  const rng = new SeededRandom('pw-validation');
  let phase = 0;
  let trueSum = 0;
  for (let offset = 0; offset < sampleCount; offset += 384) {
    const n = Math.min(384, sampleCount - offset);
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = (offset + i) * dt;
      const vCms = vesselVelocityCms(vessel, sim.cardiac.phaseAt(t));
      trueSum += vCms;
      const fd = dopplerShiftHz(vCms * 10, f0Hz, C_RECONSTRUCTION_MM_S);
      phase += 2 * Math.PI * fd * dt;
      re[i] = Math.cos(phase) + rng.gaussian() * 0.01;
      im[i] = Math.sin(phase) + rng.gaussian() * 0.01;
    }
    wallFilter.process(re, im);
    spectral.push(re, im, n);
  }
  const trace = observedTrace(spectral.columns, {
    f0Hz,
    angleCorrectionRad: 0,
    invert: false,
    fftSize: spectral.fftSize,
    wallFilterHz: 100,
  });
  const beats = sim.cardiac.beatsIn(trace[0]!.t, trace.at(-1)!.t);
  const summary = summarizeBeats(
    measureBeats(
      trace,
      beats.map((b) => ({ tStart: b.tStart, rr: b.rr })),
    ),
  );
  return { summary, expectedTa: trueSum / sampleCount };
}

describe('validación PW sintética', () => {
  it('recupera PSV y TAMax sin dispersores', () => {
    const { summary, expectedTa } = measureSynthetic();
    expect(summary).not.toBeNull();
    expect(Math.abs(summary!.psvCms)).toBeGreaterThan(90 * 0.95);
    expect(Math.abs(summary!.psvCms)).toBeLessThan(90 * 1.05);
    expect(Math.abs(summary!.taMaxCms)).toBeGreaterThan(expectedTa * 0.95);
    expect(Math.abs(summary!.taMaxCms)).toBeLessThan(expectedTa * 1.05);
  });

  it('EDV dentro del 5 % tras interpolar el borde sub-bin', () => {
    const { summary } = measureSynthetic();
    expect(summary).not.toBeNull();
    expect(Math.abs(summary!.edvCms)).toBeGreaterThan(35 * 0.95);
    expect(Math.abs(summary!.edvCms)).toBeLessThan(35 * 1.05);
  });

  it('un paso de 200 ms muestrea la fase cardíaca (sin escalones en la traza)', () => {
    const sim = buildReferenceCase();
    const m1 = sim.head.vessels.find((v) => v.id === 'm1-der')!;
    const target = m1.points[Math.floor(m1.points.length / 2)]!;
    const chain = new PwDopplerChain(sim.head, sim.patient.seed);
    chain.setGate(m1Gate(sim, target));
    chain.begin(6000, 2e6, 20, 100, 0);
    const phases = new Set<number>();
    chain.step(
      (tt) => {
        const phys = sim.physStateAt(tt);
        phases.add(phys.cardiacPhase);
        return phys;
      },
      0.3,
      () => [0, 0, 0],
      0.2,
    );
    // 200 ms a 70 lpm ≈ 0,23 de ciclo: la fase debe muestrearse en subpasos.
    expect(phases.size).toBeGreaterThanOrEqual(20);
    chain.flush();
    const trace = observedTrace(chain.spectral.columns, {
      f0Hz: 2e6,
      angleCorrectionRad: 0,
      invert: false,
      fftSize: chain.spectral.fftSize,
      wallFilterHz: 100,
    });
    // Columnas cada hop/prf = 4 ms: una meseta de ≥40 ms son ≥10 idénticas.
    let maxRun = 1;
    let run = 1;
    for (let i = 1; i < trace.length; i += 1) {
      run = Math.abs(trace[i]!.vCms - trace[i - 1]!.vCms) < 0.5 ? run + 1 : 1;
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun).toBeLessThan(10);
  });
});
