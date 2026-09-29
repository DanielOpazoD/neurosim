import { trueOnsdMm, nerveSection, toEyeLocal } from '../anatomy/eye';
import type { HemodynamicState } from '../physiology/hemodynamics';
import { DOPPLER } from '../doppler/params';
import type { ReferenceCase } from '../domain/referenceCase';
import { buildReport } from '../domain/onsdProtocol';
import type { Measurement } from '../domain/contracts';
import type { AppState } from './state';
import { GUIDES } from '../domain/guides';

export type DebriefEventKind =
  | 'station'
  | 'freeze'
  | 'measurement'
  | 'pw-on'
  | 'pw-off'
  | 'settings'
  | 'probe'
  | 'alara'
  | 'protocol'
  | 'export'
  | 'guide';

export interface DebriefEvent {
  t: number;
  kind: DebriefEventKind;
  detail: string;
  data?: Record<string, number | string | boolean>;
}

export interface DebriefFinding {
  code: string;
  severity: 'info' | 'aviso' | 'error';
  text: string;
  evidence: Record<string, number | string>;
}

export interface DebriefReport {
  startedAt: number;
  events: DebriefEvent[];
  findings: DebriefFinding[];
  measurements: {
    kind: Measurement['kind'];
    side: Measurement['side'];
    value: number;
    truth?: number;
    errorMm?: number;
    errorPct?: number;
  }[];
  /** Modo guiado (DEC-56): tiempo por paso de cada guía (último intento). */
  guide: DebriefGuideSection[];
  summary: { nEvents: number; nMeasurements: number; nFindings: number; durationS: number };
}

export interface DebriefGuideSection {
  guideId: string;
  title: string;
  steps: { stepId: string; title: string; durationS: number; manual: boolean }[];
  totalS: number;
  completed: boolean;
}

/** Tiempos por paso desde los eventos `guide`; un reinicio descarta lo previo. */
export function guideSections(events: readonly DebriefEvent[]): DebriefGuideSection[] {
  const perGuide = new Map<string, Map<string, { durationS: number; manual: boolean }>>();
  for (const event of events) {
    if (event.kind !== 'guide') continue;
    const guideId = event.data?.guideId;
    if (typeof guideId !== 'string') continue;
    if (event.data?.reset === true) {
      perGuide.set(guideId, new Map());
      continue;
    }
    const stepId = event.data?.stepId;
    const durationS = event.data?.durationS;
    if (typeof stepId !== 'string' || typeof durationS !== 'number') continue;
    const steps = perGuide.get(guideId) ?? new Map();
    steps.set(stepId, { durationS, manual: event.data?.manual === true });
    perGuide.set(guideId, steps);
  }
  const sections: DebriefGuideSection[] = [];
  for (const guide of GUIDES) {
    const recorded = perGuide.get(guide.id);
    if (!recorded || recorded.size === 0) continue;
    const steps = guide.steps
      .filter((step) => recorded.has(step.id))
      .map((step) => ({ stepId: step.id, title: step.title, ...recorded.get(step.id)! }));
    sections.push({
      guideId: guide.id,
      title: guide.title,
      steps,
      totalS: steps.reduce((sum, step) => sum + step.durationS, 0),
      completed: guide.steps.every((step) => recorded.has(step.id)),
    });
  }
  return sections;
}

export class DebriefLog {
  private readonly list: DebriefEvent[] = [];
  private currentTime: number;

  constructor(start = 0) {
    this.currentTime = start;
  }

  setTime(t: number): void {
    this.currentTime = Math.max(this.currentTime, t);
  }

  record(kind: DebriefEventKind, detail: string, data?: Record<string, number | string | boolean>): void {
    this.list.push({ t: this.currentTime, kind, detail, data });
  }

  events(): readonly DebriefEvent[] {
    return this.list;
  }
}

function eventData(event: DebriefEvent, key: string): number | string | boolean | undefined {
  return event.data?.[key];
}

function numberData(event: DebriefEvent, key: string): number | undefined {
  const value = eventData(event, key);
  return typeof value === 'number' ? value : undefined;
}

