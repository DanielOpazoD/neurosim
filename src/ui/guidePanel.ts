/**
 * Cajón de la guía (DEC-56): pinta el progreso, el paso actual, la lista de
 * pasos y el resumen final, y resalta el control objetivo del paso
 * (`.guide-target`). Sin estado propio salvo el elemento resaltado.
 */
import { guideById, type GuideProgress, type GuideSummary } from '../domain/guides';
import { setHtml } from './overlays';

export interface GuideView {
  readonly progress: GuideProgress;
  readonly hint: boolean;
  readonly summary: GuideSummary | null;
}

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function renderGuidePanel(view: GuideView): void {
  const guide = guideById(view.progress.guideId);
  const total = guide.steps.length;
  const index = view.progress.stepIndex;
  const done = index >= total;
  const step = guide.steps[index];
  el('guideTitle').textContent = guide.title;
  el('guideProgress').textContent = done ? `Resumen · ${total} de ${total}` : `Paso ${index + 1} de ${total}`;
  el('guideBarFill').style.width = `${(Math.min(index, total) / total) * 100}%`;
  const stepBox = el('guideStep');
  stepBox.hidden = done;
  if (step) {
    el('guideStepTitle').textContent = step.title;
    el('guideInstruction').textContent = step.instruction;
    const hint = el('guideHint');
    hint.hidden = !(view.hint && step.hint);
    hint.textContent = step.hint ? `Pista: ${step.hint}` : '';
  }
  const summaryBox = el('guideSummary');
  summaryBox.hidden = !done || !view.summary;
  if (done && view.summary) {
    setHtml(
      summaryBox,
      [
        '<h3>Resumen</h3>',
        '<div class="guideRows">',
        ...view.summary.rows.map(
          (row) =>
            `<div class="guideRow${row.flag ? ` ${row.flag}` : ''}"><span>${esc(row.label)}</span><b>${esc(row.value)}</b></div>`,
        ),
        '</div>',
        ...view.summary.interpretation.map((text) => `<p>${esc(text)}</p>`),
        '<p class="guideDisclaimer">Simulador docente: no es un dispositivo médico ni un diagnóstico.</p>',
      ].join(''),
    );
  }
  setHtml(
    el('guideChecklist'),
    guide.steps
      .map((s, i) => {
        const record = view.progress.records[s.id];
        const cls = record ? (record.manual ? 'skipped' : 'done') : i === index ? 'current' : '';
        const mark = record ? (record.manual ? '↷' : '✓') : i === index ? '›' : String(i + 1);
        const time = record ? `<small>${(record.durationMs / 1000).toFixed(0)} s</small>` : '';
        return `<li class="${cls}"><span class="mark">${mark}</span><span class="t">${esc(s.title)}</span>${time}</li>`;
      })
      .join(''),
  );
  (el('guidePrev') as HTMLButtonElement).disabled = index === 0;
  (el('guideNext') as HTMLButtonElement).disabled = done;
  el('guideExport').hidden = !done;
}

let spotlit: HTMLElement | null = null;

/** Resalta el control del paso (o nada con `null`); abre su `<details>`. */
export function setSpotlight(selector: string | null): void {
  const target = selector ? document.querySelector<HTMLElement>(selector) : null;
  // Los deslizadores se resaltan con su etiqueta (texto + valor).
  const ring = target?.closest<HTMLElement>('label.ctl') ?? target;
  if (ring === spotlit) return;
  spotlit?.classList.remove('guide-target');
  spotlit = ring ?? null;
  if (!ring) return;
  ring.classList.add('guide-target');
  for (
    let details = ring.closest('details');
    details;
    details = details.parentElement?.closest('details') ?? null
  ) {
    details.open = true;
  }
  // Solo si no se ve entero: desplazamiento mínimo (una vez por paso).
  const rect = ring.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) ring.scrollIntoView({ block: 'nearest' });
}
