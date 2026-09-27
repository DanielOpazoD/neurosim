// Portado de DanielOpazoD/vexus-sim @ 59fb7b18e9c1 — src/doppler/measureMca.ts (MIT).
// Adaptación local: neurosono-sim. Ver docs/PROVENANCE.md.
// LIM-09: la envolvente observada conserva el sesgo diastólico conocido.
/**
 * Medición sobre el espectro ADQUIRIDO (envolvente observada), separada de la
 * verdad fisiológica. La velocidad rotulada depende de la corrección angular
 * que puso el operador; TAMax se integra sobre la envolvente verdadera por
 * latido — no es la aproximación (PSV+2·EDV)/3.
 *
 * Índices: PI de Gosling = (PSV − EDV)/MFV ; IR = (PSV − EDV)/PSV.
 */
import { velocityFromShiftMmS, mmsToCms } from '../core/units';
import { captureNoiseFloorsDb, columnBandEnvelopes, type SpectralColumn } from './spectral';

/**
 * Promedio del espectro en una vecindad 3 × 3 (columnas × bins) en potencia
 * lineal: reduce la varianza del periodograma antes de trazar la envolvente,
 * como el promediado de visualización de un equipo. (Portado de
 * spectralMeasure.ts de vexus-sim, mismo @ 59fb7b18e9c1.)
 */
export function smoothSpectrum(columns: readonly SpectralColumn[]): SpectralColumn[] {
  const n = columns.length;
  if (n === 0) return [];
  const N = columns[0]!.powerDb.length;
  const lin = columns.map((c) => Float64Array.from(c.powerDb, (db) => Math.pow(10, db / 10)));
  return columns.map((c, i) => {
    const out = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      let acc = 0;
      let cnt = 0;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= n || lin[ii]!.length !== N) continue;
        for (let dk = -1; dk <= 1; dk++) {
          const kk = k + dk;
          if (kk < 0 || kk >= N) continue;
          acc += lin[ii]![kk]!;
          cnt++;
        }
      }
      out[k] = 10 * Math.log10(acc / cnt);
    }
    return { t: c.t, prfHz: c.prfHz, powerDb: out };
  });
}

export interface MeasureOptions {
  f0Hz: number;
  angleCorrectionRad: number;
  invert: boolean;
  fftSize: number;
  thresholdMarginDb?: number;
  wallFilterHz?: number;
}

export interface BeatMeasure {
  readonly tStart: number;
  readonly rrS: number;
  /** cm/s, signo de pantalla (+ hacia la sonda si no invertida). */
  readonly psvCms: number;
  readonly edvCms: number;
  /** TAMax: integral de la envolvente / periodo, cm/s. */
  readonly taMaxCms: number;
  readonly pi: number;
  readonly ri: number;
  /** Dirección dominante del latido (+1 hacia la sonda). */
  readonly sign: number;
}

export interface SpectralTracePoint {
  t: number;
  /** Velocidad rotulada con signo de pantalla, cm/s. */
  vCms: number;
}

/**
 * Traza observada: envolvente del percentil por columna + mediana temporal de
 * 5 puntos (≈ un equipo real). Devuelve velocidad en cm/s.
 */
export function observedTrace(
  columns: readonly SpectralColumn[],
  opts: MeasureOptions,
): SpectralTracePoint[] {
  const margin = opts.thresholdMarginDb ?? 12;
  const smoothed = smoothSpectrum(columns);
  const floors = captureNoiseFloorsDb(smoothed);
  const raw: SpectralTracePoint[] = [];
  for (const [i, col] of smoothed.entries()) {
    const floor = floors[i]!;
    const b = columnBandEnvelopes(col, opts.fftSize, floor, margin);
    const fSigned = !b.detected ? 0 : b.ePos >= b.eNeg ? b.posHz : -b.negHz;
    const vMm = velocityFromShiftMmS(fSigned, opts.f0Hz, opts.angleCorrectionRad);
    const v = (Number.isFinite(vMm) ? mmsToCms(vMm) : 0) * (opts.invert ? -1 : 1);
    raw.push({ t: col.t, vCms: v });
  }
  // mediana temporal de 5 puntos
  return raw.map((p, i) => {
    const win: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) win.push(raw[j]!.vCms);
    win.sort((a, b) => a - b);
    return { t: p.t, vCms: win[win.length >> 1]! };
  });
}

/**
 * Medidas por latido sobre la traza observada. `beats` son ventanas
 * {tStart, rr} del reloj cardíaco (mismo reloj de simulación).
 */
export function measureBeats(
  trace: readonly SpectralTracePoint[],
  beats: readonly { tStart: number; rr: number }[],
): BeatMeasure[] {
  const out: BeatMeasure[] = [];
  for (const b of beats) {
    const pts = trace.filter((p) => p.t >= b.tStart && p.t < b.tStart + b.rr);
    if (pts.length < 6) continue;
    const sign = pts.reduce((a, p) => a + p.vCms, 0) >= 0 ? 1 : -1;
    let psv = -Infinity;
    let edv = Infinity;
    let integ = 0;
    let lastT: number | null = null;
    for (const p of pts) {
      const v = Math.abs(p.vCms);
      if (v > psv) psv = v;
      if (v < edv) edv = v;
      if (lastT !== null) integ += v * (p.t - lastT);
      lastT = p.t;
    }
    if (!Number.isFinite(psv) || !Number.isFinite(edv)) continue;
    const taMax = integ / Math.max(1e-6, lastT! - pts[0]!.t);
    const mfv = taMax > 0 ? taMax : Number.NaN;
    out.push({
      tStart: b.tStart,
      rrS: b.rr,
      psvCms: psv * sign,
      edvCms: edv * sign,
      taMaxCms: taMax * sign,
      pi: Math.abs(psv - edv) / Math.max(1e-6, mfv),
      ri: Math.abs(psv - edv) / Math.max(1e-6, psv),
      sign,
    });
  }
  return out;
}

/** Resumen de la captura: mediana por magnitud de cada índice. */
export function summarizeBeats(ms: readonly BeatMeasure[]): {
  psvCms: number;
  edvCms: number;
  taMaxCms: number;
  pi: number;
  ri: number;
  beats: number;
} | null {
  if (!ms.length) return null;
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[s.length >> 1]!;
  };
  return {
    psvCms: med(ms.map((m) => m.psvCms)),
    edvCms: med(ms.map((m) => m.edvCms)),
    taMaxCms: med(ms.map((m) => m.taMaxCms)),
    pi: med(ms.map((m) => m.pi)),
    ri: med(ms.map((m) => m.ri)),
    beats: ms.length,
  };
}
