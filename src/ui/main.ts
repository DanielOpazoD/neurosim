/**
 * Composición de la aplicación: crea caso, estado, controladores y DOM.
 * La adquisición, el PW, el cine y las mediciones viven en la capa app.
 */
import { SimulationClock } from '../core/clock';
import { errors, logError, onError } from '../core/errorLog';
import { buildReferenceCase } from '../domain/referenceCase';
import type { AcquisitionSettings, Side, Station } from '../domain/contracts';
import { defaultEyeSettings, defaultTemporalSettings } from '../domain/settings';
import { drawBMode, drawColorOverlay } from './canvasDraw';
import { renderColorDoppler } from '../doppler/color';
import { acquire } from '../app/acquisition';
import { currentPose } from '../app/poses';
import { createInitialState } from '../app/state';
import { PwController } from '../app/pwController';
import { addCaliperPoint, canvasToImagePoint } from '../app/measurements';
import { nextCine, pushCine } from '../app/cine';
import { exportSession } from '../app/exporter';
import { drawCaliperMarks, drawGateMarker, drawScale, drawSpectral, updateReadouts } from './overlays';

const sim = buildReferenceCase();
const clock = new SimulationClock();
const s = createInitialState();
const pw = new PwController(sim, s);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bmodeCv = $<HTMLCanvasElement>('bmode');
const spectralCv = $<HTMLCanvasElement>('spectral');
const pospad = $<HTMLCanvasElement>('pospad');
const errorBadge = $<HTMLButtonElement>('errores');
const bCtx = bmodeCv.getContext('2d')!;
let lastRender = 0;
let lastT = performance.now();

function updateErrorBadge(): void {
  const count = errors().length;
  errorBadge.hidden = count === 0;
  errorBadge.textContent = `Errores (${count})`;
}

onError(updateErrorBadge);
errorBadge.addEventListener('click', () => {
  console.error('Errores registrados', errors().slice(-20));
});
updateErrorBadge();
window.addEventListener('error', (event) => {
  const error = event as ErrorEvent;
  logError('window', error.error ?? error.message, {
    filename: error.filename,
    lineno: error.lineno,
    colno: error.colno,
  });
});
window.addEventListener('unhandledrejection', (event) => logError('window', event.reason));

function bindRange(id: string, out: string, apply: (v: number) => void, fmt: (v: number) => string): void {
  const input = $<HTMLInputElement>(id);
  const label = $(out);
  const update = () => {
    const v = parseFloat(input.value);
    label.textContent = fmt(v);
    apply(v);
  };
  input.addEventListener('input', update);
  update();
}

function setSetting<K extends keyof AcquisitionSettings>(key: K, value: number): void {
  s.settings = { ...s.settings, [key]: value };
}

function setStation(station: Station, side: Side): void {
  s.station = station;
  s.side = side;
  s.settings = station === 'ojo' ? defaultEyeSettings() : defaultTemporalSettings();
  const values = {
    depth: s.settings.depthMm,
    gain: s.settings.gainDb,
    focus: s.settings.focusMm,
    dr: s.settings.dynamicRangeDb,
    prf: s.settings.prfHz,
    gate: s.settings.gateMm,
    wf: s.settings.wallFilterHz,
    ang: s.settings.angleCorrectionDeg,
    base: s.settings.baseline,
  };
  for (const [id, value] of Object.entries(values)) $<HTMLInputElement>(id).value = String(value);
  document.querySelectorAll('.tab').forEach((el) => {
    const t = el as HTMLElement;
    t.classList.toggle('on', t.dataset.station === station && t.dataset.side === side);
  });
  document
    .querySelectorAll('.pwonly')
    .forEach((e) => ((e as HTMLElement).style.opacity = station === 'temporal' ? '1' : '0.4'));
  s.pwOn = false;
  $('pw').classList.remove('on');
  ($('cine') as HTMLButtonElement).disabled = true;
  s.cine.length = 0;
  s.cineIdx = 0;
  s.frozen = false;
  $('freeze').textContent = 'Congelar Esp';
  $('hint').textContent =
    station === 'ojo'
      ? 'DVNO: activa «DVNO 3 mm» y marca los dos bordes de la vaina a 3 mm retroglobo.'
      : 'PW: activa, haz clic en el B-mode para poner la puerta y ajusta PRF/filtro/ángulo.';
}

