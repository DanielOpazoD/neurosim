/**
 * Modo de examen guiado (DEC-56): guías puras paso a paso para la vaina del
 * nervio óptico y el Doppler transcraneal.
 *
 * Cada paso se comprueba sobre una instantánea plana del estado
 * (`GuideContext`, construida en la UI cada 250 ms): la guía no conoce el
 * DOM ni ejecuta física. El avance es un reductor puro (`advance`) con
 * histéresis: la comprobación debe mantenerse `GUIDE_HOLD_MS` seguidos.
 */
import type { Side, Station } from './contracts';
import { lindegaardInterpretation } from '../doppler/measureMca';
import type { OnsdKey, OnsdPlane } from './onsdProtocol';
import { DOPPLER } from '../doppler/params';

export type GuideExam = 'vaina' | 'dtc';

/** Medición tal como la ve la guía (subconjunto de `Measurement`). */
export interface GuideMeasurement {
  readonly kind: 'distancia' | 'dvno' | 'dte' | 'trazado-espectral';
  readonly value: number;
  readonly side: Side;
  /** Referencia retroglobo declarada por el caliper (típ. 3 mm). */
  readonly referenceOffsetMm?: number;
  /** Distancia retroglobo medida de los puntos del caliper (modelo), mm. */
  readonly offsetMm?: number;
  /** Rotación del marcador al medir, grados. */
  readonly rotDeg?: number;
}

/** Última medida espectral de la traza adquirida. */
export interface GuideMcaMeasure {
  readonly psvCms: number;
  readonly edvCms: number;
  readonly pi: number;
  readonly taMaxCms: number;
  readonly beats: number;
}

/** Instantánea plana del estado para evaluar los pasos. */
export interface GuideContext {
  readonly station: Station;
  readonly side: Side;
  readonly tiltDeg: number;
  readonly rotDeg: number;
  readonly offsetMm: number;
  readonly offsetVMm: number;
  readonly depthMm: number;
  readonly gainDb: number;
  readonly colorOn: boolean;
  readonly pwOn: boolean;
  readonly frozen: boolean;
  readonly gate: {
    readonly depthMm: number;
    readonly uMm: number;
    readonly dominantVesselId: string | null;
    readonly bloodFraction: number;
  };
  /** Ángulo real de insonación en la puerta, grados (null sin vaso). */
  readonly insonationRealDeg: number | null;
  readonly mca: GuideMcaMeasure | null;
  readonly measurements: readonly GuideMeasurement[];
  /** Huecos del protocolo DVNO 2×2 ya rellenos (`Ojo-plano`). */
  readonly onsdSlots: readonly OnsdKey[];
  /**
   * Posición lateral en la imagen (mm) del centro del nervio a 3 mm
   * retroglobo del ojo explorado; null fuera de la estación ocular.
   */
  readonly nerveImageUMm: number | null;
  /** TAMax de ACI medida por lado en la ventana submandibular (DEC-58), cm/s. */
  readonly icaMeasuredCms?: Readonly<Record<Side, number | null>>;
  /** Lindegaard del lado actual (temporal, puerta en M1 con medida). */
  readonly lindegaard?: GuideLindegaard | null;
}

/** Lindegaard tal como lo ve la guía. */
export interface GuideLindegaard {
  readonly side: Side;
  readonly ratio: number;
  readonly mcaTaMaxCms: number;
  readonly icaTaMaxCms: number;
  readonly icaSource: 'medida' | 'referencia';
}

export type GuideCapture = Readonly<Record<string, number | string>>;

export interface GuideStep {
  readonly id: string;
  readonly title: string;
  /** 1–2 frases cortas en español. */
  readonly instruction: string;
  readonly check: (ctx: GuideContext) => boolean;
  /** Pista que aparece tras `GUIDE_HINT_DELAY_MS` en el mismo paso. */
  readonly hint?: string;
  /** Selector CSS del control a resaltar (`.guide-target`). */
  readonly target?: string;
  /** Datos a conservar al completar el paso (p. ej. PSV de un lado). */
  readonly capture?: (ctx: GuideContext) => GuideCapture | null;
}

export interface Guide {
  readonly id: string;
  readonly exam: GuideExam;
  readonly title: string;
  readonly steps: readonly GuideStep[];
}

