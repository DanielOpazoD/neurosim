import { FFT, hannWindow } from '../core/fft';

const BLOCK = 256;
const HOP = BLOCK / 2;

export interface DirectionalAudio {
  readonly positive: Float32Array;
  readonly negative: Float32Array;
}

function directionalBlock(
  re: Float32Array,
  im: Float32Array,
  fft: FFT,
  taper: Float32Array,
): DirectionalAudio {
  const wr = new Float32Array(BLOCK);
  const wi = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    wr[i] = re[i]! * taper[i]!;
    wi[i] = im[i]! * taper[i]!;
  }
  fft.forward(wr, wi);
  const posRe = wr.slice();
  const posIm = wi.slice();
  for (let k = BLOCK / 2; k < BLOCK; k++) {
    posRe[k] = 0;
    posIm[k] = 0;
  }
  const negRe = wr.slice();
  const negIm = wi.slice();
  for (let k = 1; k < BLOCK / 2; k++) {
    negRe[k] = 0;
    negIm[k] = 0;
  }
  const positive = inverseReal(posRe, posIm, fft);
  const negative = inverseReal(negRe, negIm, fft);
  return { positive, negative };
}

function inverseReal(re: Float32Array, im: Float32Array, fft: FFT): Float32Array {
  for (let i = 0; i < BLOCK; i++) im[i] = -im[i]!;
  fft.forward(re, im);
  const out = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) out[i] = re[i]! / BLOCK;
  return out;
}

/** Separa por signo con ventana Hann y overlap-add al 50 %. */
export function separateDirectional(re: Float32Array, im: Float32Array): DirectionalAudio {
  if (re.length !== im.length) throw new Error('separateDirectional: longitudes distintas');
  if (re.length === 0) return { positive: new Float32Array(), negative: new Float32Array() };
  const fft = new FFT(BLOCK);
  const taper = hannWindow(BLOCK);
  const positive = new Float32Array(re.length + BLOCK);
  const negative = new Float32Array(re.length + BLOCK);
  const weight = new Float32Array(re.length + BLOCK);
  for (let start = 0; start < re.length; start += HOP) {
    const blockRe = new Float32Array(BLOCK);
    const blockIm = new Float32Array(BLOCK);
    blockRe.set(re.subarray(start, Math.min(re.length, start + BLOCK)));
    blockIm.set(im.subarray(start, Math.min(im.length, start + BLOCK)));
    const block = directionalBlock(blockRe, blockIm, fft, taper);
    for (let i = 0; i < BLOCK; i++) {
      const index = start + i;
      if (index >= positive.length) break;
      const w = taper[i]! * taper[i]!;
      positive[index] = positive[index]! + block.positive[i]! * taper[i]!;
      negative[index] = negative[index]! + block.negative[i]! * taper[i]!;
      weight[index] = weight[index]! + w;
    }
  }
  const outPositive = new Float32Array(re.length);
  const outNegative = new Float32Array(re.length);
  for (let i = 0; i < re.length; i++) {
    const w = Math.max(1e-6, weight[i]!);
    outPositive[i] = positive[i]! / w;
    outNegative[i] = negative[i]! / w;
  }
  return { positive: outPositive, negative: outNegative };
}

/** Paso bajo Butterworth de segundo orden, puro y determinista. */
export function lowPass(signal: Float32Array, sampleRateHz: number, cutoffHz: number): Float32Array {
  const fc = Math.min(Math.max(0, cutoffHz), sampleRateHz * 0.45);
  if (fc <= 0) return signal.slice();
  const k = Math.tan((Math.PI * fc) / sampleRateHz);
  const q = Math.SQRT1_2;
  const norm = 1 / (1 + k / q + k * k);
  const b0 = k * k * norm;
  const b1 = 2 * b0;
  const b2 = b0;
  const a1 = 2 * (k * k - 1) * norm;
  const a2 = (1 - k / q + k * k) * norm;
  const out = new Float32Array(signal.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i]!;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

export interface AgcState {
  level: number;
}

/** AGC lento: conserva la dinámica temporal y normaliza el nivel absoluto. */
export function applyAgc(
  signal: Float32Array,
  sampleRateHz: number,
  state: AgcState,
  tauS = 0.5,
  target = 0.2,
): Float32Array {
  const out = new Float32Array(signal.length);
  const alpha = 1 - Math.exp(-1 / Math.max(1, sampleRateHz * tauS));
  for (let i = 0; i < signal.length; i++) {
    state.level += alpha * (Math.abs(signal[i]!) - state.level);
    const gain = target / Math.max(target * 0.05, state.level);
    out[i] = signal[i]! * Math.min(8, gain);
  }
  return out;
}