export function buildDebrief(
  log: DebriefLog,
  sim: ReferenceCase,
  s: AppState,
  hemo: HemodynamicState,
): DebriefReport {
  const events = [...log.events()];
  const findings: DebriefFinding[] = [];
  const add = (
    code: string,
    severity: DebriefFinding['severity'],
    text: string,
    evidence: Record<string, number | string>,
  ) => findings.push({ code, severity, text, evidence });

  for (const event of events) {
    const realDeg = numberData(event, 'realDeg');
    if (
      event.kind === 'measurement' &&
      realDeg !== undefined &&
      realDeg > DOPPLER.params.debriefAngleMaxDeg.value
    ) {
      const factor = 1 / Math.max(0.01, Math.cos((realDeg * Math.PI) / 180));
      add(
        'angulo-alto',
        'aviso',
        `Ángulo real ${realDeg.toFixed(1)}°: el factor 1/cosθ amplifica la velocidad.`,
        {
          thetaDeg: realDeg,
          factor,
        },
      );
    }
    const bloodFraction = numberData(event, 'bloodFraction');
    if (
      event.kind === 'freeze' &&
      bloodFraction !== undefined &&
      bloodFraction < DOPPLER.params.debriefBloodFractionMin.value
    ) {
      add(
        'puerta-fuera-de-vaso',
        'aviso',
        `La puerta contiene solo ${(bloodFraction * 100).toFixed(0)}% de sangre.`,
        {
          bloodFraction,
          threshold: DOPPLER.params.debriefBloodFractionMin.value,
        },
      );
    }
    if (event.kind === 'alara' && eventData(event, 'ocularLimitExceeded') === true) {
      add('alara-ocular', 'error', 'La salida acústica ocular supera un límite ALARA.', {
        mi: numberData(event, 'mi') ?? Number.NaN,
        ti: numberData(event, 'ti') ?? Number.NaN,
      });
    }
    if (
      event.kind === 'measurement' &&
      eventData(event, 'kind') === 'dvno' &&
      (numberData(event, 'gainDb') ?? 0) >= DOPPLER.params.debriefGainSaturationDb.value
    ) {
      add(
        'ganancia-saturada',
        'aviso',
        'La ganancia alta puede engrosar artificialmente el borde de la vaina.',
        {
          gainDb: numberData(event, 'gainDb') ?? 0,
        },
      );
    }
  }

  const measurements = s.measurements.map((measurement) => {
    if (measurement.kind !== 'dvno') {
      return { kind: measurement.kind, side: measurement.side, value: measurement.value };
    }
    const eye = sim.eyes[measurement.side];
    const truth = trueOnsdMm(eye, DOPPLER.params.debriefOffsetTargetMm.value, 'interno');
    const errorMm = Math.abs(measurement.value - truth);
    const errorPct = (errorMm / truth) * 100;
    const sValues = measurement.pointsMm.map((point) => nerveSection(eye, toEyeLocal(eye, point)).sMm);
    const offset = sValues.length
      ? sValues.reduce((sum, value) => sum + value, 0) / sValues.length
      : Number.NaN;
    if (
      Number.isFinite(offset) &&
      Math.abs(offset - DOPPLER.params.debriefOffsetTargetMm.value) >
        DOPPLER.params.debriefOffsetToleranceMm.value
    ) {
      add(
        'dvno-fuera-de-3mm',
        'aviso',
        `La medición DVNO está a ${offset.toFixed(1)} mm retroglobo, no a 3 ± 1 mm.`,
        {
          offsetMm: offset,
          targetMm: DOPPLER.params.debriefOffsetTargetMm.value,
        },
      );
    }
    if (errorMm > DOPPLER.params.debriefMeasurementErrorMm.value) {
      add(
        'dvno-error',
        'error',
        `DVNO ${measurement.value.toFixed(2)} mm frente a ${truth.toFixed(2)} mm del modelo.`,
        {
          measuredMm: measurement.value,
          truthMm: truth,
          errorMm,
        },
      );
    }
    return {
      kind: measurement.kind,
      side: measurement.side,
      value: measurement.value,
      truth,
      errorMm,
      errorPct,
    };
  });

  const protocolStarted = events.some(
    (event) => event.kind === 'protocol' && eventData(event, 'started') === true,
  );
  if (protocolStarted && !buildReport(s.onsd).complete) {
    add('protocolo-incompleto', 'aviso', 'El protocolo DVNO 2×2 + DTE quedó incompleto.', {
      complete: 0,
    });
  }
  for (const event of events) {
    if (event.kind !== 'freeze') continue;
    const pi = numberData(event, 'pi');
    if (pi !== undefined && Math.abs(pi - hemo.expectedPi) > DOPPLER.params.debriefPiTolerance.value) {
      add(
        'pi-vs-esperado',
        'info',
        `PI medido ${pi.toFixed(2)} difiere del esperado ${hemo.expectedPi.toFixed(2)}.`,
        {
          measuredPi: pi,
          expectedPi: hemo.expectedPi,
        },
      );
    }
  }
  // Hallazgos por caso clínico: Lindegaard alto en espasmo/estenosis y DVNO
  // dilatada en hipertensión intracraneal.
  const caseId = sim.clinicalCase.id;
  if (caseId === 'vasoespasmo' || caseId === 'estenosisM1') {
    const lindegaard = events
      .map((event) => numberData(event, 'lindegaard'))
      .filter((value): value is number => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), -Infinity);
    if (lindegaard >= DOPPLER.params.debriefLindegaardVasospasmMin.value) {
      add('vasoespasmo-probable', 'aviso', `Lindegaard ${lindegaard.toFixed(1)} ≥ 3: vasoespasmo probable.`, {
        lindegaard,
        threshold: DOPPLER.params.debriefLindegaardVasospasmMin.value,
      });
    }
  }
  if (caseId === 'hic') {
    const maxDvno = s.measurements
      .filter((measurement) => measurement.kind === 'dvno')
      .reduce((max, measurement) => Math.max(max, measurement.value), -Infinity);
    if (maxDvno > DOPPLER.params.debriefOnsdAbnormalMm.value) {
      add(
        'dvno-pic-elevada',
        'aviso',
        `DVNO ${maxDvno.toFixed(1)} mm > 5,8 mm: compatible con PIC elevada.`,
        {
          dvnoMm: maxDvno,
          threshold: DOPPLER.params.debriefOnsdAbnormalMm.value,
        },
      );
    }
  }
  // Mediciones en el plano diencefálico (temporal, tilt ≥ umbral): medida del
  // III ventrículo en hidrocefalia y desplazamiento (der − izq)/2 de línea media.
  const tiltMin = DOPPLER.params.debriefDiencephalicTiltDeg.value;
  const diencephalic = events.filter(
    (event) =>
      event.kind === 'measurement' &&
      eventData(event, 'kind') === 'distancia' &&
      eventData(event, 'station') === 'temporal' &&
      (numberData(event, 'tiltDeg') ?? 0) >= tiltMin,
  );
  if (caseId === 'hidrocefalia' && diencephalic.length) {
    const truth = sim.truths.thirdVentricleWidthMm;
    const last = diencephalic[diencephalic.length - 1]!;
    const value = numberData(last, 'valueMm') ?? Number.NaN;
    const tol = DOPPLER.params.debriefVentricleTolMm.value;
    if (Math.abs(value - truth) <= tol) {
      add(
        'iii-ventriculo-correcto',
        'info',
        `Medida del III ventrículo ${value.toFixed(1)} mm ≈ ${truth.toFixed(1)} mm del modelo.`,
        { measuredMm: value, truthMm: truth },
      );
    } else {
      add(
        'iii-ventriculo-sesgada',
        'aviso',
        `Medida ${value.toFixed(1)} mm frente a ${truth.toFixed(1)} mm reales: medir borde a borde del epéndimo.`,
        { measuredMm: value, truthMm: truth, errorMm: Math.abs(value - truth) },
      );
    }
  }
  if (caseId === 'desplazamientoLineaMedia') {
    const lastOf = (side: 'der' | 'izq') =>
      [...diencephalic].reverse().find((event) => eventData(event, 'side') === side);
    const der = numberData(lastOf('der') ?? ({} as DebriefEvent), 'valueMm');
    const izq = numberData(lastOf('izq') ?? ({} as DebriefEvent), 'valueMm');
    if (der !== undefined && izq !== undefined) {
      const truth = sim.truths.midlineShiftMm;
      const est = (der - izq) / 2;
      const tol = DOPPLER.params.debriefMidlineShiftTolMm.value;
      if (Math.abs(est - truth) <= tol) {
        add(
          'linea-media-correcta',
          'info',
          `Desplazamiento estimado ${est.toFixed(1)} mm ≈ ${truth.toFixed(1)} mm del modelo.`,
          { derMm: der, izqMm: izq, estMm: est, truthMm: truth },
        );
      } else {
        add(
          'linea-media-sesgada',
          'aviso',
          `Desplazamiento estimado ${est.toFixed(1)} mm frente a ${truth.toFixed(1)} mm reales: medir sonda→III ventrículo desde ambas ventanas.`,
          { derMm: der, izqMm: izq, estMm: est, truthMm: truth },
        );
      }
    }
  }
  const durationS = events.length ? events[events.length - 1]!.t - events[0]!.t : 0;
  return {
    startedAt: events[0]?.t ?? log.events()[0]?.t ?? 0,
    events,
    findings,
    measurements,
    guide: guideSections(events),
    summary: {
      nEvents: events.length,
      nMeasurements: measurements.length,
      nFindings: findings.length,
      durationS,
    },
  };
}
