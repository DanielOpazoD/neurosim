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

function inferredStep(points: readonly { t: number }[]): number {
  const steps = points
    .slice(1)
    .map((p, i) => p.t - points[i]!.t)
    .filter((dt) => Number.isFinite(dt) && dt > 0)
    .sort((a, b) => a - b);
  return steps[steps.length >> 1] ?? 0;
}

function connected(
  a: { t: number; stepS?: number },
  b: { t: number; stepS?: number },
  fallback: number,
): boolean {
  const step = (p: { stepS?: number }) =>
    p.stepS && Number.isFinite(p.stepS) && p.stepS > 0 ? p.stepS : fallback;
  const dt = b.t - a.t;
  return dt > 0 && dt <= Math.max(step(a), step(b)) * DOPPLER.params.pwGapCadenceFactor.value + 1e-9;
}

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
  const step = inferredStep(columns);
  return columns.map((c, i) => {
    const out = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      let acc = 0;
      let cnt = 0;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= n || lin[ii]!.length !== N) continue;
        if (
          ii !== i &&
          (columns[ii]!.prfHz !== c.prfHz ||
            !connected(columns[Math.min(i, ii)]!, columns[Math.max(i, ii)]!, step))
        )
          continue;
        for (let dk = -1; dk <= 1; dk++) {
          const kk = k + dk;
          if (kk < 0 || kk >= N) continue;
          acc += lin[ii]![kk]!;
          cnt++;
        }
      }
      out[k] = 10 * Math.log10(acc / cnt);
    }
    return { ...c, powerDb: out };
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
  /** Envolventes con signo de pantalla; NaN si no se detectó ese semiplano. */
  positiveCms?: number;
  negativeCms?: number;
  stepS?: number;
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
  const rawFloors = captureNoiseFloorsDb(columns);
  const step = inferredStep(columns);
  const raw: SpectralTracePoint[] = [];
  for (const [i, col] of smoothed.entries()) {
    const floor = floors[i]!;
    const b = columnBandEnvelopes(col, opts.fftSize, floor, margin);
    const original = columns[i]!;
    const originalBand = columnBandEnvelopes(original, opts.fftSize, rawFloors[i]!, margin);
    const half = opts.fftSize >> 1;
    const floorLin = 10 ** (rawFloors[i]! / 10);
    const energy = (from: number, to: number) =>
      original.powerDb
        .subarray(from, to)
        .reduce((sum, db) => sum + Math.max(0, 10 ** (db / 10) - floorLin), 0);
    const ePos = energy(half + 2, opts.fftSize);
    const eNeg = energy(0, half - 1);
    const minEnergy = (ePos + eNeg) * DOPPLER.params.pwSecondaryEnergyFraction.value;
    const detected = (from: number, to: number) =>
      originalBand.detected && original.powerDb.subarray(from, to).some((db) => db >= rawFloors[i]! + margin);
    const velocity = (hz: number) => mmsToCms(velocityFromShiftMmS(hz, opts.f0Hz, opts.angleCorrectionRad));
    const pos =
      ePos >= minEnergy && detected(half + 2, opts.fftSize)
        ? velocity(b.posHz || originalBand.posHz)
        : Number.NaN;
    const neg =
      eNeg >= minEnergy && detected(0, half - 1) ? velocity(-(b.negHz || originalBand.negHz)) : Number.NaN;
    const v = ePos >= eNeg ? pos : neg;
    raw.push({
      t: col.t,
      stepS: col.stepS,
      vCms: v * (opts.invert ? -1 : 1),
      positiveCms: opts.invert ? -neg : pos,
      negativeCms: opts.invert ? -pos : neg,
    });
  }
  // mediana temporal de 5 puntos
  return raw.map((p, i) => {
    if (!Number.isFinite(p.vCms)) return p;
    const win: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) {
      let contiguous = true;
      for (let k = Math.min(i, j) + 1; k <= Math.max(i, j); k++) {
        if (!connected(raw[k - 1]!, raw[k]!, step) || !Number.isFinite(raw[k]!.vCms)) contiguous = false;
      }
      const v = raw[j]!.vCms;
      if (contiguous && Number.isFinite(v) && Math.sign(v) === Math.sign(p.vCms)) win.push(v);
    }
    if (win.length < 3) return p;
    win.sort((a, b) => a - b);
    return { ...p, vCms: win[win.length >> 1]! };
  });
}

export type PwDirection = 'positivo' | 'negativo' | 'bidireccional' | 'sin-senal';
export type PwStatus =
  'valida' | 'bidireccional' | 'sin-senal' | 'tiempo-invalido' | 'cobertura-insuficiente';

