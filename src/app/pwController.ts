/**
 * Controlador de PW (DEC-55): proxy fino de la cadena PW, que vive en un
 * worker dedicado (`src/ui/pwWorker.ts`) o, sin Worker, en el mismo hilo a
 * través del mismo manejador (`handlePwMessage`). Aquí quedan la puerta, el
 * audio (Web Audio exige el hilo principal), el búfer de columnas y las
 * medidas de la traza adquirida.
 */
import type { SimulationClock } from '../core/clock';
import type { ProbePose } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import type { Vec3 } from '../core/vec3';
import { beamDirAt, elevAxis, imageToPatient } from '../ultrasound/probe';
import { skullAttenuationDb } from '../ultrasound/attenuation';
import type { VesselScene } from '../anatomy/head';
import { measureBeats, observedTrace, summarizeBeats } from '../doppler/measureMca';
import { DopplerAudio } from '../doppler/audio';
import type { AudioSink } from '../doppler/pwChain';
import type { GateComposition, GateGeometry } from '../doppler/sampleVolume';
import type { SpectralColumn } from '../doppler/spectral';
import type { AppState } from './state';
import { currentPose } from './poses';
import { DOPPLER } from '../doppler/params';
import { FISICA_US } from '../ultrasound/params';
import { logError } from '../core/errorLog';
import { insonationAngles, type InsonationAngles } from '../doppler/insonation';
import {
  createPwHandlerState,
  handlePwMessage,
  pwDopplerScene,
  unpackColumns,
  type PwEquipment,
  type PwMessage,
  type PwReply,
} from './pwProtocol';

/** Transporte de mensajes hacia la cadena (worker o síncrono). */
export interface PwTransport {
  post(message: PwMessage): void;
  /** Respuestas de `step`; el transporte síncrono las entrega dentro de `post`. */
  onReply: ((reply: PwReply) => void) | null;
  /** Fallo irrecuperable (worker caído): el controlador pasa al síncrono. */
  onFailure: ((error: unknown) => void) | null;
}

/** Fallback en el mismo hilo (sin Worker, `?pwworker=0`, pruebas). */
export class SyncPwTransport implements PwTransport {
  onReply: ((reply: PwReply) => void) | null = null;
  onFailure: ((error: unknown) => void) | null = null;
  private readonly state = createPwHandlerState();
  post(message: PwMessage): void {
    const reply = handlePwMessage(this.state, message);
    if (reply) this.onReply?.(reply);
  }
}

export interface PwWorkerLike {
  onmessage: ((event: MessageEvent<PwReply>) => void) | null;
  onerror?: ((event: ErrorEvent) => void) | null;
  postMessage(message: PwMessage): void;
}

export class WorkerPwTransport implements PwTransport {
  onReply: ((reply: PwReply) => void) | null = null;
  onFailure: ((error: unknown) => void) | null = null;
  constructor(private readonly worker: PwWorkerLike) {
    worker.onmessage = (event) => this.onReply?.(event.data);
    worker.onerror = (event) => this.onFailure?.(event);
  }
  post(message: PwMessage): void {
    try {
      this.worker.postMessage(message);
    } catch (error) {
      this.onFailure?.(error);
    }
  }
}

/** Mínimo de tiempo real entre mensajes `step` (ms): el dt se agrupa. */
export const PW_STEP_INTERVAL_MS = 50;
/** Pasos en vuelo como máximo; con el worker saturado el dt se acumula. */
const MAX_IN_FLIGHT = 2;
/** Lote máximo (s): más atraso se descarta y el tiempo se re-sincroniza. */
export const MAX_BATCH_S = 0.5;
/** Ventana temporal del búfer de columnas (barrido máximo 6 s + margen). */
const COLUMN_WINDOW_S = 7;
const MAX_COLUMNS = 4096;
/** Tope de recálculo de la medida PSV/EDV/PI: 2 veces por segundo (DEC-56). */
export const MEASURE_MIN_INTERVAL_MS = 500;

export class PwController {
  private transport: PwTransport;
  private audio: DopplerAudio | null = null;
  private configVersion = 0;
  private configureKey = '';
  private sceneKey: string | null = null;
  private versionKey = '';
  private equipmentKey = '';
  private lastSentGate = '';
  private batchDt = 0;
  private needResync = false;
  private inFlight = 0;
  private readonly cols: SpectralColumn[] = [];
  private fft = 128;
  private lastComposition: GateComposition | null = null;
  private rev = 0;
  private measureCache: {
    revision: number;
    settingsKey: string;
    atMs: number;
    value: ReturnType<typeof summarizeBeats>;
  } | null = null;
  /** Reloj de tiempo real para el tope de la medida (inyectable en pruebas). */
  nowMs: () => number = () => performance.now();
  /** Bloques descartados por venir de una configuración anterior. */
  droppedReplies = 0;

