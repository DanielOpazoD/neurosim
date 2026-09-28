/**
 * Controlador de PW: cadena, puerta, audio y medidas de la traza adquirida.
 * La UI solo consume columnas, composición y el resumen más reciente.
 */
import { add, scale } from '../core/vec3';
import type { SimulationClock } from '../core/clock';
import type { ProbePose } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import { beamDirAt, elevAxis } from '../ultrasound/probe';
import { skullAttenuationDb } from '../ultrasound/attenuation';
import type { VesselScene } from '../anatomy/head';
import { eyeDopplerScene } from './renderRequest';
import { measureBeats, observedTrace, summarizeBeats } from '../doppler/measureMca';
import { DopplerAudio } from '../doppler/audio';
import { PwDopplerChain, type AudioSink } from '../doppler/pwChain';
import type { AppState } from './state';
import { currentPose, handMotionVelocityMmS } from './poses';
import { DOPPLER } from '../doppler/params';
import { FISICA_US } from '../ultrasound/params';
import { logError } from '../core/errorLog';
import { insonationAngles, type InsonationAngles } from '../doppler/insonation';

export class PwController {
  private chain: PwDopplerChain | null = null;
  private lastPrf = -1;
  private lastWf = -1;
  private lastDg = -999;
  private lastPower = Number.NaN;
  private audio: DopplerAudio | null = null;
  private chainKey = '';

  constructor(
    private readonly sim: ReferenceCase,
    private readonly state: AppState,
  ) {}

  get currentChain(): PwDopplerChain | null {
    return this.chain;
  }

  /** Clave estación-lado de la cadena activa; la UI la compara con el estado. */
  get chainSceneKey(): string | null {
    return this.chain ? this.chainKey : null;
  }

  setAudioSink(audio: DopplerAudio | null): void {
    this.audio = audio;
    if (this.chain) this.chain.audio.reset();
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

  private dopplerScene(): VesselScene {
    return this.state.station === 'ojo' ? eyeDopplerScene(this.sim.eyes[this.state.side]) : this.sim.head;
  }

  ensureChain(): PwDopplerChain {
    const key = `${this.state.station}-${this.state.side}`;
    if (!this.chain || this.chainKey !== key) {
      const sink: AudioSink = {
        pushIQ: (re, im, n, prfHz) => this.audio?.pushIQ(re, im, n, prfHz),
        reset: () => this.audio?.reset(),
      };
      this.chain = new PwDopplerChain(this.dopplerScene(), this.sim.patient.seed, sink);
      this.chainKey = key;
    }
    return this.chain;
  }

  gateGeometry(pose: ProbePose) {
    const s = this.state;
    const scene = this.dopplerScene();
    const beamDir = beamDirAt(pose, s.settings.transducer, s.gateUMm);
    const center = add(pose.origin, scale(beamDir, s.gateDepthMm));
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

  step(clock: SimulationClock, elapsed: number): void {
    const s = this.state;
    if (!s.pwOn || s.frozen) return;
    try {
      const chain = this.ensureChain();
      if (
        s.settings.prfHz !== this.lastPrf ||
        s.settings.wallFilterHz !== this.lastWf ||
        s.settings.dopplerGainDb !== this.lastDg ||
        s.settings.outputPowerDb !== this.lastPower
      ) {
        chain.begin(
          s.settings.prfHz,
          s.settings.frequencyMhz * 1e6,
          s.settings.dopplerGainDb,
          s.settings.wallFilterHz,
          clock.t,
          10 ** (s.settings.outputPowerDb / 20),
        );
        this.lastPrf = s.settings.prfHz;
        this.lastWf = s.settings.wallFilterHz;
        this.lastDg = s.settings.dopplerGainDb;
        this.lastPower = s.settings.outputPowerDb;
      }
      const pose = currentPose(this.sim, { ...s, tSec: clock.t, handMotion: s.handMotion });
      chain.setGate(this.gateGeometry(pose));
      const seed = this.sim.patient.seed;
      const moving = s.handMotion === true;
      chain.step(
        (tt) => this.sim.physStateAt(tt),
        clock.t - elapsed,
        moving ? (tt) => handMotionVelocityMmS(tt, seed) : () => [0, 0, 0],
        elapsed,
      );
      chain.flush();
    } catch (err) {
      logError('pw', err);
    }
  }

  reset(): void {
    this.ensureChain().reset();
    this.lastPrf = -1;
    this.lastPower = Number.NaN;
  }

  latestMcaMeasure(): ReturnType<typeof summarizeBeats> {
    try {
      const chain = this.chain;
      const s = this.state;
      if (!chain || !s.pwOn || chain.spectral.columns.length <= 20) {
        return null;
      }
      const trace = observedTrace(chain.spectral.columns.slice(-400), {
        f0Hz: s.settings.frequencyMhz * 1e6,
        angleCorrectionRad: (s.settings.angleCorrectionDeg * Math.PI) / 180,
        invert: s.settings.invertColor,
        fftSize: chain.spectral.fftSize,
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

  composition() {
    return this.chain?.sampleVolume.lastComposition ?? null;
  }
}

export function audioFor(enabled: boolean): DopplerAudio | null {
  if (!enabled) return null;
  const audio = new DopplerAudio();
  audio.setMuted(false);
  return audio;
}
