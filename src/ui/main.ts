/**
 * Composición de la aplicación: crea caso, estado, controladores y DOM.
 * La adquisición, el PW, el cine y las mediciones viven en la capa app.
 */
import { SimulationClock } from '../core/clock';
import { errors, logError, onError } from '../core/errorLog';
import { buildReferenceCase } from '../domain/referenceCase';
import type {
  AcquisitionSettings,
  BasalPhysiology,
  LineDensity,
  Side,
  Station,
  WillisVariant,
} from '../domain/contracts';
import { defaultEyeSettings, defaultTemporalSettings } from '../domain/settings';
import { drawBMode, drawColorOverlay } from './canvasDraw';
import { createInitialState } from '../app/state';
import { PwController } from '../app/pwController';
import { addCaliperPoint, canvasToImagePoint } from '../app/measurements';
import { nextCine, pushCine } from '../app/cine';
import { exportOnsdReport, exportSession } from '../app/exporter';
import {
  RenderClient,
  SupersededRenderRequest,
  SyncRenderClient,
  type RenderClientLike,
} from '../app/renderClient';
import type { RenderResponse } from '../app/renderRequest';
import { drawCaliperMarks, drawGateMarker, drawScale, drawSpectral, updateReadouts } from './overlays';
import { acousticOutput } from '../ultrasound/acousticOutput';
import { buildReport, createOnsdProtocolState, nextSlot } from '../domain/onsdProtocol';

const WILLIS_VARIANTS: readonly WillisVariant[] = [
  'normal',
  'aplasiaA1Der',
  'aplasiaA1Izq',
  'pcaFetalDer',
  'pcaFetalIzq',
];
const requestedWillis = new URLSearchParams(window.location.search).get('willis');
const willisVariant: WillisVariant = WILLIS_VARIANTS.includes(requestedWillis as WillisVariant)
  ? (requestedWillis as WillisVariant)
  : 'normal';
const sim = buildReferenceCase(undefined, willisVariant);
const clock = new SimulationClock();
const s = createInitialState();
const pw = new PwController(sim, s);
const urlParams = new URLSearchParams(window.location.search);
const scenarioValue = (key: 'map' | 'paco2' | 'icp', fallback: number, lo: number, hi: number): number => {
  const raw = urlParams.get(key);
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
};
const initialPhysiology: BasalPhysiology = {
  ...sim.patient.physiology,
  mapMmHg: scenarioValue('map', sim.patient.physiology.mapMmHg, 40, 140),
  paco2MmHg: scenarioValue('paco2', sim.patient.physiology.paco2MmHg, 20, 80),
  icpMmHg: scenarioValue('icp', sim.patient.physiology.icpMmHg, 0, 60),
};
sim.setPhysiology(initialPhysiology);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bmodeCv = $<HTMLCanvasElement>('bmode');
const spectralCv = $<HTMLCanvasElement>('spectral');
const pospad = $<HTMLCanvasElement>('pospad');
const errorBadge = $<HTMLButtonElement>('errores');
const bCtx = bmodeCv.getContext('2d')!;
const renderer = createRenderClient();
let lastRender = 0;
let lastT = performance.now();
let renderInFlight = false;
let renderId = 0;