  constructor(
    private readonly sim: ReferenceCase,
    private readonly state: AppState,
    transport: PwTransport = new SyncPwTransport(),
  ) {
    this.transport = transport;
    this.attach(transport);
  }

  private attach(transport: PwTransport): void {
    transport.onReply = (reply) => this.receive(reply);
    transport.onFailure = (error) => {
      logError('worker', error);
      if (this.transport !== transport) return;
      // Como RenderClient: sin worker se sigue en el mismo hilo.
      this.transport = new SyncPwTransport();
      this.attach(this.transport);
      this.inFlight = 0;
      this.forceReconfigure();
    };
  }

  /**
   * Envía ya el `configure` de la estación actual para que el worker
   * construya su caso (`renderCase`) antes de que se active el PW.
   */
  prewarm(): void {
    try {
      this.postConfigure();
    } catch (err) {
      logError('pw', err);
    }
  }

  private postConfigure(): void {
    const s = this.state;
    const physiology = this.sim.patient.physiology;
    this.transport.post({
      type: 'configure',
      configVersion: this.configVersion,
      seed: this.sim.patient.seed,
      willisVariant: this.sim.willisVariant,
      caseId: this.sim.clinicalCase.id,
      station: s.station,
      side: s.side,
      physiology: { ...physiology },
    });
    this.configureKey = `${s.station}-${s.side}|${JSON.stringify(physiology)}`;
  }

  private forceReconfigure(): void {
    this.configureKey = '';
    this.equipmentKey = '';
    this.lastSentGate = '';
  }

  /** Columnas recibidas (ventana temporal, orden creciente de t). */
  get columns(): readonly SpectralColumn[] {
    return this.cols;
  }

  get fftSize(): number {
    return this.fft;
  }

  /** Cambia cada vez que llegan columnas o se vacía el búfer (redibujado). */
  get revision(): number {
    return this.rev;
  }

  /** Clave estación-lado de la cadena activa; la UI la compara con el estado. */
  get chainSceneKey(): string | null {
    return this.sceneKey;
  }

  setAudioSink(audio: DopplerAudio | null): void {
    this.audio = audio;
    this.audio?.reset();
  }

  setAudioEnabled(enabled: boolean): void {
    if (enabled && !this.audio) this.audio = new DopplerAudio();
    if (this.audio) {
      this.audio.setMuted(!enabled);
      if (!enabled) this.audio.reset();
    }
  }

  setVolume(percent: number): void {
    this.audio?.setVolume(percent);
  }

  /** Sumidero de audio activo (diagnóstico/e2e). */
  get audioSink(): AudioSink | null {
    return this.audio;
  }

  private dopplerScene(): VesselScene {
    return pwDopplerScene(this.sim, this.state.station, this.state.side);
  }

  /** Centro de la puerta (barato: sin atenuación por trayectoria). */
  gateCenter(pose: ProbePose): Vec3 {
    const s = this.state;
    return imageToPatient(pose, s.settings.transducer, s.gateUMm, s.gateDepthMm);
  }

  gateGeometry(pose: ProbePose): GateGeometry {
    const s = this.state;
    const scene = this.dopplerScene();
    const beamDir = beamDirAt(pose, s.settings.transducer, s.gateUMm);
    // Lineal (ojo): la puerta se desplaza lateralmente en u; sector: sobre la línea rotada.
    const center = this.gateCenter(pose);
    const f0 = s.settings.frequencyMhz * 1e6;
    const c = FISICA_US.params.soundSpeedMs.value * 1000;
    const lambda = c / f0;
    const latSigma = Math.max(DOPPLER.params.gateLateralSigmaMinMm.value, (lambda * s.gateDepthMm) / 10 / 2);
    return {
      center,
      beamDir,
      lateral: pose.lateral,
      elevation: elevAxis(pose),
      lengthMm: s.settings.gateMm,
      lateralSigmaMm: latSigma,
      elevationSigmaMm: Math.max(DOPPLER.params.gateElevationSigmaMinMm.value, latSigma * 2),
      pulseSigmaMm: Math.max(DOPPLER.params.gatePulseSigmaMinMm.value, lambda * 1.5),
      apertureAngleSigmaRad: DOPPLER.params.apertureAngleSigmaRad.value,
      // Ida y vuelta: escena ocular = trayectoria sin ventana; craneal = skullAttenuationDb.
      transmission: Math.pow(
        10,
        -(scene.attenuationDb
          ? scene.attenuationDb(pose.origin, center, s.settings.frequencyMhz)
          : skullAttenuationDb(this.sim.head, pose.origin, center, s.settings.frequencyMhz)) / 20,
      ),
    };
  }

