/**
 * Exportación de la sesión: construye el JSON y dispara las descargas.
 * El acceso al canvas se recibe como callback desde la UI.
 */
import type { ReferenceCase } from '../domain/referenceCase';
import type { AppState } from './state';

export function exportPayload(sim: ReferenceCase, s: AppState): object {
  return {
    case: sim.patient.label,
    seed: sim.patient.seed,
    measurements: s.measurements,
    settings: s.settings,
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