function traceStats(trace: readonly SpectralTracePoint[]) {
  const positive = trace.some(
    (p) => (Number.isFinite(p.vCms) && p.vCms > 0) || (Number.isFinite(p.positiveCms) && p.positiveCms! > 0),
  );
  const negative = trace.some(
    (p) => (Number.isFinite(p.vCms) && p.vCms < 0) || (Number.isFinite(p.negativeCms) && p.negativeCms! < 0),
  );
  const direction: PwDirection =
    positive && negative ? 'bidireccional' : positive ? 'positivo' : negative ? 'negativo' : 'sin-senal';
  const ordered = trace.every((p, i) => Number.isFinite(p.t) && (i === 0 || p.t > trace[i - 1]!.t));
  const step = inferredStep(trace);
  let coveredS = 0;
  let integral = 0;
  if (ordered)
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1]!;
      const b = trace[i]!;
      if (!Number.isFinite(a.vCms) || !Number.isFinite(b.vCms) || !connected(a, b, step)) continue;
      const dt = b.t - a.t;
      integral += (a.vCms + b.vCms) * 0.5 * dt;
      coveredS += dt;
    }
  return { direction, ordered, coveredS, integral };
}

export interface PwAssessment {
  status: PwStatus;
  direction: PwDirection;
  coverageFraction: number;
  /** Media firmada de envolvente dominante sobre tiempo cubierto; NO caudal neto. */
  signedEnvelopeMeanCms: number | null;
  summary: ReturnType<typeof summarizeBeats>;
}

export function assessPwTrace(
  trace: readonly SpectralTracePoint[],
  beats: readonly { tStart: number; rr: number }[],
): PwAssessment {
  const stats = traceStats(trace);
  const duration = (trace.at(-1)?.t ?? 0) - (trace[0]?.t ?? 0);
  const coverageFraction = duration > 0 ? stats.coveredS / duration : 0;
  const simultaneous = trace.some((p) => (p.positiveCms ?? 0) > 0 && (p.negativeCms ?? 0) < 0);
  const summary =
    stats.ordered &&
    stats.direction !== 'bidireccional' &&
    coverageFraction >= DOPPLER.params.beatCoverageMin.value
      ? summarizeBeats(measureBeats(trace, beats))
      : null;
  return {
    status: !stats.ordered
      ? 'tiempo-invalido'
      : stats.direction === 'sin-senal'
        ? 'sin-senal'
        : stats.direction === 'bidireccional'
          ? 'bidireccional'
          : summary
            ? 'valida'
            : 'cobertura-insuficiente',
    direction: stats.direction,
    coverageFraction,
    signedEnvelopeMeanCms:
      stats.coveredS > 0 && !simultaneous && Number.isFinite(stats.integral)
        ? stats.integral / stats.coveredS
        : null,
    summary,
  };
}

