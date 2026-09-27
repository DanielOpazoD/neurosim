// Portado de DanielOpazoD/vexus-sim @ 59fb7b18e9c1 — src/core/fft.ts (MIT).
// Adaptación local: neurosono-sim. Ver docs/PROVENANCE.md.

/**
 * FFT compleja radix-2 en el sitio (Cooley–Tukey iterativa). Se usa para la
 * STFT del espectrograma PW. Tamaños potencia de 2.
 */
export class FFT {
  readonly n: number;
  private readonly cosT: Float32Array;
  private readonly sinT: Float32Array;
  private readonly rev: Uint32Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT: n debe ser potencia de 2, recibido ${n}`);
    this.n = n;
    this.cosT = new Float32Array(n / 2);
    this.sinT = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cosT[i] = Math.cos((2 * Math.PI * i) / n);
      this.sinT[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** Transformada directa en el sitio (signo −). */
  forward(re: Float32Array, im: Float32Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const tableStep = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const idx = k * tableStep;
          const wr = this.cosT[idx];
          const wi = -this.sinT[idx];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

/** Ventana de Hann periódica de longitud n. */
export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