  insonation(): InsonationAngles | null {
    const pose = currentPose(this.sim, this.state);
    const gate = this.gateGeometry(pose);
    return insonationAngles(this.dopplerScene(), gate.center, gate.beamDir, gate.lateral, gate.elevation);
  }

  hemodynamics() {
    return this.sim.physStateAt(0).hemo;
  }

  private equipment(): PwEquipment {
    const s = this.state.settings;
    return {
      prfHz: s.prfHz,
      f0Hz: s.frequencyMhz * 1e6,
      gainDb: s.dopplerGainDb,
      wallFilterHz: s.wallFilterHz,
      outputAmplitude: 10 ** (s.outputPowerDb / 20),
    };
  }

  private bumpVersion(): void {
    this.configVersion += 1;
  }

  private clearColumns(): void {
    this.cols.length = 0;
    this.lastComposition = null;
    this.rev += 1;
  }

  /**
   * Avanza la adquisición `elapsed` s. Agrupa el dt y envía un `step` como
   * mucho cada PW_STEP_INTERVAL_MS de tiempo real (y con ≤2 en vuelo).
   */
  step(clock: SimulationClock, elapsed: number): void {
    const s = this.state;
    if (!s.pwOn || s.frozen) {
      this.batchDt = 0;
      return;
    }
    try {
      const sceneKey = `${s.station}-${s.side}`;
      const physiology = this.sim.patient.physiology;
      const configureKey = `${sceneKey}|${JSON.stringify(physiology)}`;
      if (sceneKey !== this.sceneKey) {
        this.bumpVersion();
        this.clearColumns();
        this.batchDt = 0;
        this.lastSentGate = '';
        this.equipmentKey = '';
        this.sceneKey = sceneKey;
        this.configureKey = '';
      }
      if (configureKey !== this.configureKey) this.postConfigure();
      // Cambio de equipo o de la puerta elegida (no el temblor de la mano):
      // lo pendiente pertenece a la configuración anterior y se envía antes.
      const equipment = this.equipment();
      const equipmentKey = JSON.stringify(equipment);
      const versionKey = `${equipmentKey}|${s.gateUMm}|${s.gateDepthMm}|${s.settings.gateMm}`;
      if (versionKey !== this.versionKey) {
        // El lote pendiente se adquiere con la puerta/equipo anteriores (sin
        // huecos en el tiempo de la cadena) y su respuesta se descarta.
        if (this.batchDt > 0 && this.versionKey !== '') this.flushBatch(clock.t - elapsed, false);
        this.bumpVersion();
        this.versionKey = versionKey;
      }
      this.batchDt += elapsed;
      if (this.batchDt > MAX_BATCH_S) {
        // Worker saturado: se descarta el atraso más antiguo (hueco en el
        // espectro) en vez de acumular segundos de retraso; la cadena
        // re-sincroniza el tiempo de sus columnas en el próximo lote.
        this.batchDt = MAX_BATCH_S;
        this.needResync = true;
      }
      if (this.batchDt * 1000 < PW_STEP_INTERVAL_MS || this.inFlight >= MAX_IN_FLIGHT) return;
      this.flushBatch(clock.t, true);
    } catch (err) {
      logError('pw', err);
    }
  }

  /** Envía el lote [tEnd − dt, tEnd]; con `sendGate`, puerta/equipo actuales antes. */
  private flushBatch(tEnd: number, sendGate: boolean): void {
    const s = this.state;
    const dt = this.batchDt;
    this.batchDt = 0;
    if (dt <= 0) return;
    const tStart = tEnd - dt;
    if (sendGate) {
      const equipment = this.equipment();
      const equipmentKey = JSON.stringify(equipment);
      // Como antes: puerta con la pose (y el temblor) del final del intervalo.
      const pose = currentPose(this.sim, { ...s, tSec: tEnd, handMotion: s.handMotion });
      const gate = this.gateGeometry(pose);
      const gateKey = JSON.stringify(gate);
      if (gateKey !== this.lastSentGate || equipmentKey !== this.equipmentKey || this.needResync) {
        this.transport.post({
          type: 'setGate',
          configVersion: this.configVersion,
          gate,
          equipment,
          tSync: tStart,
          resync: this.needResync,
        });
        this.lastSentGate = gateKey;
        this.equipmentKey = equipmentKey;
        this.needResync = false;
      }
    } else if (this.equipmentKey === '') {
      return; // la cadena aún no tiene equipo: nada que adquirir
    }
    this.inFlight += 1;
    try {
      this.transport.post({
        type: 'step',
        configVersion: this.configVersion,
        tStart,
        dt,
        handMotion: s.handMotion === true,
        wantAudio: this.audio !== null,
      });
    } catch (err) {
      this.inFlight = Math.max(0, this.inFlight - 1);
      throw err;
    }
  }

