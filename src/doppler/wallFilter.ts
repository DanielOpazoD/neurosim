// Portado de DanielOpazoD/vexus-sim @ 59fb7b18e9c1 — src/doppler/wallFilter.ts (MIT).
// Adaptación local: neurosono-sim. Ver docs/PROVENANCE.md.

/**
 * Filtro de pared (clutter) IIR paso alto: dos secciones de 2.º orden en
 * cascada (4.º orden) aplicadas a la señal IQ compleja (parte real e
 * imaginaria por separado; el filtro es lineal). Elimina los componentes
 * lentos (tejido, pared); un corte alto borra flujo venoso lento (guía §16,
 * invariante §21).
 */
export class WallFilter {
  private stage2: WallFilterStage;
  private stage1: WallFilterStage;

  constructor(cutoffHz: number, sampleRateHz: number) {
    this.stage1 = new WallFilterStage(cutoffHz, sampleRateHz);
    this.stage2 = new WallFilterStage(cutoffHz, sampleRateHz);
  }

  get cutoffHz(): number {
    return this.stage1.cutoffHz;
  }

  design(cutoffHz: number, sampleRateHz: number): void {
    this.stage1.design(cutoffHz, sampleRateHz);
    this.stage2.design(cutoffHz, sampleRateHz);
  }

  /** Respuesta en magnitud |H(f)| (0–1). */
  magnitude(fHz: number): number {
    const m = this.stage1.magnitude(fHz);
    return m * m;
  }

  process(re: Float32Array, im: Float32Array, n = re.length): void {
    this.stage1.process(re, im, n);
    this.stage2.process(re, im, n);
  }

  reset(): void {
    this.stage1.reset();
    this.stage2.reset();
  }
}

/** Sección bicuadrática paso alto (Butterworth de 2.º orden). */
export class WallFilterStage {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1r = 0;
  private x2r = 0;
  private y1r = 0;
  private y2r = 0;
  private x1i = 0;
  private x2i = 0;
  private y1i = 0;
  private y2i = 0;
  private _cutoffHz = 0;
  private _sampleRate = 0;

  constructor(cutoffHz: number, sampleRateHz: number) {
    this.design(cutoffHz, sampleRateHz);
  }

  get cutoffHz(): number {
    return this._cutoffHz;
  }

  design(cutoffHz: number, sampleRateHz: number): void {
    if (cutoffHz === this._cutoffHz && sampleRateHz === this._sampleRate) return;
    this._cutoffHz = cutoffHz;
    this._sampleRate = sampleRateHz;
    const fc = Math.min(cutoffHz, sampleRateHz * 0.45);
    if (fc <= 0) {
      this.b0 = 1;
      this.b1 = this.b2 = this.a1 = this.a2 = 0;
      return;
    }
    // Transformación bilineal, Q = 1/√2
    const k = Math.tan((Math.PI * fc) / sampleRateHz);
    const q = Math.SQRT1_2;
    const norm = 1 / (1 + k / q + k * k);
    this.b0 = norm;
    this.b1 = -2 * norm;
    this.b2 = norm;
    this.a1 = 2 * (k * k - 1) * norm;
    this.a2 = (1 - k / q + k * k) * norm;
  }

  /** Respuesta en magnitud |H(f)| (0–1) para una frecuencia f. */
  magnitude(fHz: number): number {
    if (this._cutoffHz <= 0) return 1;
    const w = (2 * Math.PI * fHz) / this._sampleRate;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = Math.sin(2 * w);
    const nr = this.b0 + this.b1 * cw + this.b2 * c2;
    const ni = -(this.b1 * sw + this.b2 * s2);
    const dr = 1 + this.a1 * cw + this.a2 * c2;
    const di = -(this.a1 * sw + this.a2 * s2);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }

  /** Filtra en el sitio. */
  process(re: Float32Array, im: Float32Array, n = re.length): void {
    for (let i = 0; i < n; i++) {
      const xr = re[i]!;
      const yr =
        this.b0 * xr + this.b1 * this.x1r + this.b2 * this.x2r - this.a1 * this.y1r - this.a2 * this.y2r;
      this.x2r = this.x1r;
      this.x1r = xr;
      this.y2r = this.y1r;
      this.y1r = yr;
      re[i] = yr;
      const xi = im[i]!;
      const yi =
        this.b0 * xi + this.b1 * this.x1i + this.b2 * this.x2i - this.a1 * this.y1i - this.a2 * this.y2i;
      this.x2i = this.x1i;
      this.x1i = xi;
      this.y2i = this.y1i;
      this.y1i = yi;
      im[i] = yi;
    }
  }

  reset(): void {
    this.x1r = this.x2r = this.y1r = this.y2r = 0;
    this.x1i = this.x2i = this.y1i = this.y2i = 0;
  }
}