function toggleFreeze(): void {
  s.frozen = !s.frozen;
  $('freeze').textContent = s.frozen ? 'Reanudar' : 'Congelar';
  $('freeze').classList.toggle('on', s.frozen);
  ($('cine') as HTMLButtonElement).disabled = !s.frozen || s.cine.length < 2;
}

function drawFrame(
  bmode: ReturnType<typeof acquire>['bmode'],
  scan: ReturnType<typeof acquire>['scan'],
): void {
  drawBMode(bCtx, bmode, { dynamicRangeDb: s.settings.dynamicRangeDb });
  if (s.station === 'temporal') {
    const [vel, pow] = renderColorDoppler(
      sim.head,
      sim.flow,
      scan,
      currentPose(sim, s),
      s.settings,
      sim.cardiac.phaseAt(clock.t),
      64,
      64,
    );
    drawColorOverlay(
      bCtx,
      vel,
      pow,
      64,
      64,
      scan,
      s.settings.depthMm,
      s.settings.prfHz,
      s.settings.frequencyMhz,
    );
    if (s.pwOn) drawGateMarker(bCtx, sim, s, scan);
  }
  drawCaliperMarks(bCtx, s);
  drawScale(bCtx, sim, s, s.currentFrame);
}

function drawCineFrame(): void {
  const item = nextCine(s);
  if (!item) return;
  drawBMode(bCtx, item.bmode, { dynamicRangeDb: item.frame.settings.dynamicRangeDb });
  $('hint').textContent =
    `Cine ${s.cineIdx + 1}/${s.cine.length} · cuadro t=${item.frame.tSeconds.toFixed(2)} s`;
}

function frameLoop(now: number): void {
  const elapsed = Math.min(0.2, (now - lastT) / 1000);
  lastT = now;
  try {
    for (let i = 0; i < clock.requestSteps(elapsed); i++) clock.advance();
    pw.step(clock, elapsed);
    if (now - lastRender > 90 && !s.frozen) {
      lastRender = now;
      const item = acquire(sim, s, clock);
      s.currentFrame = item.frame;
      pushCine(s, item);
      drawFrame(item.bmode, item.scan);
    } else if (s.frozen && s.cinePlaying && s.cine.length) {
      drawCineFrame();
    }
    drawSpectral(spectralCv.getContext('2d')!, sim, s, pw);
    updateReadouts($('readouts'), s, pw);
  } catch (err) {
    logError('frame', err);
  }
  requestAnimationFrame(frameLoop);
}

const ranges: [string, string, (v: number) => void, (v: number) => string][] = [
  ['tilt', 'tiltV', (v: number) => (s.tiltDeg = v), (v: number) => `${v}°`],
  ['shift', 'shiftV', (v: number) => (s.offsetMm = v), (v: number) => `${v} mm`],
  ['rot', 'rotV', (v: number) => (s.rotDeg = v), (v: number) => `${v}°`],
  ['press', 'pressV', (v: number) => (s.press = v / 100), (v: number) => `${v}%`],
  ['gain', 'gainV', (v: number) => setSetting('gainDb', v), (v: number) => `${v} dB`],
  ['depth', 'depthV', (v: number) => setSetting('depthMm', v), (v: number) => `${v} mm`],
  ['focus', 'focusV', (v: number) => setSetting('focusMm', v), (v: number) => `${v} mm`],
  ['dr', 'drV', (v: number) => setSetting('dynamicRangeDb', v), (v: number) => `${v} dB`],
  ['prf', 'prfV', (v: number) => setSetting('prfHz', v), (v: number) => `${v} Hz`],
  ['gate', 'gateV', (v: number) => setSetting('gateMm', v), (v: number) => `${v} mm`],
  ['wf', 'wfV', (v: number) => setSetting('wallFilterHz', v), (v: number) => `${v} Hz`],
  ['ang', 'angV', (v: number) => setSetting('angleCorrectionDeg', v), (v: number) => `${v}°`],
  ['base', 'baseV', (v: number) => setSetting('baseline', v), (v: number) => `${Math.round(v * 100)}%`],
];
ranges.forEach(([id, out, apply, fmt]) => bindRange(id, out, apply, fmt));