/** La comprobación debe mantenerse este tiempo para avanzar (ms). */
export const GUIDE_HOLD_MS = 600;
/** Tiempo en el mismo paso antes de mostrar la pista (ms). */
export const GUIDE_HINT_DELAY_MS = 20_000;
/** DVNO: referencia retroglobo y tolerancia de la guía (mm). */
export const GUIDE_ONSD_OFFSET_MM = 3;
export const GUIDE_ONSD_OFFSET_TOL_MM = 0.5;
/** Rotación mínima del marcador para el plano sagital (°). */
export const GUIDE_SAGITTAL_MIN_DEG = 80;
/** Umbral de DVNO compatible con PIC elevada (mm). */
export const GUIDE_ONSD_ABNORMAL_MM = DOPPLER.params.debriefOnsdAbnormalMm.value;
/** Error máximo frente al modelo para calificar la DVNO de precisa (mm). */
export const GUIDE_ONSD_ACCURATE_MM = 0.3;

/* ── Comprobaciones reutilizables ── */

/** La medición DVNO está a 3 ± 0,5 mm retroglobo (medida o declarada). */
export function dvnoAtReference(m: GuideMeasurement): boolean {
  if (m.kind !== 'dvno') return false;
  const offset = Number.isFinite(m.offsetMm) ? m.offsetMm! : m.referenceOffsetMm;
  return offset !== undefined && Math.abs(offset - GUIDE_ONSD_OFFSET_MM) <= GUIDE_ONSD_OFFSET_TOL_MM;
}

/** Plano de una medición DVNO de la guía por la rotación del marcador. */
export function measurementPlane(m: GuideMeasurement): OnsdPlane | null {
  if (m.rotDeg === undefined || !Number.isFinite(m.rotDeg)) return null;
  const abs = Math.abs(m.rotDeg);
  if (abs >= GUIDE_SAGITTAL_MIN_DEG) return 'sagital';
  if (abs < 45) return 'transversal';
  return null; // oblicuo: no cuenta para ningún plano
}

/** Última DVNO válida (3 mm) de un lado y plano. */
export function latestDvno(ctx: GuideContext, side: Side, plane: OnsdPlane): GuideMeasurement | null {
  for (let i = ctx.measurements.length - 1; i >= 0; i -= 1) {
    const m = ctx.measurements[i]!;
    if (m.side === side && dvnoAtReference(m) && measurementPlane(m) === plane) return m;
  }
  return null;
}

/** Hueco DVNO relleno por el protocolo o por una medición válida de la guía. */
export function slotFilled(ctx: GuideContext, side: Side, plane: OnsdPlane): boolean {
  return ctx.onsdSlots.includes(`${side}-${plane}`) || latestDvno(ctx, side, plane) !== null;
}

const inM1 = (ctx: GuideContext): boolean =>
  ctx.pwOn && (ctx.gate.dominantVesselId?.startsWith('m1-') ?? false) && ctx.gate.bloodFraction >= 0.2;

const hasMeasure = (ctx: GuideContext): boolean => ctx.mca !== null && ctx.mca.beats >= 2;

/** Puerta PW en la ACI distal (ventana submandibular) con ≥ 20 % de sangre. */
const inIca = (ctx: GuideContext): boolean =>
  ctx.station === 'submandibular' &&
  ctx.pwOn &&
  (ctx.gate.dominantVesselId?.startsWith('aci-') ?? false) &&
  ctx.gate.bloodFraction >= 0.2;

/** Ángulo de insonación máximo aceptado para la ACI submandibular, grados. */
export const GUIDE_ICA_MAX_ANGLE_DEG = 30;

const captureMca = (ctx: GuideContext): GuideCapture | null =>
  ctx.mca
    ? {
        side: ctx.side,
        vessel: ctx.gate.dominantVesselId ?? '',
        psvCms: Math.abs(ctx.mca.psvCms),
        edvCms: Math.abs(ctx.mca.edvCms),
        pi: ctx.mca.pi,
        taMaxCms: Math.abs(ctx.mca.taMaxCms),
        beats: ctx.mca.beats,
        realDeg: ctx.insonationRealDeg ?? Number.NaN,
      }
    : null;

/* ── Guías ── */