  private receive(reply: PwReply): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    try {
      if (reply.configVersion < this.configVersion || reply.sceneKey !== this.sceneKey) {
        this.droppedReplies += 1;
        return;
      }
      if (!this.state.pwOn) return;
      this.fft = reply.fftSize;
      this.lastComposition = reply.composition;
      if (reply.count > 0) {
        for (const col of unpackColumns(reply)) this.cols.push(col);
        const tEnd = this.cols[this.cols.length - 1]!.t;
        let drop = 0;
        while (drop < this.cols.length && this.cols[drop]!.t < tEnd - COLUMN_WINDOW_S) drop += 1;
        drop = Math.max(drop, this.cols.length - MAX_COLUMNS);
        if (drop > 0) this.cols.splice(0, drop);
        this.rev += 1;
      }
      if (this.audio && reply.iqRe.length > 0) {
        this.audio.pushIQ(reply.iqRe, reply.iqIm, reply.iqRe.length, reply.iqPrfHz);
      }
    } catch (err) {
      logError('pw', err);
    }
  }

  reset(): void {
    this.bumpVersion();
    this.batchDt = 0;
    this.needResync = false;
    this.clearColumns();
    this.equipmentKey = '';
    this.lastSentGate = '';
    this.audio?.reset();
    this.transport.post({ type: 'reset', configVersion: this.configVersion });
  }

  /**
   * Última medida PSV/EDV/PI de la traza adquirida (DEC-56): se cachea por
   * revisión del búfer de columnas y ajustes de medida, así que solo se
   * recalcula cuando llegan columnas nuevas, y como mucho cada
   * MEASURE_MIN_INTERVAL_MS (la medida puede ir hasta ~0,5 s por detrás).
   * Un cambio de ajuste de medida (ángulo, filtro…) recalcula en el acto.
   */
  latestMcaMeasure(): ReturnType<typeof summarizeBeats> {
    const s = this.state;
    if (!s.pwOn || this.cols.length <= 20) return null;
    const settingsKey = `${s.settings.frequencyMhz}|${s.settings.angleCorrectionDeg}|${s.settings.invertColor}|${s.settings.wallFilterHz}|${this.fft}`;
    const cached = this.measureCache;
    const now = this.nowMs();
    if (cached && cached.settingsKey === settingsKey) {
      if (cached.revision === this.rev) return cached.value;
      if (now - cached.atMs < MEASURE_MIN_INTERVAL_MS) return cached.value;
    }
    const value = this.computeMcaMeasure();
    this.measureCache = { revision: this.rev, settingsKey, atMs: now, value };
    return value;
  }

  /** Medida sin caché (coste ~30–60 ms con 2,5 s de columnas). */
  private computeMcaMeasure(): ReturnType<typeof summarizeBeats> {
    try {
      const s = this.state;
      const cols = this.cols;
      if (!s.pwOn || cols.length <= 20) {
        return null;
      }
      // Ventana por TIEMPO (~2,5 s), no por columnas: al subir el PRF las
      // columnas se densifican (hop/prf) y una ventana fija de N columnas
      // cubre menos de un latido → la medición queda intermitente.
      const tEnd = cols[cols.length - 1]!.t;
      const windowCols = cols.filter((c) => c.t >= tEnd - 2.5);
      const trace = observedTrace(windowCols, {
        f0Hz: s.settings.frequencyMhz * 1e6,
        angleCorrectionRad: (s.settings.angleCorrectionDeg * Math.PI) / 180,
        invert: s.settings.invertColor,
        fftSize: this.fft,
        wallFilterHz: s.settings.wallFilterHz,
      });
      const t0 = trace[0]?.t ?? 0;
      const t1 = trace[trace.length - 1]?.t ?? 0;
      const beats = this.sim.cardiac.beatsIn(t0, t1);
      return summarizeBeats(
        measureBeats(
          trace,
          beats.map((b) => ({ tStart: b.tStart, rr: b.rr })),
        ),
      );
    } catch (err) {
      logError('pw', err);
      return null;
    }
  }

  composition(): GateComposition | null {
    return this.lastComposition;
  }
}

export function audioFor(enabled: boolean): DopplerAudio | null {
  if (!enabled) return null;
  const audio = new DopplerAudio();
  audio.setMuted(false);
  return audio;
}