document.querySelectorAll('.tab').forEach((el) =>
  el.addEventListener('click', () => {
    const t = el as HTMLElement;
    setStation(t.dataset.station as Station, t.dataset.side as Side);
  }),
);
$('freeze').addEventListener('click', toggleFreeze);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    toggleFreeze();
  } else if (e.key === 'p') $('pw').click();
  else if (e.key === 'c') $('caliper').click();
});
$('cine').addEventListener('click', () => {
  s.cinePlaying = !s.cinePlaying;
  $('cine').classList.toggle('on', s.cinePlaying);
});
$('pw').addEventListener('click', () => {
  if (s.station !== 'temporal') return;
  s.pwOn = !s.pwOn;
  $('pw').classList.toggle('on', s.pwOn);
  if (s.pwOn) pw.reset();
});
$('audio').addEventListener('click', () => {
  s.audioOn = !s.audioOn;
  pw.setAudioEnabled(s.audioOn);
  $('audio').classList.toggle('on', s.audioOn);
});
$('caliper').addEventListener('click', () => {
  s.caliperMode = s.caliperMode === 'dist' ? 'none' : 'dist';
  $('caliper').classList.toggle('on', s.caliperMode === 'dist');
  if (s.caliperMode === 'dist') $('dvno').classList.remove('on');
  s.caliperPts = [];
});
$('dvno').addEventListener('click', () => {
  s.caliperMode = s.caliperMode === 'dvno' ? 'none' : 'dvno';
  $('dvno').classList.toggle('on', s.caliperMode === 'dvno');
  if (s.caliperMode === 'dvno') $('caliper').classList.remove('on');
  s.caliperPts = [];
});
bmodeCv.addEventListener('click', (e) => {
  const r = bmodeCv.getBoundingClientRect();
  const point = canvasToImagePoint(
    ((e.clientX - r.left) / r.width) * bmodeCv.width,
    ((e.clientY - r.top) / r.height) * bmodeCv.height,
    s,
    bmodeCv.width,
    bmodeCv.height,
  );
  if (s.pwOn && s.station === 'temporal') {
    s.gateDepthMm = point.z;
    s.gateUMm = point.u;
    return;
  }
  addCaliperPoint(sim, s, point);
});
$('export').addEventListener('click', () => {
  const download = (name: string, href: string) => {
    const a = document.createElement('a');
    a.download = name;
    a.href = href;
    a.click();
  };
  exportSession(sim, s, () => bmodeCv.toDataURL('image/png'), download);
});
pospad.addEventListener('pointermove', (e) => {
  if (e.buttons !== 1) return;
  const r = pospad.getBoundingClientRect();
  s.offsetMm = ((e.clientX - r.left) / r.width - 0.5) * 36;
  s.tiltDeg = ((e.clientY - r.top) / r.height - 0.5) * 70;
  ($('shift') as HTMLInputElement).value = String(s.offsetMm);
  ($('tilt') as HTMLInputElement).value = String(s.tiltDeg);
  $('shiftV').textContent = `${s.offsetMm.toFixed(0)} mm`;
  $('tiltV').textContent = `${s.tiltDeg.toFixed(0)}°`;
});

setStation('ojo', 'der');
requestAnimationFrame(frameLoop);
