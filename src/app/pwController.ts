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
import {
  lindegaardIndex,
  assessPwTrace,
  observedTrace,
  summarizeBeats,
  type LindegaardResult,
  type PwAssessment,
} from '../doppler/measureMca';
import { DopplerAudio } from '../doppler/audio';
import type { AudioSink } from '../doppler/pwChain';
import type { GateComposition, GateGeometry } from '../doppler/sampleVolume';
import type { SpectralColumn } from '../doppler/spectral';
import type { AppState, IcaMeasure } from './state';
import { currentPose } from './poses';
import { DOPPLER } from '../doppler/params';
import { FISICA_US } from '../ultrasound/params';
import { logError } from '../core/errorLog';
import {
  pwAcquisitionContext,
  samePwPatient,
  icaValidityText,
  type IcaValidity,
  type PwAcquisitionContext,
  type PwCapture,
} from './pwCapture';
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
  private sceneKey: string | null = null;
  private versionKey = '';
  private acquiredContext: PwAcquisitionContext | null = null;
  private acquiredAngle: InsonationAngles | null = null;
  private qualityBlocks: { tStart: number; tEnd: number; composition: GateComposition | null }[] = [];
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
    value: PwCapture | null;
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
  }

  private forceReconfigure(): void {
    this.reset();
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
    this.measureCache = null;
    this.qualityBlocks = [];
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
      this.needResync = true;
      return;
    }
    try {
      const context = pwAcquisitionContext(this.sim, s);
      const versionKey = JSON.stringify(context);
      if (versionKey !== this.versionKey) {
        this.bumpVersion();
        this.clearColumns();
        this.batchDt = 0;
        this.lastSentGate = '';
        this.equipmentKey = '';
        this.sceneKey = `${s.station}-${s.side}`;
        this.acquiredContext = context;
        this.acquiredAngle = this.insonation();
        this.versionKey = versionKey;
        this.needResync = true;
        this.audio?.reset();
        this.postConfigure();
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
      this.flushBatch(clock.t);
    } catch (err) {
      logError('pw', err);
    }
  }

  /** Envía el lote [tEnd − dt, tEnd] con la puerta/equipo de este contexto. */
  private flushBatch(tEnd: number): void {
    const s = this.state;
    const dt = this.batchDt;
    this.batchDt = 0;
    if (dt <= 0) return;
    const tStart = tEnd - dt;
    {
      const equipment = this.equipment();
      const equipmentKey = JSON.stringify(equipment);
      const pose = currentPose(this.sim, s);
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
    }
    this.inFlight += 1;
    try {
      this.transport.post({
        type: 'step',
        configVersion: this.configVersion,
        tStart,
        dt,
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
      if (
        reply.configVersion !== this.configVersion ||
        reply.sceneKey !== this.sceneKey ||
        !this.contextMatches()
      ) {
        this.droppedReplies += 1;
        return;
      }
      if (!this.state.pwOn || this.state.frozen) {
        this.needResync = true;
        return;
      }
      this.fft = reply.fftSize;
      if (reply.count > 0) {
        if (
          reply.composition?.dominantVesselId !== this.lastComposition?.dominantVesselId ||
          this.reliableComposition(reply.composition) !== this.reliableComposition(this.lastComposition)
        )
          this.measureCache = null;
        this.lastComposition = reply.composition ? { ...reply.composition } : null;
        this.qualityBlocks.push({
          tStart: reply.times[0]!,
          tEnd: reply.times[reply.count - 1]!,
          composition: this.lastComposition,
        });
        for (const col of unpackColumns(reply)) this.cols.push(col);
        const tEnd = this.cols[this.cols.length - 1]!.t;
        let drop = 0;
        while (drop < this.cols.length && this.cols[drop]!.t < tEnd - COLUMN_WINDOW_S) drop += 1;
        drop = Math.max(drop, this.cols.length - MAX_COLUMNS);
        if (drop > 0) this.cols.splice(0, drop);
        this.qualityBlocks = this.qualityBlocks.filter((b) => b.tEnd >= tEnd - COLUMN_WINDOW_S);
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
    this.versionKey = '';
    this.acquiredContext = null;
    this.acquiredAngle = null;
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
   * Ángulo/inversión recalculan; cambiar la adquisición exige señal nueva.
   */
  latestMcaMeasure(): ReturnType<typeof summarizeBeats> {
    return this.latestCapture()?.summary ?? null;
  }

  latestPwAssessment(): PwAssessment | null {
    if (!this.contextMatches()) return null;
    return this.latestCapture()?.signal ?? null;
  }

  private contextMatches(): boolean {
    return this.versionKey === JSON.stringify(pwAcquisitionContext(this.sim, this.state));
  }

  private reliableComposition(c: GateComposition | null): boolean {
    return (
      !!c?.dominantVesselId &&
      Number.isFinite(c.bloodFraction) &&
      c.bloodFraction >= DOPPLER.params.debriefBloodFractionMin.value &&
      Number.isFinite(c.dominantVesselFraction) &&
      c.dominantVesselFraction / c.bloodFraction >= DOPPLER.params.pwDominantFractionMin.value
    );
  }

  latestCapture(): PwCapture | null {
    const s = this.state;
    if (!s.pwOn || this.cols.length <= 20) return null;
    const settingsKey = `${s.settings.angleCorrectionDeg}|${s.settings.invertColor}|${this.fft}|${this.contextMatches()}`;
    const cached = this.measureCache;
    const now = this.nowMs();
    if (cached && cached.settingsKey === settingsKey) {
      if (cached.revision === this.rev) return cached.value;
      if (!s.frozen && now - cached.atMs < MEASURE_MIN_INTERVAL_MS) return cached.value;
    }
    const value = this.computeMcaMeasure();
    this.measureCache = { revision: this.rev, settingsKey, atMs: now, value };
    this.recordIcaMeasure(value);
    return value;
  }

  /**
   * ACI ipsilateral con calidad de captura y ≥ 2 latidos (DEC-72).
   * Un intento posterior fallido conserva el historial, pero impide reutilizarlo.
   */
  private recordIcaMeasure(capture: PwCapture | null): void {
    const s = this.state;
    if (!capture || s.station !== 'submandibular' || !this.contextMatches()) return;
    const value = capture.summary;
    const comp = capture.composition;
    const vesselId = comp?.dominantVesselId ?? null;
    if (!value || value.beats < 2 || vesselId !== `aci-${s.side}`) {
      const previous = s.icaMeasured[s.side];
      if (previous && (vesselId === `aci-${s.side}` || capture.angle?.vesselId === `aci-${s.side}`)) {
        s.icaMeasured = {
          ...s.icaMeasured,
          [s.side]: { ...previous, lastFailedAttempt: structuredClone(capture) },
        };
      }
      return;
    }
    const measure: IcaMeasure = {
      taMaxCms: Math.abs(value.taMaxCms),
      psvCms: Math.abs(value.psvCms),
      edvCms: Math.abs(value.edvCms),
      ri: value.ri,
      beats: value.beats,
      vesselId,
      tSec: this.cols[this.cols.length - 1]?.t ?? 0,
      capture: structuredClone(capture),
    };
    s.icaMeasured = { ...s.icaMeasured, [s.side]: measure };
  }

  /** ACI reutilizable; el historial incompatible sigue en el estado. */
  measuredIca(side: AppState['side'] = this.state.side): IcaMeasure | null {
    return this.icaValidity(side) === 'vigente' ? this.state.icaMeasured[side] : null;
  }

  icaValidity(side: AppState['side'] = this.state.side, mcaTime?: number): IcaValidity {
    const ica = this.state.icaMeasured[side];
    if (!ica) return 'sin-medida';
    const c = ica.capture;
    if (
      !c ||
      c.status !== 'valida' ||
      !c.summary ||
      !Number.isFinite(ica.taMaxCms) ||
      ica.taMaxCms <= 0 ||
      ica.beats < 2 ||
      ica.lastFailedAttempt
    )
      return 'calidad-insuficiente';
    if (
      ica.vesselId !== `aci-${side}` ||
      c.composition?.dominantVesselId !== `aci-${side}` ||
      c.context.station !== 'submandibular' ||
      c.context.side !== side
    )
      return 'identidad-incompatible';
    if (!samePwPatient(c.context, pwAcquisitionContext(this.sim, this.state))) return 'contexto-incompatible';
    if (!Number.isFinite(ica.tSec) || (mcaTime !== undefined && ica.tSec > mcaTime))
      return 'tiempo-incompatible';
    return 'vigente';
  }

  /**
   * Lindegaard del lado actual si la puerta está en la M1 y hay medida:
   * ACI medida del MISMO lado si existe; si no, la de referencia del caso.
   */
  lindegaard(): LindegaardResult | null {
    const s = this.state;
    if (s.station !== 'temporal') return null;
    const capture = this.latestCapture();
    const summary = capture?.summary;
    if (!summary || summary.beats < 2 || capture?.composition?.dominantVesselId !== `m1-${s.side}`)
      return null;
    const ica = s.icaMeasured[s.side];
    const validity = this.icaValidity(s.side, capture.tEnd);
    const result = lindegaardIndex(
      summary.taMaxCms,
      ica ? (validity === 'vigente' ? ica.taMaxCms : Number.NaN) : null,
      this.sim.clinicalCase.icaExtracranialTamaxCms,
    );
    return validity === 'vigente' || validity === 'sin-medida'
      ? result
      : { ...result, invalidReason: icaValidityText(validity) };
  }

  /** Medida sin caché (coste ~30–60 ms con 2,5 s de columnas). */
  private computeMcaMeasure(): PwCapture | null {
    try {
      const s = this.state;
      const cols = this.cols;
      const context = this.acquiredContext;
      if (!s.pwOn || cols.length <= 20 || !context) {
        return null;
      }
      // Ventana por TIEMPO (~2,5 s), no por columnas: al subir el PRF las
      // columnas se densifican (hop/prf) y una ventana fija de N columnas
      // cubre menos de un latido → la medición queda intermitente.
      const tEnd = cols[cols.length - 1]!.t;
      const windowCols = cols.filter((c) => c.t >= tEnd - 2.5);
      const trace = observedTrace(windowCols, {
        f0Hz: context.equipment.frequencyMhz * 1e6,
        angleCorrectionRad: (s.settings.angleCorrectionDeg * Math.PI) / 180,
        invert: s.settings.invertColor,
        fftSize: this.fft,
        wallFilterHz: context.equipment.wallFilterHz,
      });
      const t0 = trace[0]?.t ?? 0;
      const t1 = trace[trace.length - 1]?.t ?? 0;
      const beats = this.sim.cardiac.beatsIn(t0, t1);
      const signal = assessPwTrace(
        trace,
        beats.map((b) => ({ tStart: b.tStart, rr: b.rr })),
      );
      const blocks = this.qualityBlocks.filter((b) => b.tEnd >= t0 && b.tStart <= t1);
      const composition = this.lastComposition ? { ...this.lastComposition } : null;
      const reliable =
        blocks.length > 0 &&
        blocks.every(
          (b) =>
            this.reliableComposition(b.composition) &&
            b.composition?.dominantVesselId === composition?.dominantVesselId,
        );
      const angle = this.acquiredAngle ? { ...this.acquiredAngle } : null;
      const correction = { angleDeg: s.settings.angleCorrectionDeg, inverted: s.settings.invertColor };
      const angleOk =
        angle &&
        Number.isFinite(angle.realDeg) &&
        angle.realDeg <= DOPPLER.params.debriefAngleMaxDeg.value &&
        Number.isFinite(correction.angleDeg) &&
        Math.abs(correction.angleDeg) <= DOPPLER.params.debriefAngleMaxDeg.value;
      const status = !this.contextMatches()
        ? 'contexto-incompatible'
        : signal.status !== 'valida'
          ? signal.status
          : !reliable
            ? 'puerta-no-fiable'
            : !angleOk
              ? 'angulo-invalido'
              : 'valida';
      const summary = status === 'valida' ? signal.summary : null;
      const minimum = (values: number[]) =>
        values.length > 0 && values.every(Number.isFinite) ? Math.min(...values) : null;
      const quality = {
        blocks: blocks.length,
        bloodFractionMin: minimum(blocks.map((b) => b.composition?.bloodFraction ?? Number.NaN)),
        dominantBloodFractionMin: minimum(
          blocks.map((b) =>
            b.composition ? b.composition.dominantVesselFraction / b.composition.bloodFraction : Number.NaN,
          ),
        ),
        vesselIds: [...new Set(blocks.map((b) => b.composition?.dominantVesselId ?? null))],
      };
      return {
        schemaVersion: 1,
        context: structuredClone(context),
        configVersion: this.configVersion,
        fftSize: this.fft,
        quality,
        tStart: t0,
        tEnd: t1,
        correction,
        composition,
        angle,
        signal: { ...signal, summary },
        status,
        summary,
      };
    } catch (err) {
      logError('pw', err);
      return null;
    }
  }

  composition(): GateComposition | null {
    return this.contextMatches() ? this.lastComposition : null;
  }
}

export function audioFor(enabled: boolean): DopplerAudio | null {
  if (!enabled) return null;
  const audio = new DopplerAudio();
  audio.setMuted(false);
  return audio;
}
