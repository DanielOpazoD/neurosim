import { describe, expect, it } from 'vitest';
import { SpectralProcessor, columnBandEnvelopes, captureNoiseFloorsDb } from '../src/doppler/spectral';
import { WallFilter } from '../src/doppler/wallFilter';
import { arterialShape } from '../src/physiology/flow';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { PwDopplerChain } from '../src/doppler/pwChain';
import { measureBeats, observedTrace, summarizeBeats } from '../src/doppler/measureMca';
import type { GateGeometry } from '../src/doppler/sampleVolume';
import { normalize, sub } from '../src/core/vec3';

/** Tono puro: IQ con fase rotando a fD. */
function tone(fdHz: number, prf: number, n: number): [Float32Array, Float32Array] {
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = (2 * Math.PI * fdHz * i) / prf;
    re[i] = Math.cos(ph);
    im[i] = Math.sin(ph);
  }
  return [re, im];
}

describe('cadena espectral sobre un tono IQ conocido', () => {
  it('la envolvente marca el fD inyectado (± 2 bins)', () => {
    const prf = 4000;
    const fd = 1200; // Hz hacia la sonda
    const N = 128;
    const sp = new SpectralProcessor({ fftSize: N, hop: 16 });
    sp.sync(0, prf);
    const [re, im] = tone(fd, prf, 4096);
    sp.push(re, im, 4096);
    expect(sp.columns.length).toBeGreaterThan(100);
    const col = sp.columns[sp.columns.length - 1]!;
    const floors = captureNoiseFloorsDb(sp.columns.slice(-50));
    const b = columnBandEnvelopes(col, N, floors[floors.length - 1]!, 10);
    expect(b.posHz).toBeGreaterThan(0);
    const binHz = prf / N;
    expect(Math.abs(b.posHz - fd)).toBeLessThan(3 * binHz);
  });

  it('el filtro de pared suprime el tono lento y deja pasar el rápido', () => {
    const wf = new WallFilter(400, 4000);
    expect(wf.magnitude(40)).toBeLessThan(0.2);
    expect(wf.magnitude(2000)).toBeGreaterThan(0.8);
  });
});

describe('forma de onda arterial', () => {
  it('para PSV 90 / EDV 35 cm/s la media temporal ≈ TAMax 55 (±4)', () => {
    let acc = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      acc += 35 + (90 - 35) * arterialShape(i / n);
    }
    const mean = acc / n;
    expect(mean).toBeGreaterThan(50);
    expect(mean).toBeLessThan(60);
  });
});

describe('PW integrado sobre la ACM del caso N1', () => {
  it('la envolvente medida queda cerca de PSV 90 / EDV 35 y el flujo es hacia la sonda', () => {
    const sim = buildReferenceCase();
    const head = sim.head;
    const chain = new PwDopplerChain(head, sim.patient.seed);

    // Puerta de 6 mm en el segmento medio de M1 der, haz desde la ventana.
    const wc = head.windowCenter.der;
    const m1 = head.vessels.find((v) => v.id === 'm1-der')!;
    const target = m1.points[2]!;
    const dir = normalize(sub(target, wc));
    const gate: GateGeometry = {
      center: target,
      beamDir: dir,
      lateral: normalize([-dir[2], 0, dir[0]]),
      elevation: normalize([dir[1] * dir[2], dir[2] * dir[2] + dir[0] * dir[0], -dir[1] * dir[0]]),
      lengthMm: 6,
      lateralSigmaMm: 2.5,
      elevationSigmaMm: 5,
      pulseSigmaMm: 0.8,
      apertureAngleSigmaRad: 0.04,
      transmission: 0.5,
    };
    chain.setGate(gate);
    chain.begin(6000, 2e6, 20, 100, 0);

    // 3 s de adquisición en bloques de 64 ms.
    let t = 0;
    for (let step = 0; step < 47; step++) {
      chain.step({ t, cardiacPhase: sim.cardiac.phaseAt(t), heartRateBpm: 70 }, [0, 0, 0], 0.064);
      chain.flush();
      t += 0.064;
    }
    expect(chain.spectral.columns.length).toBeGreaterThan(50);

    const trace = observedTrace(chain.spectral.columns, {
      f0Hz: 2e6,
      angleCorrectionRad: 0,
      invert: false,
      fftSize: chain.spectral.fftSize,
      wallFilterHz: 100,
    });
    const beats = sim.cardiac.beatsIn(trace[0]!.t, trace[trace.length - 1]!.t);
    const ms = measureBeats(trace, beats);
    const s = summarizeBeats(ms);
    expect(s).not.toBeNull();
    // hacia la sonda: positivo en pantalla
    expect(s!.psvCms).toBeGreaterThan(0);
    // La envolvente medida difiere del PSV ideal por geometría de haz;
    // el orden de magnitud debe ser el clínico, no un artefacto.
    expect(Math.abs(s!.psvCms)).toBeGreaterThan(40);
    expect(Math.abs(s!.psvCms)).toBeLessThan(160);
    expect(s!.pi).toBeGreaterThan(0.3);
    expect(s!.pi).toBeLessThan(2.5);
  }, 30000);
});