export const ONSD_GUIDE: Guide = {
  id: 'vaina',
  exam: 'vaina',
  title: 'Vaina del nervio óptico',
  steps: [
    {
      id: 'ojo-d',
      title: 'Seleccionar Ojo D',
      instruction:
        'Elige «D» en la pestaña Vaina del nervio óptico: sonda lineal sobre el párpado cerrado, con gel.',
      check: (c) => c.station === 'ojo' && c.side === 'der',
      target: '.tab[data-station="ojo"][data-side="der"]',
    },
    {
      id: 'profundidad',
      title: 'Profundidad y ganancia',
      instruction:
        'Deja la profundidad en 40–50 mm para ver el globo y el nervio detrás. Ajusta la ganancia hasta separar la vaina de la grasa.',
      check: (c) => c.station === 'ojo' && c.depthMm >= 38 && c.depthMm <= 52,
      hint: 'Profundidad está en la tarjeta Imagen. Con ganancia excesiva el borde de la vaina se engrosa.',
      target: '#depth',
    },
    {
      id: 'centrar',
      title: 'Centrar el nervio',
      instruction:
        'Desliza la sonda (barrido lateral o ←/→) hasta que el nervio óptico quede en el centro de la imagen, detrás del globo.',
      check: (c) =>
        c.station === 'ojo' &&
        Math.abs(c.offsetMm) <= 3 &&
        c.nerveImageUMm !== null &&
        Math.abs(c.nerveImageUMm) <= 4,
      hint: 'El nervio es la banda hipoecoica vertical que sale del polo posterior del globo.',
      target: '#shift',
    },
    {
      id: 'congelar',
      title: 'Congelar',
      instruction: 'Congela la imagen (Espacio) cuando la vaina se vea nítida, con bordes paralelos.',
      check: (c) => c.frozen,
      target: '#freeze',
    },
    {
      id: 'dvno-transversal',
      title: 'Medir DVNO a 3 mm',
      instruction:
        'Activa «DVNO» y marca los dos bordes internos de la vaina sobre la línea guía de 3 mm retroglobo.',
      check: (c) => c.measurements.some((m) => m.side === 'der' && dvnoAtReference(m)),
      hint: 'La línea discontinua azul marca 3 mm detrás del globo: haz clic a cada lado, en el borde del LCR.',
      target: '#dvno',
    },
    {
      id: 'dvno-sagital',
      title: 'Plano sagital',
      instruction:
        'Reanuda, gira el marcador 90° (Rotación o Q/E), vuelve a congelar y mide de nuevo la DVNO a 3 mm.',
      check: (c) => latestDvno(c, 'der', 'sagital') !== null || c.onsdSlots.includes('der-sagital'),
      hint: 'En sagital el nervio puede quedar fuera del plano: recéntralo con el barrido lateral antes de congelar.',
      target: '#rot',
    },
    {
      id: 'ojo-i',
      title: 'Repetir en Ojo I',
      instruction: 'Cambia a Ojo I y repite: DVNO a 3 mm en plano transversal (0°) y sagital (90°).',
      check: (c) => slotFilled(c, 'izq', 'transversal') && slotFilled(c, 'izq', 'sagital'),
      hint: 'Mismo orden: centrar, congelar, DVNO; luego rotar 90° y repetir.',
      target: '.tab[data-station="ojo"][data-side="izq"]',
    },
  ],
};

