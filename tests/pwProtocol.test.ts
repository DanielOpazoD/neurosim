import { describe, expect, it } from 'vitest';
import { SimulationClock } from '../src/core/clock';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { defaultTemporalSettings } from '../src/domain/settings';
import { PwDopplerChain } from '../src/doppler/pwChain';
import type { SpectralColumn } from '../src/doppler/spectral';
import { createInitialState } from '../src/app/state';
import { currentPose } from '../src/app/poses';
import {
  createPwHandlerState,
  handlePwMessage,
  packColumns,
  unpackColumns,
  type PwEquipment,
  type PwMessage,
  type PwReply,
} from '../src/app/pwProtocol';
import { PwController, SyncPwTransport, type PwTransport } from '../src/app/pwController';
import { patientToImage } from '../src/ultrasound/probe';
import { m1Gate } from './validation/helpers';

const EQUIPMENT: PwEquipment = {
  prfHz: 6000,
  f0Hz: 2e6,
  gainDb: 20,
  wallFilterHz: 100,
  outputAmplitude: 1,
};

function sameBits(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < ua.length; i += 1) if (ua[i] !== ub[i]) return false;
  return true;
}

describe('protocolo del worker PW (DEC-55)', () => {
  it('el manejador reproduce bit a bit la cadena directa durante 3 s', () => {
    const sim = buildReferenceCase();
    const target = sim.head.vessels.find((v) => v.id === 'm1-der')!.points[2]!;
    const gate = m1Gate(sim, target);
    // Secuencia irregular de (tStart, dt), como la de un rAF agrupado.
    const steps: { tStart: number; dt: number }[] = [];
    let t = 0;
    for (let i = 0; t < 3; i += 1) {
      const dt = [0.05, 0.067, 0.033, 0.12][i % 4]!;
      steps.push({ tStart: t, dt });
      t += dt;
    }

    // Referencia: cadena directa, igual que las pruebas y dorados.
    const direct = new PwDopplerChain(sim.head, sim.patient.seed, {
      pushIQ: (re, im, n) => {
        directRe.push(re.slice(0, n));
        directIm.push(im.slice(0, n));
      },
      reset: () => undefined,
    });
    const directRe: Float32Array[] = [];
    const directIm: Float32Array[] = [];
    direct.begin(EQUIPMENT.prfHz, EQUIPMENT.f0Hz, EQUIPMENT.gainDb, EQUIPMENT.wallFilterHz, 0, 1);
    direct.setGate(gate);
    for (const step of steps) {
      direct.step(
        (tt) => sim.physStateAt(tt),
        step.tStart,
        () => [0, 0, 0],
        step.dt,
      );
      direct.flush();
    }

    // Manejador del worker (misma ruta que el fallback síncrono).
    const state = createPwHandlerState();
    const post = (msg: PwMessage) => handlePwMessage(state, msg);
    post({
      type: 'configure',
      configVersion: 1,
      seed: sim.patient.seed,
      station: 'temporal',
      side: 'der',
      physiology: sim.patient.physiology,
    });
    post({ type: 'setGate', configVersion: 1, gate, equipment: EQUIPMENT, tSync: 0 });
    const columns: SpectralColumn[] = [];
    const replies: PwReply[] = [];
    for (const step of steps) {
      const reply = post({ type: 'step', configVersion: 1, ...step, wantAudio: true });
      expect(reply).not.toBeNull();
      replies.push(reply!);
      columns.push(...unpackColumns(reply!));
    }

    expect(direct.spectral.columns.length).toBeGreaterThan(600);
    expect(columns.length).toBe(direct.spectral.columns.length);
    for (let i = 0; i < columns.length; i += 1) {
      const a = columns[i]!;
      const b = direct.spectral.columns[i]!;
      expect(a.t).toBe(b.t);
      expect(a.prfHz).toBe(b.prfHz);
      expect(sameBits(a.powerDb, b.powerDb)).toBe(true);
    }
    // IQ filtrado para el audio: mismo bloque por paso.
    expect(replies.map((r) => r.iqRe.length)).toEqual(directRe.map((x) => x.length));
    for (let i = 0; i < replies.length; i += 1) {
      expect(sameBits(replies[i]!.iqRe, directRe[i]!)).toBe(true);
      expect(sameBits(replies[i]!.iqIm, directIm[i]!)).toBe(true);
    }
    const last = replies.at(-1)!;
    expect(last.sceneKey).toBe('temporal-der');
    expect(last.composition).toEqual(direct.sampleVolume.lastComposition);
  });

  it('empaquetar y desempaquetar columnas no altera los datos', () => {
    const cols: SpectralColumn[] = [0, 1, 2].map((i) => ({
      t: i * 0.004,
      prfHz: 6000,
      powerDb: Float32Array.from({ length: 8 }, (_, k) => -40 + i + k / 7),
    }));
    const back = unpackColumns({ ...packColumns(cols, 8), fftSize: 8 });
    expect(back.map((c) => c.t)).toEqual(cols.map((c) => c.t));
    back.forEach((c, i) => expect(sameBits(c.powerDb, cols[i]!.powerDb)).toBe(true));
  });

  it('un paso agrupado largo (2 s) no desborda el búfer IQ ni produce NaN', () => {
    const sim = buildReferenceCase();
    const target = sim.head.vessels.find((v) => v.id === 'm1-der')!.points[2]!;
    const chain = new PwDopplerChain(sim.head, sim.patient.seed);
    chain.setGate(m1Gate(sim, target));
    chain.begin(6000, 2e6, 20, 100, 0);
    // 12 000 muestras > 2 × 4096: antes solo se duplicaba una vez.
    chain.step(
      (tt) => sim.physStateAt(tt),
      0,
      () => [0, 0, 0],
      2,
    );
    chain.flush();
    expect(chain.spectral.columns.length).toBeGreaterThan(400);
    for (const col of chain.spectral.columns) {
      for (const v of col.powerDb) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('sin equipo configurado un step no responde ni lanza', () => {
    const state = createPwHandlerState();
    expect(
      handlePwMessage(state, {
        type: 'step',
        configVersion: 0,
        tStart: 0,
        dt: 0.05,
        wantAudio: false,
      }),
    ).toBeNull();
  });
});

/** Transporte síncrono con entrega diferida (simula un worker en vuelo). */
class DeferredTransport implements PwTransport {
  onReply: ((reply: PwReply) => void) | null = null;
  onFailure: ((error: unknown) => void) | null = null;
  readonly queued: PwReply[] = [];
  private readonly inner = new SyncPwTransport();
  constructor() {
    this.inner.onReply = (reply) => this.queued.push(reply);
  }
  post(message: PwMessage): void {
    this.inner.post(message);
  }
  deliver(): void {
    for (const reply of this.queued.splice(0)) this.onReply?.(reply);
  }
}

function temporalM1State(sim: ReturnType<typeof buildReferenceCase>) {
  const s = createInitialState();
  s.station = 'temporal';
  s.side = 'der';
  s.settings = defaultTemporalSettings();
  s.pwOn = true;
  const target = sim.head.vessels.find((v) => v.id === 'm1-der')!.points[2]!;
  const { u, z } = patientToImage(currentPose(sim, s), 'sector', target);
  s.gateUMm = u;
  s.gateDepthMm = z;
  return s;
}

describe('PwController como proxy (DEC-55)', () => {
  it('agrupa pasos a ≥50 ms y mide PSV en la ruta síncrona', () => {
    const sim = buildReferenceCase();
    const s = temporalM1State(sim);
    const posted: PwMessage[] = [];
    const transport = new SyncPwTransport();
    const post = transport.post.bind(transport);
    transport.post = (m) => {
      posted.push(m);
      post(m);
    };
    const pw = new PwController(sim, s, transport);
    const clock = new SimulationClock();
    pw.reset();
    const frame = 1 / 60;
    for (let i = 0; i < 6 * 60; i += 1) {
      const n = clock.requestSteps(frame);
      for (let k = 0; k < n; k += 1) clock.advance();
      pw.step(clock, frame);
    }
    const stepMsgs = posted.filter((m) => m.type === 'step');
    // 6 s a ≥50 ms por mensaje: como mucho ~120 pasos (no 360 rAF).
    expect(stepMsgs.length).toBeLessThanOrEqual(121);
    expect(stepMsgs.length).toBeGreaterThan(100);
    for (const m of stepMsgs) if (m.type === 'step') expect(m.dt).toBeGreaterThanOrEqual(0.05 - 1e-9);
    const summary = pw.latestMcaMeasure();
    expect(summary).not.toBeNull();
    expect(Math.abs(summary!.psvCms)).toBeGreaterThan(40);
    expect(pw.composition()?.dominantVesselId).toMatch(/^m1-/);
    expect(pw.chainSceneKey).toBe('temporal-der');
    // Ventana temporal del búfer.
    const cols = pw.columns;
    expect(cols.at(-1)!.t - cols[0]!.t).toBeLessThanOrEqual(7 + 1e-9);
  });

  it('cachea la medida por revisión y la recalcula como mucho a 2 Hz (DEC-56)', () => {
    const sim = buildReferenceCase();
    const s = temporalM1State(sim);
    const pw = new PwController(sim, s, new SyncPwTransport());
    let nowMs = 0;
    pw.nowMs = () => nowMs;
    const clock = new SimulationClock();
    pw.reset();
    const run = (frames: number) => {
      for (let i = 0; i < frames; i += 1) {
        const n = clock.requestSteps(1 / 60);
        for (let k = 0; k < n; k += 1) clock.advance();
        pw.step(clock, 1 / 60);
      }
    };
    run(4 * 60);
    const first = pw.latestMcaMeasure();
    expect(first).not.toBeNull();
    // Sin columnas nuevas: mismo objeto (no recalcula).
    expect(pw.latestMcaMeasure()).toBe(first);
    // Columnas nuevas pero < 500 ms: la caché sigue valiendo.
    const rev = pw.revision;
    run(15);
    expect(pw.revision).toBeGreaterThan(rev);
    nowMs += 250;
    expect(pw.latestMcaMeasure()).toBe(first);
    // ≥ 500 ms con columnas nuevas: recalcula.
    nowMs += 250;
    const second = pw.latestMcaMeasure();
    expect(second).not.toBe(first);
    expect(second).not.toBeNull();
    // Un ajuste de medida (corrección angular) recalcula en el acto.
    s.settings = { ...s.settings, angleCorrectionDeg: 30 };
    const corrected = pw.latestMcaMeasure();
    expect(corrected).not.toBe(second);
    expect(Math.abs(corrected!.psvCms)).toBeGreaterThan(Math.abs(second!.psvCms));
    // PW apagado → sin medida.
    s.pwOn = false;
    expect(pw.latestMcaMeasure()).toBeNull();
  });

  it('descarta respuestas de una configuración anterior (configVersion)', () => {
    const sim = buildReferenceCase();
    const s = temporalM1State(sim);
    const transport = new DeferredTransport();
    const pw = new PwController(sim, s, transport);
    const clock = new SimulationClock();
    pw.reset();
    const run = (frames: number) => {
      for (let i = 0; i < frames; i += 1) {
        const n = clock.requestSteps(1 / 60);
        for (let k = 0; k < n; k += 1) clock.advance();
        pw.step(clock, 1 / 60);
      }
    };
    run(12); // un lote en vuelo
    expect(transport.queued.length).toBeGreaterThan(0);
    s.settings = { ...s.settings, prfHz: s.settings.prfHz + 1000 };
    run(1); // nueva versión
    transport.deliver();
    expect(pw.droppedReplies).toBeGreaterThan(0);
    expect(pw.columns.length).toBe(0);
    run(12);
    transport.deliver();
    expect(pw.columns.length).toBeGreaterThan(0);
    expect(pw.columns.at(-1)!.prfHz).toBe(s.settings.prfHz);
  });

  it('con el worker saturado descarta atraso: lote ≤0,5 s y re-sincroniza', () => {
    const sim = buildReferenceCase();
    const s = temporalM1State(sim);
    const transport = new DeferredTransport();
    const posted: PwMessage[] = [];
    const post = transport.post.bind(transport);
    transport.post = (m) => {
      posted.push(m);
      post(m);
    };
    const pw = new PwController(sim, s, transport);
    const clock = new SimulationClock();
    pw.reset();
    for (let i = 0; i < 120; i += 1) {
      const n = clock.requestSteps(1 / 60);
      for (let k = 0; k < n; k += 1) clock.advance();
      pw.step(clock, 1 / 60);
    }
    // Dos pasos en vuelo sin respuesta: el resto se acumula hasta el tope.
    expect(posted.filter((m) => m.type === 'step').length).toBe(2);
    transport.deliver();
    const n = clock.requestSteps(1 / 60);
    for (let k = 0; k < n; k += 1) clock.advance();
    pw.step(clock, 1 / 60);
    const last = posted.filter((m) => m.type === 'step').at(-1)!;
    expect(last.type === 'step' && last.dt).toBeLessThanOrEqual(0.5 + 1e-9);
    const gate = posted.filter((m) => m.type === 'setGate').at(-1)!;
    expect(gate.type === 'setGate' && gate.resync).toBe(true);
    transport.deliver();
    for (const col of pw.columns) expect(Number.isFinite(col.powerDb[0]!)).toBe(true);
  });
});
