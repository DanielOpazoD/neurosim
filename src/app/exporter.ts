/**
 * Exportación de la sesión: construye el JSON y dispara las descargas.
 * El acceso al canvas se recibe como callback desde la UI.
 */
import type { ReferenceCase } from '../domain/referenceCase';
import { errors } from '../core/errorLog';
import { imagingMode, type AppState } from './state';
import { acousticOutput } from '../ultrasound/acousticOutput';
import { buildReport } from '../domain/onsdProtocol';
import { guideById, type GuideProgress, type GuideSummary } from '../domain/guides';

export function exportPayload(sim: ReferenceCase, s: AppState): object {
  const mode = imagingMode(s);
  return {
    case: sim.patient.label,
    clinicalCase: sim.clinicalCase.id,
    seed: sim.patient.seed,
    willisVariant: sim.willisVariant,
    lindegaard: (() => {
      const last = [...s.debrief.events()]
        .reverse()
        .find(
          (event) =>
            event.kind === 'freeze' &&
            typeof event.data?.lindegaard === 'number' &&
            Number.isFinite(event.data.lindegaard as number),
        );
      return last ? (last.data!.lindegaard as number) : undefined;
    })(),
    frame: s.currentFrame,
    measurements: s.measurements,
    onsdReport: buildReport(s.onsd),
    settings: s.settings,
    colorOn: s.colorOn,
    probe: {
      offsetMm: s.offsetMm,
      offsetVMm: s.offsetVMm,
      tiltDeg: s.tiltDeg,
      tiltVDeg: s.tiltVDeg,
      rotDeg: s.rotDeg,
      press: s.press,
    },
    acousticOutput: acousticOutput({
      transducer: s.settings.transducer,
      station: s.station,
      mode,
      frequencyMhz: s.settings.frequencyMhz,
      focusMm: s.settings.focusMm,
      prfHz: s.settings.prfHz,
      gateMm: s.settings.gateMm,
      outputPowerDb: s.settings.outputPowerDb,
    }),
    instructor: s.teachingMode
      ? {
          mapMmHg: sim.patient.physiology.mapMmHg,
          paco2MmHg: sim.patient.physiology.paco2MmHg,
          icpMmHg: sim.patient.physiology.icpMmHg,
          hemodynamics: sim.physStateAt(0).hemo,
          truths: {
            thirdVentricleWidthMm: sim.truths.thirdVentricleWidthMm,
            midlineShiftMm: sim.truths.midlineShiftMm,
          },
        }
      : undefined,
    errores: errors(),
  };
}

export function exportOnsdReport(
  sim: ReferenceCase,
  s: AppState,
  download: (name: string, href: string, type?: string) => void,
): void {
  const data = JSON.stringify(
    { case: sim.patient.label, seed: sim.patient.seed, onsdReport: buildReport(s.onsd) },
    null,
    2,
  );
  download(
    `neurosono-onsd-informe-${Date.now()}.json`,
    URL.createObjectURL(new Blob([data], { type: 'application/json' })),
    'application/json',
  );
}

/**
 * Informe del examen guiado (DEC-56): resumen, tiempos por paso y, para la
 * vaina, el informe del protocolo DVNO; incluye la sesión (`exportPayload`).
 */
export function guideReportPayload(
  sim: ReferenceCase,
  s: AppState,
  progress: GuideProgress,
  summary: GuideSummary,
): object {
  const guide = guideById(progress.guideId);
  return {
    guide: {
      id: guide.id,
      exam: guide.exam,
      title: guide.title,
      steps: guide.steps.map((step) => ({
        id: step.id,
        title: step.title,
        durationS: progress.records[step.id] ? progress.records[step.id]!.durationMs / 1000 : null,
        manual: progress.records[step.id]?.manual ?? null,
        capture: progress.captures[step.id] ?? null,
      })),
      summary,
    },
    ...(guide.exam === 'vaina' ? { onsdReport: buildReport(s.onsd) } : {}),
    session: exportPayload(sim, s),
  };
}

export function exportGuideReport(
  sim: ReferenceCase,
  s: AppState,
  progress: GuideProgress,
  summary: GuideSummary,
  download: (name: string, href: string, type?: string) => void,
): void {
  const data = JSON.stringify(guideReportPayload(sim, s, progress, summary), null, 2);
  download(
    `neurosono-guia-${progress.guideId}-${Date.now()}.json`,
    URL.createObjectURL(new Blob([data], { type: 'application/json' })),
    'application/json',
  );
}

export function exportSession(
  sim: ReferenceCase,
  s: AppState,
  canvasPng: () => string,
  download: (name: string, href: string, type?: string) => void,
): void {
  download(`neurosono-${s.station}-${s.side}-${Date.now()}.png`, canvasPng());
  const data = JSON.stringify(exportPayload(sim, s), null, 2);
  download(
    `neurosono-medidas-${Date.now()}.json`,
    URL.createObjectURL(new Blob([data], { type: 'application/json' })),
  );
}