export const TCD_GUIDE: Guide = {
  id: 'dtc',
  exam: 'dtc',
  title: 'Doppler transcraneal',
  steps: [
    {
      id: 'temporal-d',
      title: 'Temporal D',
      instruction:
        'Elige «D» en la pestaña Doppler transcraneal: sonda sectorial 2 MHz en la ventana temporal.',
      check: (c) => c.station === 'temporal' && c.side === 'der',
      target: '.tab[data-station="temporal"][data-side="der"]',
    },
    {
      id: 'mesencefalico',
      title: 'Plano mesencefálico',
      instruction:
        'Deja la inclinación en 0 ± 3° para ver el mesencéfalo en «mariposa» en el centro del sector.',
      check: (c) => c.station === 'temporal' && Math.abs(c.tiltDeg) <= 3,
      hint: 'El chip «Plano mesencefálico» de la tarjeta Sonda pone la inclinación a 0°.',
      target: '#tilt',
    },
    {
      id: 'color',
      title: 'Color y M1',
      instruction:
        'Activa el Doppler color (F) y localiza la M1: flujo rojo, hacia la sonda, por delante del mesencéfalo.',
      check: (c) => c.station === 'temporal' && c.colorOn,
      target: '#color',
    },
    {
      id: 'puerta-m1',
      title: 'Puerta PW en M1',
      instruction: 'Activa PW (P) y haz clic sobre la M1 en color para colocar la puerta dentro del vaso.',
      check: (c) => c.station === 'temporal' && inM1(c),
      hint: 'La M1 ipsilateral está a unos 45–65 mm; la puerta debe quedar sobre el rojo, no sobre el tejido.',
      target: '#pw',
    },
    {
      id: 'angulo',
      title: 'Optimizar el ángulo',
      instruction:
        'Lleva la puerta al tramo de M1 más alineado con el haz o angula la sonda hasta un ángulo real de insonación ≤ 30°.',
      check: (c) => c.pwOn && c.insonationRealDeg !== null && c.insonationRealDeg <= 30,
      hint: 'La M1 proximal (más profunda, 55–65 mm) sigue mejor el haz. El modo Docente muestra el ángulo real en Medidas.',
      target: '#angul',
    },
    {
      id: 'medir-der',
      title: 'PSV, EDV e IP',
      instruction:
        'Mantén la puerta en M1 hasta que el espectro muestre al menos dos latidos: lee PSV, EDV e IP.',
      check: (c) => c.station === 'temporal' && c.side === 'der' && inM1(c) && hasMeasure(c),
      capture: captureMca,
      target: '#readouts',
    },
    {
      id: 'temporal-i',
      title: 'Repetir en Temporal I',
      instruction: 'Cambia a Temporal I y repite: color, puerta en la M1 y al menos dos latidos medidos.',
      check: (c) => c.station === 'temporal' && c.side === 'izq' && inM1(c) && hasMeasure(c),
      capture: captureMca,
      hint: 'Al cambiar de lado el PW y el color se apagan: vuelve a activarlos.',
      target: '.tab[data-station="temporal"][data-side="izq"]',
    },
    {
      id: 'submandibular-aci',
      title: 'Ventana submandibular: ACI distal (opcional)',
      instruction:
        'Cambia a Ventana: Submandibular y pon la puerta PW en la ACI distal (flujo alejándose, 30–55 mm) con ángulo ≤ 30°. Mantén al menos dos latidos: su TAMax es el denominador del Lindegaard.',
      check: (c) =>
        inIca(c) &&
        hasMeasure(c) &&
        c.insonationRealDeg !== null &&
        c.insonationRealDeg <= GUIDE_ICA_MAX_ANGLE_DEG,
      capture: (c) =>
        c.mca
          ? {
              side: c.side,
              vessel: c.gate.dominantVesselId ?? '',
              icaTaMaxCms: Math.abs(c.mca.taMaxCms),
              psvCms: Math.abs(c.mca.psvCms),
              edvCms: Math.abs(c.mca.edvCms),
              realDeg: c.insonationRealDeg ?? Number.NaN,
            }
          : null,
      hint: 'La ACI corre casi a lo largo del haz, lateral a la ACE (con ramas, onda de alta resistencia) y medial a la yugular (venosa, hacia la sonda).',
      target: '.win[data-window="submandibular"]',
    },
    {
      id: 'lindegaard',
      title: 'Calcular Lindegaard (opcional)',
      instruction:
        'Vuelve a la ventana temporal del mismo lado con la puerta en la M1: Medidas muestra TAMax ACM / ACI medida.',
      check: (c) =>
        c.lindegaard !== null && c.lindegaard !== undefined && c.lindegaard.icaSource === 'medida',
      capture: (c) =>
        c.lindegaard
          ? {
              side: c.lindegaard.side,
              lindegaard: c.lindegaard.ratio,
              mcaTaMaxCms: c.lindegaard.mcaTaMaxCms,
              icaTaMaxCms: c.lindegaard.icaTaMaxCms,
              icaSource: c.lindegaard.icaSource,
            }
          : null,
      hint: 'El índice usa la ACI del MISMO lado: mide la ACI y la M1 del lado explorado.',
      target: '#readouts',
    },
  ],
};