function createRenderClient(): RenderClientLike {
  if (typeof Worker === 'undefined') return new SyncRenderClient();
  try {
    return new RenderClient(new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' }));
  } catch (error) {
    logError('worker', error);
    return new SyncRenderClient();
  }
}

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

function setLineDensity(value: LineDensity): void {
  s.settings = { ...s.settings, lineDensity: value };
}

function setTiltPreset(value: number): void {
  if (s.station !== 'temporal') return;
  s.tiltDeg = value;
  ($('tilt') as HTMLInputElement).value = String(value);
  $('tiltV').textContent = `${value}°`;
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
    outputPower: s.settings.outputPowerDb,
  };
  for (const [id, value] of Object.entries(values)) $<HTMLInputElement>(id).value = String(value);
  for (const id of Object.keys(values)) {
    $<HTMLInputElement>(id).dispatchEvent(new Event('input'));
  }
  ($('densidad') as HTMLSelectElement).value = s.settings.lineDensity;
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

function drawFrame(response: RenderResponse): void {
  const { frame, bmode, scan, color } = response;
  drawBMode(bCtx, bmode, { dynamicRangeDb: frame.settings.dynamicRangeDb });
  if (frame.station === 'temporal' && color) {
    drawColorOverlay(
      bCtx,
      color.vel,
      color.pow,
      color.w,
      color.h,
      scan,
      frame.settings.depthMm,
      frame.settings.prfHz,
      frame.settings.frequencyMhz,
    );
    if (s.pwOn) drawGateMarker(bCtx, sim, s, scan);
  }
  drawCaliperMarks(bCtx, s);
  drawScale(bCtx, sim, s, s.currentFrame);
}

function syncProtocolControls(): void {
  const rot = $('rot') as HTMLInputElement;
  if (rot.value !== String(s.rotDeg)) {
    rot.value = String(s.rotDeg);
    rot.dispatchEvent(new Event('input'));
  }
  $('rotV').textContent = `${s.rotDeg}°`;
  $('dte').classList.toggle('on', s.caliperMode === 'dte');
  $('dvno').classList.toggle('on', s.caliperMode === 'dvno');
  document.querySelectorAll('.tab').forEach((el) => {
    const t = el as HTMLElement;
    t.classList.toggle('on', t.dataset.station === s.station && t.dataset.side === s.side);
  });
  const slot = nextSlot(s.onsd);
  $('hint').textContent =
    s.onsdActive && s.station === 'ojo'
      ? s.caliperMode === 'dte'
        ? `Protocolo DVNO: mide DTE ${s.side} con dos puntos retina a retina.`
        : slot
          ? `Protocolo DVNO: ${slot.side} · ${slot.plane}. Ajusta rotación y marca la vaina a 3 mm.`
          : 'Protocolo DVNO completo: 4 DVNO + 2 DTE registrados.'
      : $('hint').textContent;
}

function updateOnsdReport(): void {
  const report = buildReport(s.onsd);
  const panel = $('onsdReport');
  const value = (side: Side, plane: 'transversal' | 'sagital') =>
    s.onsd.dvno[`${side}-${plane}`]?.value.toFixed(2) ?? '—';
  const sideRow = (side: Side) => {
    const item = report.perSide[side];
    return `<tr><th>${side}</th><td>${value(side, 'transversal')}</td><td>${value(side, 'sagital')}</td><td>${item.dteMm?.toFixed(2) ?? '—'}</td><td>${item.ratio?.toFixed(2) ?? '—'}</td></tr>`;
  };
  panel.innerHTML = [
    '<table><thead><tr><th>Lado</th><th>Transversal</th><th>Sagital</th><th>DTE</th><th>Ratio</th></tr></thead>',
    `<tbody>${sideRow('der')}${sideRow('izq')}</tbody></table>`,
    `<div>Media bilateral: ${report.bilateralMeanMm?.toFixed(2) ?? '—'} mm · Asimetría: ${report.asymmetryMm?.toFixed(2) ?? '—'} mm</div>`,
    `<div>Flags: ${report.flags.length ? report.flags.join(', ') : 'ninguno'}</div>`,
  ].join('');
}

function updateAcousticLabel(): void {
  const output = acousticOutput({
    transducer: s.settings.transducer,
    station: s.station,
    mode: s.pwOn ? 'pw' : s.station === 'temporal' ? 'color' : 'bmode',
    frequencyMhz: s.settings.frequencyMhz,
    focusMm: s.settings.focusMm,
    prfHz: s.settings.prfHz,
    gateMm: s.settings.gateMm,
    outputPowerDb: s.settings.outputPowerDb,
  });
  const el = $('acousticLabel');
  el.textContent = `MI ${output.mi.toFixed(2)}  ${output.tiKind} ${output.ti.toFixed(2)}`;
  el.classList.toggle('warn', output.ocularLimitExceeded);
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
      if (!renderInFlight) {
        renderInFlight = true;
        const requestId = ++renderId;
        const phys = sim.physStateAt(clock.t);
        renderer
          .request({
            id: requestId,
            seed: sim.patient.seed,
            willisVariant: sim.willisVariant,
            side: s.side,
            station: s.station,
            settings: { ...s.settings },
            tiltDeg: s.tiltDeg,
            offsetMm: s.offsetMm,
            rotDeg: s.rotDeg,
            press: s.press,
            t: phys.t,
            cardiacPhase: phys.cardiacPhase,
            respiratoryPhase: phys.respiratoryPhase,
            flowModulation: phys.flowModulation,
            physiology: sim.patient.physiology,
            color: s.station === 'temporal',
          })
          .then((response) => {
            renderInFlight = false;
            s.currentFrame = response.frame;
            pushCine(s, { frame: response.frame, bmode: response.bmode, scan: response.scan });
            drawFrame(response);
          })
          .catch((error) => {
            renderInFlight = false;
            if (!(error instanceof SupersededRenderRequest)) {
              logError('worker', error);
            }
          });
      }
    } else if (s.frozen && s.cinePlaying && s.cine.length) {
      drawCineFrame();
    }
    drawSpectral(spectralCv.getContext('2d')!, sim, s, pw);
    updateReadouts($('readouts'), sim, s, pw);
    syncProtocolControls();
    updateOnsdReport();
    updateAcousticLabel();
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
  ['outputPower', 'outputPowerV', (v: number) => setSetting('outputPowerDb', v), (v: number) => `${v} dB`],
  [
    'map',
    'mapV',
    (v: number) => sim.setPhysiology({ ...sim.patient.physiology, mapMmHg: v }),
    (v: number) => `${v} mmHg`,
  ],
  [
    'paco2',
    'paco2V',
    (v: number) => sim.setPhysiology({ ...sim.patient.physiology, paco2MmHg: v }),
    (v: number) => `${v} mmHg`,
  ],
  [
    'icp',
    'icpV',
    (v: number) => sim.setPhysiology({ ...sim.patient.physiology, icpMmHg: v }),
    (v: number) => `${v} mmHg`,
  ],
];
($('map') as HTMLInputElement).value = String(initialPhysiology.mapMmHg);
($('paco2') as HTMLInputElement).value = String(initialPhysiology.paco2MmHg);
($('icp') as HTMLInputElement).value = String(initialPhysiology.icpMmHg);
ranges.forEach(([id, out, apply, fmt]) => bindRange(id, out, apply, fmt));

