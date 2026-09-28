// Portado de DanielOpazoD/vexus-sim @ 59fb7b18e9c1 — src/doppler/measureMca.ts (MIT).
// Adaptación local: neurosono-sim. Ver docs/PROVENANCE.md.
// LIM-09: la envolvente observada conserva el sesgo diastólico conocido.
/**
 * Medición sobre el espectro ADQUIRIDO (envolvente observada), separada de la
 * verdad fisiológica. La velocidad rotulada depende de la corrección angular
 * que puso el operador; TAMax se integra sobre los intervalos finitos de la
 * envolvente observada — no es la aproximación (PSV+2·EDV)/3.
 *
 * Índices: PI de Gosling = (PSV − EDV)/MFV ; IR = (PSV − EDV)/PSV.
 */
import { velocityFromShiftMmS, mmsToCms } from '../core/units';
import { DOPPLER } from './params';
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
 * 5 puntos (≈ un equipo real). Las columnas sin detección son `NaN` y no se
 * convierten en velocidad cero.
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
    const fSigned = !b.detected ? Number.NaN : b.ePos >= b.eNeg ? b.posHz : -b.negHz;
    const vMm = Number.isFinite(fSigned)
      ? velocityFromShiftMmS(fSigned, opts.f0Hz, opts.angleCorrectionRad)
      : Number.NaN;
    const v = (Number.isFinite(vMm) ? mmsToCms(vMm) : Number.NaN) * (opts.invert ? -1 : 1);
    raw.push({ t: col.t, vCms: v });
  }
  // mediana temporal de 5 puntos
  return raw.map((p, i) => {
    const win: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) {
      const v = raw[j]!.vCms;
      if (Number.isFinite(v)) win.push(v);
    }
    if (win.length < 3) return { t: p.t, vCms: Number.NaN };
    win.sort((a, b) => a - b);
    return { t: p.t, vCms: win[win.length >> 1]! };
  });
}

/**
 * Medidas por latido sobre la traza observada. `beats` son ventanas
 * {tStart, rr} del reloj cardíaco (mismo reloj de simulación). El EDV es el
 * percentil 10 de la magnitud finita dentro del latido: emula el trazado de
 * fin de diástole de un equipo frente a dropouts de una sola columna. TAMax
 * integra únicamente entre puntos finitos consecutivos.
 */
export function measureBeats(
  trace: readonly SpectralTracePoint[],
  beats: readonly { tStart: number; rr: number }[],
): BeatMeasure[] {
  const out: BeatMeasure[] = [];
  for (const b of beats) {
    const allPts = trace.filter((p) => p.t >= b.tStart && p.t < b.tStart + b.rr);
    const pts = allPts.filter((p) => Number.isFinite(p.vCms));
    if (pts.length < 6) continue;
    const sign = pts.reduce((a, p) => a + p.vCms, 0) >= 0 ? 1 : -1;
    let psv = -Infinity;
    const magnitudes: number[] = [];
    let integ = 0;
    let coveredS = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const v = Math.abs(p.vCms);
      if (v > psv) psv = v;
      magnitudes.push(v);
    }
    for (let i = 1; i < allPts.length; i++) {
      const previous = allPts[i - 1]!;
      const p = allPts[i]!;
      if (!Number.isFinite(previous.vCms) || !Number.isFinite(p.vCms)) continue;
      const dt = p.t - previous.t;
      if (dt >= 0) {
        integ += (Math.abs(previous.vCms) + Math.abs(p.vCms)) * 0.5 * dt;
        coveredS += dt;
      }
    }
    magnitudes.sort((a, b) => a - b);
    const rank = 0.1 * (magnitudes.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    const fraction = rank - lower;
    const edv = magnitudes[lower]! + (magnitudes[upper]! - magnitudes[lower]!) * fraction;
    if (
      !Number.isFinite(psv) ||
      !Number.isFinite(edv) ||
      coveredS < DOPPLER.params.beatCoverageMin.value * b.rr
    ) {
      continue;
    }
    const taMax = integ / coveredS;
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
  const psvCms = med(ms.map((m) => m.psvCms));
  const edvCms = med(ms.map((m) => m.edvCms));
  const taMaxCms = med(ms.map((m) => m.taMaxCms));
  return {
    psvCms,
    edvCms,
    taMaxCms,
    pi: Math.abs(psvCms - edvCms) / Math.max(1e-6, Math.abs(taMaxCms)),
    ri: Math.abs(psvCms - edvCms) / Math.max(1e-6, Math.abs(psvCms)),
    beats: ms.length,
  };
}

/**
 * Índice de Lindegaard: TAMax de la ACM / TAMax de la ACI extracraneal.
 * Valores ≥3 sugieren vasoespasmo frente a hiperemia (lindegaard-indice-1989).
 * La ACI no se insona en este simulador: el denominador viene del caso (LIM-02).
 */
export function lindegaardRatio(tamaxMcaCms: number, icaCms: number): number {
  return Math.abs(tamaxMcaCms) / Math.max(1e-6, icaCms);
}