export const GUIDES: readonly Guide[] = [ONSD_GUIDE, TCD_GUIDE];

export function guideById(id: string): Guide {
  return GUIDES.find((g) => g.id === id) ?? ONSD_GUIDE;
}

/** Guía del examen actual: ocular → vaina, temporal/submandibular → DTC. */
export function guideForStation(station: Station): Guide {
  return station === 'ojo' ? ONSD_GUIDE : TCD_GUIDE;
}

/* ── Reductor de progreso ── */

export interface GuideStepRecord {
  readonly completedAtMs: number;
  /** Tiempo activo en el paso (sin pausas), ms. */
  readonly durationMs: number;
  /** Avanzado a mano (Siguiente) sin cumplir la comprobación. */
  readonly manual: boolean;
}

export interface GuideProgress {
  readonly guideId: string;
  /** Paso actual; `steps.length` = resumen final. */
  readonly stepIndex: number;
  readonly stepStartedMs: number;
  /** Instante desde el que la comprobación del paso actual se cumple. */
  readonly passingSinceMs: number | null;
  /** Tras volver atrás, no se auto-avanza hasta que la comprobación falle una vez. */
  readonly armed: boolean;
  /** Pausado (guía cerrada u otro examen) desde este instante. */
  readonly pausedAtMs: number | null;
  readonly records: Readonly<Record<string, GuideStepRecord>>;
  readonly captures: Readonly<Record<string, GuideCapture>>;
}

export interface GuideStepEvent {
  readonly guideId: string;
  readonly stepId: string;
  readonly stepIndex: number;
  readonly durationMs: number;
  readonly manual: boolean;
}

export function startGuide(guideId: string, nowMs: number): GuideProgress {
  return {
    guideId,
    stepIndex: 0,
    stepStartedMs: nowMs,
    passingSinceMs: null,
    armed: true,
    pausedAtMs: null,
    records: {},
    captures: {},
  };
}

export function isGuideDone(state: GuideProgress): boolean {
  return state.stepIndex >= guideById(state.guideId).steps.length;
}

export function currentStep(state: GuideProgress): GuideStep | null {
  return guideById(state.guideId).steps[state.stepIndex] ?? null;
}

function complete(state: GuideProgress, nowMs: number, manual: boolean, ctx?: GuideContext): GuideProgress {
  const step = currentStep(state);
  if (!step) return state;
  const capture = ctx && step.capture ? step.capture(ctx) : null;
  return {
    ...state,
    stepIndex: state.stepIndex + 1,
    stepStartedMs: nowMs,
    passingSinceMs: null,
    armed: true,
    records: {
      ...state.records,
      [step.id]: { completedAtMs: nowMs, durationMs: Math.max(0, nowMs - state.stepStartedMs), manual },
    },
    captures: capture ? { ...state.captures, [step.id]: capture } : state.captures,
  };
}

/**
 * Evalúa el paso actual sobre `ctx`: si la comprobación se mantiene
 * `GUIDE_HOLD_MS` seguidos, el paso se completa y se pasa al siguiente.
 * Devuelve el mismo objeto si nada cambia (comparación barata en la UI).
 */
export function advance(state: GuideProgress, ctx: GuideContext, nowMs: number): GuideProgress {
  const step = currentStep(state);
  if (!step || state.pausedAtMs !== null) return state;
  let pass = false;
  try {
    pass = step.check(ctx);
  } catch {
    pass = false;
  }
  if (!pass) {
    if (state.passingSinceMs === null && state.armed) return state;
    return { ...state, passingSinceMs: null, armed: true };
  }
  if (!state.armed) return state;
  if (state.passingSinceMs === null) return { ...state, passingSinceMs: nowMs };
  if (nowMs - state.passingSinceMs < GUIDE_HOLD_MS) return state;
  return complete(state, nowMs, false, ctx);
}

/** Siguiente (manual): completa el paso actual aunque no se cumpla. */
export function nextStep(state: GuideProgress, nowMs: number, ctx?: GuideContext): GuideProgress {
  if (isGuideDone(state)) return state;
  const step = currentStep(state);
  const passes = ctx && step ? safeCheck(step, ctx) : false;
  return complete(state, nowMs, !passes, passes ? ctx : undefined);
}

