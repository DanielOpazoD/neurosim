/**
 * Audio Doppler direccional (navegador): separa el espectro por signo con FFT
 * por bloques — frecuencias positivas (hacia la sonda) a un canal y negativas
 * al otro — y re-muestrea a la frecuencia de la AudioContext. La cadena PW le
 * inyecta este sumidero; sin audio real en pruebas.
 */
import { FFT } from '../core/fft';
import type { AudioSink } from './pwChain';

const BLOCK = 256;

export class DopplerAudio implements AudioSink {
  private ctx: AudioContext;
  private fft = new FFT(BLOCK);
  private reB = new Float32Array(BLOCK);
  private imB = new Float32Array(BLOCK);
  private filled = 0;
  /** Cola de muestras ya separadas en canales (a la PRF). */
  private outL = new Float32Array(1 << 15);
  private outR = new Float32Array(1 << 15);
  private outLen = 0;
  private gain: GainNode;
  private wRe = new Float32Array(BLOCK);
  private wIm = new Float32Array(BLOCK);
  private hRe = new Float32Array(BLOCK);
  private hIm = new Float32Array(BLOCK);
  private prfHz = 4000;

  constructor() {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    this.scheduleNext();
  }

  /** Activa/silencia el sonido (el usuario controla el volumen real). */
  setMuted(m: boolean): void {
    this.gain.gain.setTargetAtTime(m ? 0 : 0.4, this.ctx.currentTime, 0.05);
    if (!m && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  pushIQ(re: Float32Array, im: Float32Array, n: number, prfHz: number): void {
    this.prfHz = prfHz;
    for (let i = 0; i < n; i++) {
      this.reB[this.filled] = re[i]!;
      this.imB[this.filled] = im[i]!;
      this.filled++;
      if (this.filled === BLOCK) {
        this.separate();
        this.filled = 0;
      }
    }
  }

  /** Divide el bloque IQ en canales por signo de frecuencia. */
  private separate(): void {
    const wRe = this.wRe;
    const wIm = this.wIm;
    wRe.set(this.reB);
    wIm.set(this.imB);
    this.fft.forward(wRe, wIm);
    const half = BLOCK / 2;
    // FFT directa: bins k ∈ [1, half) = frecuencias positivas (hacia la sonda),
    // k ∈ (half, N) = negativas. Canal derecho = hacia la sonda.
    this.hRe.set(wRe);
    this.hIm.set(wIm);
    for (let k = half; k < BLOCK; k++) {
      this.hRe[k] = 0;
      this.hIm[k] = 0;
    }
    const pos = this.ifftReal(this.hRe, this.hIm);
    // canal «alejándose»
    this.hRe.set(wRe);
    this.hIm.set(wIm);
    for (let k = 1; k < half; k++) {
      this.hRe[k] = 0;
      this.hIm[k] = 0;
    }
    const neg = this.ifftReal(this.hRe, this.hIm);
    this.append(pos, neg);
  }

  private ifftReal(re: Float32Array, im: Float32Array): Float32Array {
    // IFFT via conjugación: ifft(x) = conj(fft(conj(x)))/N
    for (let i = 0; i < BLOCK; i++) im[i] = -im[i]!;
    this.fft.forward(re, im);
    const out = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) out[i] = re[i]! / BLOCK;
    for (let i = 0; i < BLOCK; i++) im[i] = -im[i]!;
    return out;
  }

  private append(l: Float32Array, r: Float32Array): void {
    if (this.outLen + BLOCK > this.outL.length) {
      // buffer lleno: descarta la mitad más vieja (la cola es corta)
      const drop = this.outL.length >> 1;
      this.outL.copyWithin(0, drop);
      this.outR.copyWithin(0, drop);
      this.outLen -= drop;
    }
    this.outL.set(l, this.outLen);
    this.outR.set(r, this.outLen);
    this.outLen += BLOCK;
  }

  /** Programa el siguiente trozo de audio en el tiempo de la AudioContext. */
  private scheduleNext(): void {
    const sr = this.ctx.sampleRate;
    const chunkSec = 0.2;
    const chunkOut = Math.floor(chunkSec * sr);
    if (this.outLen < 64) {
      // sin señal: un poco de silencio para no quedarse parado
      const buf = this.ctx.createBuffer(2, chunkOut, sr);
      this.play(buf);
      return;
    }
    const take = Math.min(this.outLen, Math.floor(this.prfHz * chunkSec));
    const buf = this.ctx.createBuffer(2, chunkOut, sr);
    const ch0 = buf.getChannelData(0);
    const ch1 = buf.getChannelData(1);
    for (let i = 0; i < chunkOut; i++) {
      const idx = (i / chunkOut) * take;
      const i0 = Math.floor(idx);
      const i1 = Math.min(take - 1, i0 + 1);
      const f = idx - i0;
      ch0[i] = this.outL[i0]! * (1 - f) + this.outL[i1]! * f;
      ch1[i] = this.outR[i0]! * (1 - f) + this.outR[i1]! * f;
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
    this.filled = 0;
  }
}