export function pwStatusText(status: PwStatus): string {
  switch (status) {
    case 'valida':
      return 'Envolvente unidireccional con cobertura suficiente; no confirma identidad ni exactitud clínica.';
    case 'bidireccional':
      return 'Señal en ambas direcciones: no calcular PI, IR ni Lindegaard automáticos. Revisar reversión, aliasing, mezcla o artefactos.';
    case 'sin-senal':
      return 'Sin señal cuantificable: no equivale a ausencia de flujo ni a cese circulatorio.';
    case 'tiempo-invalido':
      return 'Tiempos duplicados o desordenados: captura no interpretable.';
    case 'cobertura-insuficiente':
      return 'Cobertura temporal insuficiente: adquirir latidos completos sin interrupciones.';
  }
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
  const capture = traceStats(trace);
  if (!capture.ordered) return out;
  for (const b of beats) {
    if (!Number.isFinite(b.tStart) || !Number.isFinite(b.rr) || b.rr <= 0) continue;
    const allPts = trace.filter((p) => p.t >= b.tStart && p.t < b.tStart + b.rr);
    const pts = allPts.filter((p) => Number.isFinite(p.vCms));
    if (pts.length < 6) continue;
    const stats = traceStats(allPts);
    if (stats.direction === 'bidireccional' || stats.direction === 'sin-senal') continue;
    const sign = stats.direction === 'positivo' ? 1 : -1;
    let psv = -Infinity;
    const magnitudes: number[] = [];
    const coveredS = stats.coveredS;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const v = Math.abs(p.vCms);
      if (v > psv) psv = v;
      magnitudes.push(v);
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
    const taMax = stats.integral / coveredS;
    if (!Number.isFinite(taMax) || taMax === 0 || psv <= 0) continue;
    out.push({
      tStart: b.tStart,
      rrS: b.rr,
      psvCms: psv * sign,
      edvCms: edv * sign,
      taMaxCms: taMax,
      pi: Math.abs(psv - edv) / Math.abs(taMax),
      ri: Math.abs(psv - edv) / psv,
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
  const sign = ms[0]!.sign;
  if (
    Math.abs(sign) !== 1 ||
    ms.some(
      (m) =>
        m.sign !== sign ||
        ![m.psvCms, m.edvCms, m.taMaxCms].every(Number.isFinite) ||
        Math.sign(m.psvCms) !== sign ||
        Math.sign(m.taMaxCms) !== sign ||
        (m.edvCms !== 0 && Math.sign(m.edvCms) !== sign),
    )
  )
    return null;
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
    pi: Math.abs(psvCms - edvCms) / Math.abs(taMaxCms),
    ri: Math.abs(psvCms - edvCms) / Math.abs(psvCms),
    beats: ms.length,
  };
}

/**
 * Índice de Lindegaard: TAMax de la ACM / TAMax de la ACI extracraneal.
 * El cociente aislado no permite graduar vasoespasmo (DEC-70).
 * El denominador es la TAMax de ACI medida en la ventana submandibular
 * (DEC-58) o, si aún no se midió, la de referencia del caso (LIM-02).
 */
export function lindegaardRatio(tamaxMcaCms: number, icaCms: number): number {
  if (!Number.isFinite(tamaxMcaCms) || !Number.isFinite(icaCms) || tamaxMcaCms === 0 || icaCms === 0) {
    return Number.NaN;
  }
  const ratio = Math.abs(tamaxMcaCms) / Math.abs(icaCms);
  return Number.isFinite(ratio) ? ratio : Number.NaN;
}

/** Origen del denominador del Lindegaard. */
export type LindegaardIcaSource = 'medida' | 'referencia';

export interface LindegaardResult {
  readonly mcaTaMaxCms: number;
  readonly icaTaMaxCms: number;
  readonly ratio: number;
  readonly icaSource: LindegaardIcaSource;
}

/**
 * ACI medida del mismo lado si existe; referencia solo si falta la medida.
 * Una medida inválida no se sustituye silenciosamente por la referencia.
 */
export function lindegaardIndex(
  tamaxMcaCms: number,
  measuredIcaCms: number | null | undefined,
  referenceIcaCms: number,
): LindegaardResult {
  const measured = measuredIcaCms !== null && measuredIcaCms !== undefined;
  const ica = measured ? Math.abs(measuredIcaCms) : Math.abs(referenceIcaCms);
  return {
    mcaTaMaxCms: Math.abs(tamaxMcaCms),
    icaTaMaxCms: ica,
    ratio: lindegaardRatio(tamaxMcaCms, ica),
    icaSource: measured ? 'medida' : 'referencia',
  };
}

export type LindegaardPattern =
  'no-interpretable' | 'referencia' | 'sin-patron' | 'hiperemia' | 'discordante' | 'leve-moderado' | 'grave';

/** Rangos orientativos para ACM tras HSA; no validan adquisición ni etiología. */
export function lindegaardPattern(result: LindegaardResult): LindegaardPattern {
  const { mcaTaMaxCms: mca, icaTaMaxCms: ica } = result;
  const ratio = lindegaardRatio(mca, ica);
  if (!Number.isFinite(ratio)) return 'no-interpretable';
  if (result.icaSource === 'referencia') return 'referencia';
  const p = DOPPLER.params;
  const elevated = Math.abs(mca) >= p.lindegaardMcaElevatedCms.value;
  if (ratio < p.debriefLindegaardVasospasmMin.value) return elevated ? 'hiperemia' : 'sin-patron';
  if (!elevated) return 'discordante';
  const severeVelocity = Math.abs(mca) > p.lindegaardMcaSevereCms.value;
  const severeRatio = ratio > p.lindegaardSevereRatio.value;
  if (severeVelocity !== severeRatio) return 'discordante';
  return severeVelocity ? 'grave' : 'leve-moderado';
}

/** Lenguaje común de panel, guía, exportación y debrief, sin diagnóstico absoluto. */
export function lindegaardInterpretation(result: LindegaardResult): string {
  switch (lindegaardPattern(result)) {
    case 'no-interpretable':
      return 'No interpretable: se requieren velocidades ACM y ACI finitas y distintas de cero.';
    case 'referencia':
      return 'Cociente con ACI de referencia: no gradúa vasoespasmo; falta ACI extracraneal ipsilateral medida.';
    case 'sin-patron':
      return 'Velocidad ACM y cociente bajos: sin patrón Doppler de vasoespasmo; no lo excluye.';
    case 'hiperemia':
      return 'Velocidad ACM elevada con cociente bajo: compatible con hiperemia; requiere contexto.';
    case 'discordante':
      return 'Velocidad ACM y cociente discordantes: no graduar vasoespasmo; revisar adquisición y contexto.';
    case 'leve-moderado':
      return 'Patrón compatible con vasoespasmo leve-moderado tras HSA; no diagnóstico.';
    case 'grave':
      return 'Patrón compatible con vasoespasmo grave tras HSA; no diagnóstico.';
  }
}