function safeCheck(step: GuideStep, ctx: GuideContext): boolean {
  try {
    return step.check(ctx);
  } catch {
    return false;
  }
}

/** Anterior: vuelve un paso y lo reabre (sin auto-avance inmediato). */
export function prevStep(state: GuideProgress, nowMs: number): GuideProgress {
  if (state.stepIndex === 0) return state;
  const steps = guideById(state.guideId).steps;
  const back = Math.min(state.stepIndex, steps.length) - 1;
  const records = { ...state.records };
  delete records[steps[back]!.id];
  return { ...state, stepIndex: back, stepStartedMs: nowMs, passingSinceMs: null, armed: false, records };
}

export function resetGuide(state: GuideProgress, nowMs: number): GuideProgress {
  return startGuide(state.guideId, nowMs);
}

/** Pausa el cronómetro del paso (guía cerrada o examen distinto). */
export function pauseGuide(state: GuideProgress, nowMs: number): GuideProgress {
  if (state.pausedAtMs !== null) return state;
  return { ...state, pausedAtMs: nowMs, passingSinceMs: null };
}

/** Reanuda: el tiempo en pausa no cuenta como tiempo en el paso. */
export function resumeGuide(state: GuideProgress, nowMs: number): GuideProgress {
  if (state.pausedAtMs === null) return state;
  const gap = Math.max(0, nowMs - state.pausedAtMs);
  return { ...state, pausedAtMs: null, stepStartedMs: state.stepStartedMs + gap };
}

/** La pista del paso actual se muestra tras 20 s en él. */
export function hintVisible(state: GuideProgress, nowMs: number): boolean {
  const step = currentStep(state);
  if (!step?.hint) return false;
  const now = state.pausedAtMs ?? nowMs;
  return now - state.stepStartedMs >= GUIDE_HINT_DELAY_MS;
}

/** Pasos completados entre dos estados (para el registro del debriefing). */
export function completedSince(prev: GuideProgress, next: GuideProgress): GuideStepEvent[] {
  if (prev.guideId !== next.guideId) return [];
  const steps = guideById(next.guideId).steps;
  const events: GuideStepEvent[] = [];
  steps.forEach((step, stepIndex) => {
    const record = next.records[step.id];
    if (record && prev.records[step.id] !== record) {
      events.push({
        guideId: next.guideId,
        stepId: step.id,
        stepIndex,
        durationMs: record.durationMs,
        manual: record.manual,
      });
    }
  });
  return events;
}

/* ── Resumen final ── */

export interface GuideTruth {
  /** DVNO interna del modelo a 3 mm por lado y plano, mm. */
  readonly onsdMm: Readonly<Record<Side, Readonly<Record<OnsdPlane, number>>>>;
  /** TAMax de la ACI extracraneal del caso (Lindegaard), cm/s. */
  readonly icaTamaxCms?: number;
  readonly caseLabel?: string;
}

export interface GuideSummaryRow {
  readonly label: string;
  readonly value: string;
  readonly flag?: 'ok' | 'warn';
}

export interface GuideSummary {
  readonly guideId: string;
  readonly title: string;
  readonly rows: readonly GuideSummaryRow[];
  readonly interpretation: readonly string[];
  /** Valores numéricos para exportar. */
  readonly values: Readonly<Record<string, number | string | null>>;
}

const fmt = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits).replace('.', ',');

const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

