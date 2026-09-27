/**
 * Exportación de la sesión: construye el JSON y dispara las descargas.
 * El acceso al canvas se recibe como callback desde la UI.
 */
import type { ReferenceCase } from '../domain/referenceCase';
import { errors } from '../core/errorLog';
import type { AppState } from './state';
import { acousticOutput } from '../ultrasound/acousticOutput';

export function exportPayload(sim: ReferenceCase, s: AppState): object {
  const mode = s.pwOn ? 'pw' : s.station === 'temporal' ? 'color' : 'bmode';
  return {
    case: sim.patient.label,
    seed: sim.patient.seed,
    willisVariant: sim.willisVariant,
    frame: s.currentFrame,
    measurements: s.measurements,
    settings: s.settings,
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
        }
      : undefined,
    errores: errors(),
  };
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
