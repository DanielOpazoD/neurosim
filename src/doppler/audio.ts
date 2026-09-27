/**
 * Audio Doppler direccional del equipo. La separación por signo y el moldeo
 * previo al resampleo son puros; esta clase solo conecta Web Audio.
 */
import { DOPPLER } from './params';
import { applyAgc, lowPass, separateDirectional, type AgcState } from './audioShaping';
import type { AudioSink } from './pwChain';

const WORK = 1024;
const KEEP = 256;

export class DopplerAudio implements AudioSink {
  private readonly ctx: AudioContext;
  private pendingRe = new Float32Array(0);
  private pendingIm = new Float32Array(0);
  private readonly outL = new Float32Array(1 << 15);
  private readonly outR = new Float32Array(1 << 15);
  private outLen = 0;
  private readonly gain: GainNode;
  private prfHz = 4000;
  private volume = 40;
  private readonly agcL: AgcState = { level: 0 };
  private readonly agcR: AgcState = { level: 0 };

  constructor() {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    this.scheduleNext();
  }

  setVolume(percent: number): void {
    this.volume = Math.min(100, Math.max(0, percent));
    this.gain.gain.setTargetAtTime(this.volume / 100, this.ctx.currentTime, 0.05);
  }

  /** Activa/silencia el sonido; el volumen permanece bajo control del equipo. */
  setMuted(m: boolean): void {
    this.gain.gain.setTargetAtTime(m ? 0 : this.volume / 100, this.ctx.currentTime, 0.05);
    if (!m && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  pushIQ(re: Float32Array, im: Float32Array, n: number, prfHz: number): void {
    this.prfHz = prfHz;
    const nextRe = new Float32Array(this.pendingRe.length + n);
    const nextIm = new Float32Array(this.pendingIm.length + n);
    nextRe.set(this.pendingRe);
    nextIm.set(this.pendingIm);
    nextRe.set(re.subarray(0, n), this.pendingRe.length);
    nextIm.set(im.subarray(0, n), this.pendingIm.length);
    this.pendingRe = nextRe;
    this.pendingIm = nextIm;
    if (this.pendingRe.length >= WORK) this.processPending();
  }

  private processPending(): void {
    const separated = separateDirectional(this.pendingRe, this.pendingIm);
    const emit = Math.max(0, separated.positive.length - KEEP);
    this.append(separated.positive.subarray(0, emit), separated.negative.subarray(0, emit));
    this.pendingRe = this.pendingRe.slice(emit);
    this.pendingIm = this.pendingIm.slice(emit);
  }

  private append(left: Float32Array, right: Float32Array): void {
    if (this.outLen + left.length > this.outL.length) {
      const drop = Math.min(this.outLen, this.outL.length >> 1);
      this.outL.copyWithin(0, drop);
      this.outR.copyWithin(0, drop);
      this.outLen -= drop;
    }
    this.outL.set(left, this.outLen);
    this.outR.set(right, this.outLen);
    this.outLen += left.length;
  }

  /** Programa el siguiente bloque de audio re-muestreado. */
  private scheduleNext(): void {
    const sr = this.ctx.sampleRate;
    const chunkSec = 0.2;
    const chunkOut = Math.floor(chunkSec * sr);
    if (this.outLen < 64) {
      const buf = this.ctx.createBuffer(2, chunkOut, sr);
      this.play(buf);
      return;
    }
    const take = Math.min(this.outLen, Math.floor(this.prfHz * chunkSec));
    const rawL = this.outL.slice(0, take);
    const rawR = this.outR.slice(0, take);
    const cutoff = this.prfHz * 0.5 * DOPPLER.params.audioLowpassFrac.value;
    const shapedL = applyAgc(
      lowPass(rawL, this.prfHz, cutoff),
      this.prfHz,
      this.agcL,
      DOPPLER.params.audioAgcTauS.value,
    );
    const shapedR = applyAgc(
      lowPass(rawR, this.prfHz, cutoff),
      this.prfHz,
      this.agcR,
      DOPPLER.params.audioAgcTauS.value,
    );
    const buf = this.ctx.createBuffer(2, chunkOut, sr);
    const ch0 = buf.getChannelData(0);
    const ch1 = buf.getChannelData(1);
    for (let i = 0; i < chunkOut; i++) {
      const idx = (i / chunkOut) * Math.max(1, take - 1);
      const i0 = Math.floor(idx);
      const i1 = Math.min(take - 1, i0 + 1);
      const f = idx - i0;
      ch0[i] = shapedL[i0]! * (1 - f) + shapedL[i1]! * f;
      ch1[i] = shapedR[i0]! * (1 - f) + shapedR[i1]! * f;
    }
    this.outL.copyWithin(0, take);
    this.outR.copyWithin(0, take);
    this.outLen -= take;
    this.play(buf);
  }

  private play(buf: AudioBuffer): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    src.start();
    src.onended = () => this.scheduleNext();
  }

  reset(): void {
    this.outLen = 0;
    this.pendingRe = new Float32Array(0);
    this.pendingIm = new Float32Array(0);
    this.agcL.level = 0;
    this.agcR.level = 0;
  }
}