function onsdSummary(ctx: GuideContext, truth: GuideTruth): GuideSummary {
  const rows: GuideSummaryRow[] = [];
  const measured: number[] = [];
  const truths: number[] = [];
  const perSide: Record<Side, number | null> = { der: null, izq: null };
  for (const side of ['der', 'izq'] as const) {
    const values: number[] = [];
    for (const plane of ['transversal', 'sagital'] as const) {
      const m = latestDvno(ctx, side, plane);
      if (m) {
        values.push(m.value);
        measured.push(m.value);
        truths.push(truth.onsdMm[side][plane]);
      }
    }
    perSide[side] = mean(values);
    rows.push({
      label: `DVNO ${side === 'der' ? 'Ojo D' : 'Ojo I'}`,
      value: `${fmt(perSide[side])} mm (${values.length}/2 planos)`,
    });
  }
  const bilateral = perSide.der !== null && perSide.izq !== null ? (perSide.der + perSide.izq) / 2 : null;
  const truthMean = mean(truths);
  const measuredMean = mean(measured);
  const error = measuredMean !== null && truthMean !== null ? Math.abs(measuredMean - truthMean) : null;
  const accurate = error !== null && error <= GUIDE_ONSD_ACCURATE_MM;
  rows.push({ label: 'Media bilateral', value: `${fmt(bilateral)} mm` });
  rows.push({
    label: 'Modelo (verdad)',
    value: `${fmt(truthMean)} mm`,
  });
  rows.push({
    label: 'Precisión',
    value: error === null ? '—' : `${accurate ? 'precisa' : 'imprecisa'} (error ${fmt(error)} mm)`,
    flag: error === null ? undefined : accurate ? 'ok' : 'warn',
  });
  const interpretation: string[] = [];
  const truthBilateral =
    (truth.onsdMm.der.transversal +
      truth.onsdMm.der.sagital +
      truth.onsdMm.izq.transversal +
      truth.onsdMm.izq.sagital) /
    4;
  const cutoff = fmt(GUIDE_ONSD_ABNORMAL_MM, 1);
  if (bilateral === null) {
    interpretation.push('Faltan mediciones de algún ojo: la media bilateral no es interpretable.');
  } else if (bilateral > GUIDE_ONSD_ABNORMAL_MM) {
    interpretation.push(
      `DVNO media ${fmt(bilateral)} mm > ${cutoff} mm: compatible con PIC elevada. Es un signo indirecto, no diagnóstico: correlacionar con la clínica y otras pruebas.`,
    );
  } else {
    interpretation.push(
      `DVNO media ${fmt(bilateral)} mm ≤ ${cutoff} mm: dentro del rango habitual; no sugiere PIC elevada (no la descarta).`,
    );
  }
  if (bilateral !== null && truthBilateral > GUIDE_ONSD_ABNORMAL_MM !== bilateral > GUIDE_ONSD_ABNORMAL_MM) {
    interpretation.push(
      `En este caso${truth.caseLabel ? ` (${truth.caseLabel})` : ''} la vaina del modelo mide ${fmt(truthBilateral)} mm: tu medición cambia la conclusión, revisa los bordes y la referencia de 3 mm.`,
    );
  }
  if (!accurate && error !== null) {
    interpretation.push(
      'Error > 0,3 mm: mide borde interno a borde interno, perpendicular al eje del nervio.',
    );
  }
  return {
    guideId: ONSD_GUIDE.id,
    title: ONSD_GUIDE.title,
    rows,
    interpretation,
    values: {
      dvnoDerMm: perSide.der,
      dvnoIzqMm: perSide.izq,
      dvnoBilateralMm: bilateral,
      dvnoModeloMm: truthMean,
      errorMm: error,
    },
  };
}

