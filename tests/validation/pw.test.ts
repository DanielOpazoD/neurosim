import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../src/core/random';
import { C_RECONSTRUCTION_MM_S, dopplerShiftHz } from '../../src/core/units';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { measureBeats, observedTrace, summarizeBeats } from '../../src/doppler/measureMca';
import { SpectralProcessor } from '../../src/doppler/spectral';
import { WallFilter } from '../../src/doppler/wallFilter';
import { vesselVelocityCms } from '../../src/physiology/flow';

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
});