($('densidad') as HTMLSelectElement).addEventListener('change', (event) => {
  setLineDensity((event.target as HTMLSelectElement).value as LineDensity);
});
$('planoMesencefalico').addEventListener('click', () => setTiltPreset(0));
$('planoDiencefalico').addEventListener('click', () => setTiltPreset(10));

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
  else if (e.key === 'd') $('teaching').click();
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
$('teaching').addEventListener('click', () => {
  s.teachingMode = !s.teachingMode;
  $('teaching').classList.toggle('on', s.teachingMode);
  ($('scenarioPanel') as HTMLDetailsElement).open = s.teachingMode;
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
$('dte').addEventListener('click', () => {
  s.caliperMode = s.caliperMode === 'dte' ? 'none' : 'dte';
  $('dte').classList.toggle('on', s.caliperMode === 'dte');
  $('caliper').classList.remove('on');
  $('dvno').classList.remove('on');
  s.caliperPts = [];
});
$('onsdProtocol').addEventListener('click', () => {
  if (s.station !== 'ojo') return;
  s.onsdActive = !s.onsdActive;
  s.onsdWarning = false;
  s.onsd = createOnsdProtocolState();
  s.caliperMode = s.onsdActive ? 'dvno' : 'none';
  s.side = 'der';
  s.rotDeg = 0;
  s.caliperPts = [];
  $('onsdProtocol').classList.toggle('on', s.onsdActive);
  $('dvno').classList.toggle('on', s.onsdActive);
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
$('exportOnsd').addEventListener('click', () => {
  const download = (name: string, href: string) => {
    const a = document.createElement('a');
    a.download = name;
    a.href = href;
    a.click();
  };
  exportOnsdReport(sim, s, download);
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