function tcdSummary(progress: GuideProgress, truth: GuideTruth): GuideSummary {
  const der = progress.captures['medir-der'];
  const izq = progress.captures['temporal-i'];
  const num = (c: GuideCapture | undefined, key: string): number | null =>
    c && typeof c[key] === 'number' && Number.isFinite(c[key] as number) ? (c[key] as number) : null;
  const rows: GuideSummaryRow[] = [];
  const interpretation: string[] = [];
  for (const [label, c] of [
    ['M1 D', der],
    ['M1 I', izq],
  ] as const) {
    rows.push({
      label,
      value: c
        ? `PSV ${fmt(num(c, 'psvCms'), 0)} · EDV ${fmt(num(c, 'edvCms'), 0)} cm/s · IP ${fmt(num(c, 'pi'))}`
        : '—',
    });
  }
  const psvD = num(der, 'psvCms');
  const psvI = num(izq, 'psvCms');
  const asym =
    psvD !== null && psvI !== null && Math.max(psvD, psvI) > 0
      ? Math.abs(psvD - psvI) / Math.max(psvD, psvI)
      : null;
  rows.push({
    label: 'Asimetría PSV',
    value: asym === null ? '—' : `${fmt(asym * 100, 0)} %`,
    flag: asym === null ? undefined : asym > 0.3 ? 'warn' : 'ok',
  });
  if (asym !== null) {
    interpretation.push(
      asym > 0.3
        ? `Asimetría lado a lado ${fmt(asym * 100, 0)} % > 30 %: significativa (estenosis, vasoespasmo o hiperemia de un lado; descartar mal ángulo).`
        : `Asimetría lado a lado ${fmt(asym * 100, 0)} % ≤ 30 %: simétrica.`,
    );
  }
  const piText = (side: string, pi: number | null): string | null => {
    if (pi === null) return null;
    if (pi > 1.2)
      return `IP ${side} ${fmt(pi)} > 1,2: elevado (resistencia distal alta; p. ej. PIC elevada o hipocapnia).`;
    if (pi > 1.1) return `IP ${side} ${fmt(pi)}: límite alto (normal 0,6–1,1).`;
    if (pi < 0.6)
      return `IP ${side} ${fmt(pi)} < 0,6: bajo (vasodilatación distal, estenosis proximal o hipercapnia).`;
    return `IP ${side} ${fmt(pi)}: normal (0,6–1,1).`;
  };
  for (const text of [piText('D', num(der, 'pi')), piText('I', num(izq, 'pi'))])
    if (text) interpretation.push(text);
  const values: Record<string, number | string | null> = {
    psvDerCms: psvD,
    psvIzqCms: psvI,
    piDer: num(der, 'pi'),
    piIzq: num(izq, 'pi'),
    asimetriaPsv: asym,
  };
  // Lindegaard (DEC-58): con la ACI medida del mismo lado (paso submandibular
  // o paso «Calcular Lindegaard») si existe; si no, con la de referencia.
  const icaCapture = progress.captures['submandibular-aci'];
  const liCapture = progress.captures['lindegaard'];
  const measuredIca = (side: Side): number | null => {
    if (liCapture && liCapture.side === side && liCapture.icaSource === 'medida') {
      return num(liCapture, 'icaTaMaxCms');
    }
    return icaCapture && icaCapture.side === side ? num(icaCapture, 'icaTaMaxCms') : null;
  };
  for (const [label, side, c] of [
    ['D', 'der', der],
    ['I', 'izq', izq],
  ] as const) {
    const fromStep = liCapture && liCapture.side === side ? num(liCapture, 'mcaTaMaxCms') : null;
    const ta = num(c, 'taMaxCms') ?? fromStep;
    const ica = measuredIca(side);
    const reference = truth.icaTamaxCms && truth.icaTamaxCms > 0 ? truth.icaTamaxCms : null;
    const denominator = ica ?? reference;
    if (ta === null || denominator === null) continue;
    const li = ta / denominator;
    const source = ica !== null ? 'ACI medida' : 'ACI de referencia';
    values[`lindegaard${label}`] = li;
    values[`lindegaard${label}Fuente`] = ica !== null ? 'medida' : 'referencia';
    if (ica !== null) values[`aci${label}TaMaxCms`] = ica;
    rows.push({
      label: `Lindegaard ${label}`,
      value: `${fmt(li, 1)} (${source})`,
      flag: li >= 3 ? 'warn' : 'ok',
    });
    const meaning = lindegaardInterpretation(li);
    interpretation.push(
      li >= 3
        ? `Lindegaard ${label} ${fmt(li, 1)} ≥ 3 (${source}): ${meaning}; velocidad alta por vasoespasmo más que por hiperemia.`
        : `Lindegaard ${label} ${fmt(li, 1)} < 3 (${source}): ${meaning}, sin patrón de vasoespasmo${ta > 120 ? ' (velocidad alta → hiperemia)' : ''}.`,
    );
  }
  if (!der || !izq) interpretation.push('Falta la medida de algún lado: completa ambos M1 para comparar.');
  return { guideId: TCD_GUIDE.id, title: TCD_GUIDE.title, rows, interpretation, values };
}

/** Resumen final del examen guiado (media DVNO vs modelo; asimetría/IP en DTC). */
export function guideSummary(progress: GuideProgress, ctx: GuideContext, truth: GuideTruth): GuideSummary {
  return progress.guideId === TCD_GUIDE.id ? tcdSummary(progress, truth) : onsdSummary(ctx, truth);
}
