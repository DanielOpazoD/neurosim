/**
 * Composición de la aplicación: crea caso, estado, controladores y DOM.
 * La adquisición, el PW, el cine y las mediciones viven en la capa app.
 */
import { SimulationClock } from '../core/clock';
import { errors, logError, onError } from '../core/errorLog';
import { buildReferenceCase } from '../domain/referenceCase';
import { CASES, caseById } from '../domain/cases';
import type {
  AcquisitionSettings,
  BasalPhysiology,
  LineDensity,
  Side,
  Station,
  WillisVariant,
} from '../domain/contracts';
import {
  defaultEyeSettings,
  defaultSubmandibularSettings,
  defaultTemporalSettings,
} from '../domain/settings';
import { isTcdStation } from '../domain/contracts';
import { drawBMode, drawColorOverlay, type ColorOverlayGrid } from './canvasDraw';
import { createInitialState, imagingMode, type AppState } from '../app/state';
import { PwController, SyncPwTransport, WorkerPwTransport, type PwTransport } from '../app/pwController';
import { addCaliperPoint, canvasToImagePoint } from '../app/measurements';
import { nextCine, pushCine } from '../app/cine';
import { exportOnsdReport, exportSession } from '../app/exporter';
import {
  RenderClient,
  RenderPool,
  SupersededRenderRequest,
  SyncRenderClient,
  type RenderClientLike,
} from '../app/renderClient';
import { type RenderResponse } from '../app/renderRequest';
import {
  drawCaliperMarks,
  drawColorBox,
  drawGateMarker,
  drawTeachingLandmarks,
  drawScale,
  drawSpectral,
  setHtml,
  updateReadouts,
} from './overlays';
import { acousticOutput } from '../ultrasound/acousticOutput';
import { buildReport, createOnsdProtocolState, nextSlot } from '../domain/onsdProtocol';
import { buildDebrief } from '../app/debrief';
import { currentPose } from '../app/poses';
import { lindegaardRatio } from '../doppler/measureMca';
// Three.js se carga aparte (DEC-56): las vistas 3D llegan tras el primer B-mode.
import type { Navigator3D } from './navigator3d';
import type { HeadView3D } from './headView3d';
import type { Measurement } from '../domain/contracts';
import {
  advance,
  completedSince,
  currentStep,
  guideById,
  guideForStation,
  guideSummary,
  hintVisible,
  isGuideDone,
  nextStep,
  pauseGuide,
  prevStep,
  resetGuide,
  resumeGuide,
  startGuide,
  type GuideContext,
  type GuideProgress,
  type GuideSummary,
} from '../domain/guides';
import {
  buildGuideContext,
  guideTruth,
  measurementRetroOffsetMm,
  type MeasurementMeta,
} from '../app/guideContext';
import { exportGuideReport } from '../app/exporter';
import { renderGuidePanel, setSpotlight } from './guidePanel';
import './styles.css';
import { isWebGL2Available } from '../render/gl/context';
import { GlBmodePipeline } from '../render/gl/glPipeline';
import { probeBeamSpec } from '../ultrasound/beam';

const WILLIS_VARIANTS: readonly WillisVariant[] = [
  'normal',
  'aplasiaA1Der',
  'aplasiaA1Izq',
  'pcaFetalDer',
  'pcaFetalIzq',
];
const urlParams = new URLSearchParams(window.location.search);
const clinicalCase = caseById(urlParams.get('caso'));
const requestedWillis = urlParams.get('willis');
const willisVariant: WillisVariant = WILLIS_VARIANTS.includes(requestedWillis as WillisVariant)
  ? (requestedWillis as WillisVariant)
  : clinicalCase.willisVariant;
const sim = buildReferenceCase(undefined, willisVariant, clinicalCase);
const clock = new SimulationClock();
const s = createInitialState();
const pwTransport = createPwTransport();
const pw = new PwController(sim, s, pwTransport);
// El worker construye su caso mientras no hay PW (primer espectro sin espera).
if (pwTransport instanceof WorkerPwTransport) pw.prewarm();
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
const navigatorCv = $<HTMLCanvasElement>('navigator');
const headViewCv = $<HTMLCanvasElement>('headView');
// Vista de cabeza: arrastrar la sonda escribe offsetMm/offsetVMm directamente.
const headViewEnabled = !new URLSearchParams(location.search).has('nohead');
// `?nohead` desactiva la vista de cabeza (aislamiento/diagnóstico).
/* Vistas 3D (Three.js) en un chunk aparte (DEC-56): los canvas existen desde
 * el principio (con un esqueleto animado) y las clases se crean tras el
 * primer B-mode pintado. Hasta entonces, `null`. */
let navigator3d: Navigator3D | null = null;
let headView: HeadView3D | null = null;
let views3dRequested = false;
function loadViews3d(): void {
  if (views3dRequested) return;
  views3dRequested = true;
  Promise.all([import('./navigator3d'), headViewEnabled ? import('./headView3d') : Promise.resolve(null)])
    .then(([navModule, headModule]) => {
      navigator3d = new navModule.Navigator3D(navigatorCv, sim);
      navigator3d.resetCamera(s.station, s.side);
      if (headModule) {
        headView = new headModule.HeadView3D(headViewCv, sim, s, (st, sd) => setStation(st, sd));
        headView.resetCamera(s.station, s.side);
      }
    })
    .catch((error) => logError('views3d', error))
    .finally(() => {
      navigatorCv.classList.remove('loading3d');
      headViewCv.classList.remove('loading3d');
    });
}
const errorBadge = $<HTMLButtonElement>('errores');
const bCtx = bmodeCv.getContext('2d')!;
const renderer = createRenderClient();
const gpuCanvas = document.createElement('canvas');
gpuCanvas.width = bmodeCv.width;
gpuCanvas.height = bmodeCv.height;
const gpuPipeline = GlBmodePipeline.create(gpuCanvas);
const gpuAvailable = gpuPipeline !== null && isWebGL2Available();
const rendererParam = new URLSearchParams(window.location.search).get('renderer');
if (gpuAvailable && rendererParam === 'gpu') s.renderer = 'gpu';
document.body.dataset.renderer = s.renderer;
const subtitle = document.querySelector<HTMLElement>('.sub');
if (subtitle) subtitle.textContent = `${clinicalCase.label} · N2`;
const casoSelect = $<HTMLSelectElement>('caso');
for (const c of CASES) {
  const option = document.createElement('option');
  option.value = c.id;
  option.textContent = c.label;
  casoSelect.appendChild(option);
}
casoSelect.value = clinicalCase.id;
casoSelect.addEventListener('change', () => {
  // Cambiar de caso recarga la página y descarta overrides de URL obsoletos.
  const next = new URLSearchParams();
  next.set('caso', casoSelect.value);
  window.location.search = next.toString();
});
$('casoInfo').innerHTML = `${clinicalCase.summary}<ul>${clinicalCase.teaching
  .map((t) => `<li>${t}</li>`)
  .join('')}</ul>`;
if (urlParams.get('clock') === 'fixed') {
  const tParam = Number(urlParams.get('t'));
  clock.freezeAt(Number.isFinite(tParam) ? tParam : 0.4);
  s.handMotion = false;
  // La persistencia GPU es una aproximación por composición alfa: el redondeo
  // de premultiplicar/despre-multiplicar aleja los píxeles de la ruta CPU más
  // que la tolerancia de paridad; en modo reloj fijo se desactiva (los
  // fotogramas son idénticos, así que la persistencia sería idempotente).
  s.persistence = 0;
}
let lastRender = 0;
let lastHeadRender = 0;
let lastT = performance.now();
let renderId = 0;
/** Último id dibujado: con varios workers una respuesta atrasada se descarta. */
let lastDrawnId = 0;
/** Tope de la canalización de render: 30 fps (DEC-54). */
const MIN_RENDER_INTERVAL_MS = 1000 / 30;
let currentScan: RenderResponse['scan'] | null = null;
let colorPersist: { vel: Float32Array; pow: Float32Array; key: string } | null = null;
let bmodePersist: { db: Float32Array; key: string } | null = null;
/** α de persistencia B-mode por nivel 0–4 (promedio exponencial en dB). */
const BMODE_PERSIST_ALPHA = [0, 0.35, 0.55, 0.7, 0.8] as const;
const GRAY_MAP_CODE = { lineal: 0, sigmoide: 1, gamma: 2 } as const;
let alaraLogged = false;
/** Refresco de paneles DOM (lecturas, protocolo, informes): 4 Hz. */
const PANEL_INTERVAL_MS = 250;
let lastPanelUpdate = -Infinity;
const forcePanels = (): void => {
  lastPanelUpdate = -Infinity;
};
const spectralCtx = spectralCv.getContext('2d')!;
const readoutsEl = $('readouts');
const onsdReportPanel = $<HTMLDetailsElement>('onsdReportPanel');
const debriefPanel = $<HTMLDetailsElement>('debriefPanel');
for (const panel of [onsdReportPanel, debriefPanel]) panel.addEventListener('toggle', forcePanels);
document.addEventListener('keydown', forcePanels, true);
document.addEventListener('click', forcePanels, true);
document.addEventListener('input', forcePanels, true);

function drawGpuBMode(
  bmode: RenderResponse['bmode'],
  scan: RenderResponse['scan'],
  settings: AcquisitionSettings,
  persistAlpha = 0,
): void {
  if (!gpuPipeline) return;
  gpuPipeline.render(bmode.iq, bmode.width, bmode.height, {
    dz: bmode.dzMm,
    scan,
    settings,
    beam: probeBeamSpec(settings.transducer, settings),
    grayMap: GRAY_MAP_CODE[s.grayMap],
  });
  // Aproximación de persistencia en GPU: el pipeline produce píxeles, no dB,
  // así que se compone el fotograma nuevo sobre el canvas previo con
  // globalAlpha = 1−α (equivalente al promedio exponencial en píxel, no en dB
  // como hace la ruta CPU; la diferencia es aceptable como presentación).
  if (persistAlpha > 0) {
    bCtx.globalAlpha = 1 - persistAlpha;
    bCtx.drawImage(gpuCanvas, 0, 0);
    bCtx.globalAlpha = 1;
  } else {
    bCtx.clearRect(0, 0, bmodeCv.width, bmodeCv.height);
    bCtx.drawImage(gpuCanvas, 0, 0);
  }
}

/** Devuelve el `db` mezclado con la persistencia temporal (presentación). */
function bmodeDbWithPersistence(
  bmode: RenderResponse['bmode'],
  frame: RenderResponse['frame'],
): Float32Array {
  const alpha = BMODE_PERSIST_ALPHA[s.persistence] ?? 0;
  const key = `${frame.station}-${frame.side}-${bmode.width}x${bmode.height}-${frame.settings.depthMm}-${frame.settings.lineDensity}-${s.renderer}`;
  let persist = bmodePersist;
  if (alpha === 0) {
    bmodePersist = null;
    return bmode.db;
  }
  if (!persist || persist.key !== key || persist.db.length !== bmode.db.length) {
    persist = { db: Float32Array.from(bmode.db), key };
  } else {
    for (let i = 0; i < persist.db.length; i += 1) {
      persist.db[i] = alpha * persist.db[i]! + (1 - alpha) * bmode.db[i]!;
    }
  }
  bmodePersist = persist;
  return persist.db;
}

/** Workers de render en paralelo (DEC-54): 2 por defecto; `?workers=1..4`. */
function renderWorkerCount(): number {
  const requested = Number(urlParams.get('workers'));
  if (Number.isInteger(requested) && requested >= 1 && requested <= 4) return requested;
  const cores = navigator.hardwareConcurrency || 2;
  return cores >= 4 ? 2 : 1;
}

function createRenderClient(): RenderClientLike {
  if (typeof Worker === 'undefined') return new SyncRenderClient();
  try {
    const clients: RenderClientLike[] = [];
    for (let i = 0; i < renderWorkerCount(); i++) {
      clients.push(
        new RenderClient(new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' })),
      );
    }
    return clients.length === 1 ? clients[0]! : new RenderPool(clients);
  } catch (error) {
    logError('worker', error);
    return new SyncRenderClient();
  }
}

/** Cadena PW en su worker (DEC-55); `?pwworker=0` o sin Worker → mismo hilo. */
function createPwTransport(): PwTransport {
  if (typeof Worker === 'undefined' || urlParams.get('pwworker') === '0') return new SyncPwTransport();
  try {
    return new WorkerPwTransport(new Worker(new URL('./pwWorker.ts', import.meta.url), { type: 'module' }));
  } catch (error) {
    logError('worker', error);
    return new SyncPwTransport();
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
    s.debrief.setTime(clock.t);
    s.debrief.record('settings', `${id}=${v}`, { id, value: v });
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

/** Rango del deslizador de profundidad por estación (DEC-52): ocular 30–60 mm,
 * temporal 30–160 mm (alcance del cráneo contralateral y vertebrobasilar),
 * submandibular 30–120 mm (ACI distal hasta la base del cráneo, DEC-58). */
const DEPTH_RANGE_MM: Record<Station, { min: number; max: number }> = {
  ojo: { min: 30, max: 60 },
  temporal: { min: 30, max: 160 },
  submandibular: { min: 30, max: 120 },
};

/** Ajustes de fábrica por estación. */
function defaultSettingsFor(station: Station): AcquisitionSettings {
  if (station === 'ojo') return defaultEyeSettings();
  return station === 'submandibular' ? defaultSubmandibularSettings() : defaultTemporalSettings();
}

/** Puerta PW por defecto de las estaciones DTC: M1 (52 mm) o ACI distal (45 mm). */
const DEFAULT_GATE_DEPTH_MM: Partial<Record<Station, number>> = { temporal: 52, submandibular: 45 };

const STATION_TITLE: Record<Station, string> = {
  ojo: 'Ojo',
  temporal: 'Temporal',
  submandibular: 'Submandibular',
};

/** Etiqueta del botón primario sin destruir icono/atajo (`toHaveText` e2e). */
function setFreezeLabel(frozen: boolean): void {
  $('freezeLabel').textContent = frozen ? 'Reanudar' : 'Congelar';
  $('freezeKey').textContent = frozen ? '' : 'Esp';
}

function setStation(station: Station, side: Side): void {
  const previousStation = s.station;
  s.station = station;
  s.side = side;
  document.body.dataset.station = station;
  navigator3d?.resetCamera(station, side);
  headView?.resetCamera(station, side);
  s.settings = defaultSettingsFor(station);
  const gateDepth = DEFAULT_GATE_DEPTH_MM[station];
  if (gateDepth !== undefined && station !== previousStation) {
    s.gateDepthMm = gateDepth;
    s.gateUMm = 0;
  }
  const depthInput = $<HTMLInputElement>('depth');
  const depthRange = DEPTH_RANGE_MM[station];
  depthInput.min = String(depthRange.min);
  depthInput.max = String(depthRange.max);
  s.settings = {
    ...s.settings,
    depthMm: Math.min(depthRange.max, Math.max(depthRange.min, s.settings.depthMm)),
  };
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
    spectralGain: s.settings.spectralGainDb,
    outputPower: s.settings.outputPowerDb,
  };
  for (const [id, value] of Object.entries(values)) $<HTMLInputElement>(id).value = String(value);
  for (const id of Object.keys(values)) {
    $<HTMLInputElement>(id).dispatchEvent(new Event('input'));
  }
  tgcInputs.forEach((input) => {
    input.value = String(s.settings.tgcDb[Number(input.dataset.tgc)] ?? 0);
    input.dispatchEvent(new Event('input'));
  });
  ($('densidad') as HTMLSelectElement).value = s.settings.lineDensity;
  document.querySelectorAll('.tab').forEach((el) => {
    const t = el as HTMLElement;
    t.classList.toggle('on', t.dataset.station === station && t.dataset.side === side);
  });
  syncWindowSwitch();
  document.querySelectorAll('.pwonly').forEach((e) => ((e as HTMLElement).style.opacity = '1'));
  $('navigatorLegend').hidden = station === 'ojo';
  $('navigatorTitle').textContent = `${STATION_TITLE[station]} ${side}`;
  setPwOn(false);
  setColorOn(false);
  ($('cine') as HTMLButtonElement).disabled = true;
  s.cine.length = 0;
  s.cineIdx = 0;
  s.frozen = false;
  $('freeze').classList.remove('on');
  currentScan = null;
  colorPersist = null;
  bmodePersist = null;
  setFreezeLabel(false);
  $('hint').textContent =
    station === 'ojo'
      ? 'DVNO: activa «DVNO 3 mm» y marca los dos bordes de la vaina a 3 mm retroglobo.'
      : station === 'submandibular'
        ? 'Submandibular: puerta PW en la ACI distal (flujo alejándose, 30–55 mm, ángulo ≤ 30°); su TAMax es el denominador del Lindegaard.'
        : 'PW: activa, haz clic en el B-mode para poner la puerta y ajusta PRF/filtro/ángulo.';
  s.debrief.setTime(clock.t);
  s.debrief.record('station', `${station} ${side}`, { station, side });
}

/** Sub-conmutador «Ventana» del examen DTC (DEC-58) ← estación actual. */
function syncWindowSwitch(): void {
  const tcdWindow = s.station === 'submandibular' ? 'submandibular' : 'temporal';
  document.querySelectorAll<HTMLElement>('.win').forEach((b) => {
    const on = b.dataset.window === tcdWindow && isTcdStation(s.station);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/** Parámetros fisiológicos/de tiempo de una solicitud de render. */
interface RenderTiming {
  t: number;
  cardiacPhase: number;
  respiratoryPhase: number;
  flowModulation: number;
  handMotion: boolean;
}

function sendRenderRequest(timing: RenderTiming): void {
  const requestId = ++renderId;
  renderer
    .request({
      id: requestId,
      seed: sim.patient.seed,
      willisVariant: sim.willisVariant,
      caseId: sim.clinicalCase.id,
      side: s.side,
      station: s.station,
      settings: { ...s.settings },
      tiltDeg: s.tiltDeg,
      offsetMm: s.offsetMm,
      offsetVMm: s.offsetVMm,
      tiltVDeg: s.tiltVDeg,
      rotDeg: s.rotDeg,
      press: s.press,
      t: timing.t,
      cardiacPhase: timing.cardiacPhase,
      respiratoryPhase: timing.respiratoryPhase,
      handMotion: timing.handMotion,
      flowModulation: timing.flowModulation,
      physiology: sim.patient.physiology,
      color: s.colorOn,
    })
    .then((response) => {
      // Canalización: una respuesta más antigua que la ya dibujada se descarta.
      if (response.id < lastDrawnId) return;
      if (s.frozen && s.currentFrame) return; // congelado conserva el último frame en vivo; si aún no hay ninguno, el frame en vuelo es el primero
      lastDrawnId = response.id;
      s.currentFrame = response.frame;
      pushCine(s, { frame: response.frame, bmode: response.bmode, scan: response.scan });
      drawFrame(response);
      // Primer B-mode pintado: ahora sí se descarga Three.js (DEC-56).
      if (!views3dRequested) setTimeout(loadViews3d, 0);
    })
    .catch((error) => {
      if (!(error instanceof SupersededRenderRequest)) {
        logError('worker', error);
      }
    });
}

function toggleFreeze(): void {
  s.frozen = !s.frozen;
  if (!s.frozen) {
    colorPersist = null;
    bmodePersist = null;
  }
  setFreezeLabel(s.frozen);
  $('freeze').classList.toggle('on', s.frozen);
  ($('cine') as HTMLButtonElement).disabled = !s.frozen || s.cine.length < 2;
  const composition = pw.composition();
  const summary = pw.latestMcaMeasure();
  // Lindegaard (DEC-58): el índice registrado usa la ACI medida del mismo
  // lado si existe; se guardan también el medido y el de referencia.
  const li = pw.lindegaard();
  const reference =
    li !== null ? lindegaardRatio(li.mcaTaMaxCms, sim.clinicalCase.icaExtracranialTamaxCms) : Number.NaN;
  const icaHere = s.station === 'submandibular' ? pw.measuredIca(s.side) : null;
  s.debrief.setTime(clock.t);
  s.debrief.record('freeze', s.frozen ? 'congelar' : 'reanudar', {
    frozen: s.frozen,
    station: s.station,
    side: s.side,
    bloodFraction: composition?.bloodFraction ?? 0,
    pi: summary?.pi ?? Number.NaN,
    lindegaard: li?.ratio ?? Number.NaN,
    lindegaardSource: li?.icaSource ?? '',
    lindegaardMedido: li?.icaSource === 'medida' ? li.ratio : Number.NaN,
    lindegaardReferencia: reference,
    mcaTaMaxCms: li?.mcaTaMaxCms ?? Number.NaN,
    icaTaMaxCms: li?.icaTaMaxCms ?? icaHere?.taMaxCms ?? Number.NaN,
  });
}

/** Mezcla la malla de color nueva con la persistencia (por celda) y
 * devuelve la malla a pintar; `null` con el color apagado. */
function colorWithPersistence(response: RenderResponse): ColorOverlayGrid | null {
  const { frame, color } = response;
  if (!color || !s.colorOn) {
    colorPersist = null;
    return null;
  }
  const key = JSON.stringify([
    color.rows,
    color.cols,
    color.box,
    frame.side,
    frame.settings.depthMm,
    frame.settings.prfHz,
  ]);
  let persist = colorPersist;
  if (!persist || persist.key !== key || persist.vel.length !== color.vel.length) {
    persist = { vel: Float32Array.from(color.vel), pow: Float32Array.from(color.pow), key };
  } else {
    for (let i = 0; i < color.vel.length; i += 1) {
      const pwNew = color.pow[i]!;
      persist.pow[i] = Math.max(pwNew, persist.pow[i]! * 0.65);
      const vNew = color.vel[i]!;
      if (pwNew > 0.02 && Number.isFinite(vNew)) {
        const prev = persist.vel[i]!;
        persist.vel[i] = 0.55 * vNew + 0.45 * (Number.isFinite(prev) ? prev : vNew);
      }
    }
  }
  colorPersist = persist;
  return { vel: persist.vel, pow: persist.pow, rows: color.rows, cols: color.cols, box: color.box };
}

function drawFrame(response: RenderResponse): void {
  const { frame, bmode, scan } = response;
  currentScan = scan;
  const grid = colorWithPersistence(response);
  if (s.renderer === 'gpu' && gpuPipeline) {
    bmodeDbWithPersistence(bmode, frame); // mantiene la clave/vida del estado
    drawGpuBMode(bmode, scan, frame.settings, BMODE_PERSIST_ALPHA[s.persistence] ?? 0);
    if (grid) {
      drawColorOverlay(
        bCtx,
        grid,
        scan,
        frame.settings.depthMm,
        frame.settings.prfHz,
        frame.settings.frequencyMhz,
        bmode.width,
        bmode.height,
      );
    }
  } else {
    // Ruta CPU: B-mode (LUT precalculada) y color en un único putImageData.
    const db = bmodeDbWithPersistence(bmode, frame);
    drawBMode(
      bCtx,
      { ...bmode, db },
      { dynamicRangeDb: frame.settings.dynamicRangeDb, grayMap: s.grayMap },
      grid ? { grid, prfHz: frame.settings.prfHz, f0Mhz: frame.settings.frequencyMhz } : undefined,
    );
  }
  if (grid) drawColorBox(bCtx, s, frame.settings.colorBox);
  // PW sobre escala de grises es válido (DEC-54): la puerta no depende del color.
  if (s.pwOn) drawGateMarker(bCtx, sim, s, scan);
  drawCaliperMarks(bCtx, s);
  drawTeachingLandmarks(bCtx, sim, s, scan);
  drawScale(bCtx, sim, s, s.currentFrame);
}

function syncSpectralGainControl(): void {
  const active = s.pwOn;
  const control = $('spectralGainCtl');
  const input = $<HTMLInputElement>('spectralGain');
  control.hidden = !active;
  input.disabled = !active;
}

/** Enciende/apaga PW y refleja el estado en botón, `body[data-pw]` y dúplex. */
function setPwOn(on: boolean): void {
  s.pwOn = on;
  $('pw').classList.toggle('on', on);
  document.body.dataset.pw = String(on);
  syncSpectralGainControl();
  fitBmode();
}

/** Enciende/apaga el Doppler color (modo explícito, DEC-54). Apagado: el
 * worker no calcula la malla, no hay caja ni arrastre y se descarta la
 * persistencia de color. PW no fuerza el color. */
function setColorOn(on: boolean): void {
  s.colorOn = on;
  $('color').classList.toggle('on', on);
  document.body.dataset.color = String(on);
  colorPersist = null;
  if (!on) boxDrag = null;
}

/* ── Dúplex B-mode/espectro (DEC-53) ── */
const DUPLEX_KEY = 'neurosono.duplex';
const DUPLEX_MIN = 35;
const DUPLEX_MAX = 70;
const colCenter = document.querySelector<HTMLElement>('.colCenter')!;
/* Área del canvas dentro de #bmodeWrap (debajo de la barra de herramientas):
 * es la caja que se mide para el encaje 4:3, no la tarjeta completa. */
const bmodeStage = $('bmodeStage');
const splitter = $('splitter');

function applyDuplex(percent: number): void {
  const clamped = Math.min(DUPLEX_MAX, Math.max(DUPLEX_MIN, percent));
  colCenter.style.setProperty('--duplex', `${clamped.toFixed(1)}%`);
  splitter.setAttribute('aria-valuenow', clamped.toFixed(0));
}

function loadDuplex(): void {
  try {
    const stored = Number(localStorage.getItem(DUPLEX_KEY));
    if (Number.isFinite(stored) && stored > 0) applyDuplex(stored);
  } catch {
    /* almacenamiento no disponible: se usa el valor por defecto del CSS */
  }
}

/** Encaja el B-mode 4:3 en el área del canvas del dúplex (la que queda bajo la
 * barra de herramientas) sin deformarlo ni recortarlo; con PW apagado el canvas
 * vuelve al ancho completo por CSS. */
function fitBmode(): void {
  if (!s.pwOn) {
    bmodeCv.style.width = '';
    bmodeCv.style.height = '';
    return;
  }
  const w = bmodeStage.clientWidth;
  const h = bmodeStage.clientHeight;
  if (w <= 0 || h <= 0) return;
  const cssW = Math.floor(Math.min(w, (h * 4) / 3));
  bmodeCv.style.width = `${cssW}px`;
  bmodeCv.style.height = `${Math.floor((cssW * 3) / 4)}px`;
}

let splitDrag: { pointerId: number } | null = null;
splitter.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  splitDrag = { pointerId: e.pointerId };
  splitter.classList.add('dragging');
  splitter.setPointerCapture(e.pointerId);
  e.preventDefault();
});
splitter.addEventListener('pointermove', (e) => {
  if (!splitDrag) return;
  const rect = colCenter.getBoundingClientRect();
  if (rect.height <= 0) return;
  applyDuplex(((e.clientY - rect.top) / rect.height) * 100);
});
const endSplitDrag = (e: PointerEvent) => {
  if (!splitDrag) return;
  splitDrag = null;
  splitter.classList.remove('dragging');
  if (splitter.hasPointerCapture(e.pointerId)) splitter.releasePointerCapture(e.pointerId);
  try {
    localStorage.setItem(DUPLEX_KEY, colCenter.style.getPropertyValue('--duplex').replace('%', ''));
  } catch {
    /* sin persistencia */
  }
};
splitter.addEventListener('pointerup', endSplitDrag);
splitter.addEventListener('pointercancel', endSplitDrag);
splitter.addEventListener('keydown', (e) => {
  const current = parseFloat(colCenter.style.getPropertyValue('--duplex')) || 60;
  if (e.key === 'ArrowUp') applyDuplex(current - 2);
  else if (e.key === 'ArrowDown') applyDuplex(current + 2);
  else return;
  e.preventDefault();
});
splitter.tabIndex = 0;
splitter.setAttribute('aria-valuemin', String(DUPLEX_MIN));
splitter.setAttribute('aria-valuemax', String(DUPLEX_MAX));
loadDuplex();
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fitBmode()).observe(bmodeStage);
else window.addEventListener('resize', fitBmode);

/** Rotación del marcador y distancia retroglobo de cada medición (guía). */
const measurementMeta = new WeakMap<Measurement, MeasurementMeta>();

function recordMeasurement(rotDegAtMeasure = s.rotDeg): void {
  const measurement = s.measurements[s.measurements.length - 1];
  if (!measurement) return;
  measurementMeta.set(measurement, {
    rotDeg: rotDegAtMeasure,
    offsetMm: measurementRetroOffsetMm(sim, measurement),
  });
  const angle = pw.insonation();
  s.debrief.setTime(clock.t);
  s.debrief.record('measurement', measurement.kind, {
    kind: measurement.kind,
    side: measurement.side,
    station: s.station,
    tiltDeg: s.tiltDeg,
    valueMm: measurement.value,
    gainDb: s.settings.gainDb,
    referenceOffsetMm: measurement.referenceOffsetMm ?? Number.NaN,
    realDeg: angle?.realDeg ?? Number.NaN,
  });
}

function updateDebriefPanel(): void {
  const report = buildDebrief(s.debrief, sim, s, pw.hemodynamics());
  const panel = $('debriefReport');
  const severityClass = (severity: string) => `debrief-${severity}`;
  setHtml(
    panel,
    [
      `<div>Eventos: ${report.summary.nEvents} · Mediciones: ${report.summary.nMeasurements} · Hallazgos: ${report.summary.nFindings}</div>`,
      ...report.findings.map(
        (finding) =>
          `<div class="${severityClass(finding.severity)}"><b>${finding.severity}</b> ${finding.code}: ${finding.text}</div>`,
      ),
      ...report.guide.flatMap((section) => [
        '<hr>',
        `<div><b>Guía</b> · ${section.title} · ${section.completed ? 'completa' : 'en curso'} · ${section.totalS.toFixed(0)} s</div>`,
        ...section.steps.map(
          (step) =>
            `<div>${step.manual ? '↷' : '✓'} ${step.title}: ${step.durationS.toFixed(1)} s${step.manual ? ' (omitido)' : ''}</div>`,
        ),
      ]),
      '<hr>',
      ...report.events
        .slice(-12)
        .map((event) => `<div>${event.t.toFixed(2)} s · ${event.kind} · ${event.detail}</div>`),
    ].join(''),
  );
}

function syncProbeSlider(id: string, labelId: string, value: number, fmt: (v: number) => string): void {
  const el = $(id) as HTMLInputElement;
  if (Number(el.value) !== value) el.value = String(value);
  $(labelId).textContent = fmt(value);
}

function syncProtocolControls(): void {
  document.body.dataset.station = s.station;
  document.body.dataset.pw = String(s.pwOn);
  const rot = $('rot') as HTMLInputElement;
  if (rot.value !== String(s.rotDeg)) {
    rot.value = String(s.rotDeg);
    rot.dispatchEvent(new Event('input'));
  }
  $('rotV').textContent = `${s.rotDeg}°`;
  // Deslizadores de sonda ← estado (el teclado escribe el mismo estado).
  syncProbeSlider('tilt', 'tiltV', s.tiltDeg, (v) => `${v}°`);
  syncProbeSlider('shift', 'shiftV', s.offsetMm, (v) => `${v} mm`);
  syncProbeSlider('shiftY', 'shiftYV', s.offsetVMm, (v) => `${v} mm`);
  syncProbeSlider('angul', 'angulV', s.tiltVDeg, (v) => `${v}°`);
  syncProbeSlider('press', 'pressV', Math.round(s.press * 100), (v) => `${v}%`);
  // Chips de plano ← inclinación actual (presets 0° / 10°).
  $('planoMesencefalico').classList.toggle('on', s.station === 'temporal' && s.tiltDeg === 0);
  $('planoDiencefalico').classList.toggle('on', s.station === 'temporal' && s.tiltDeg === 10);
  $('dte').classList.toggle('on', s.caliperMode === 'dte');
  $('dvno').classList.toggle('on', s.caliperMode === 'dvno');
  document.querySelectorAll('.tab').forEach((el) => {
    const t = el as HTMLElement;
    t.classList.toggle('on', t.dataset.station === s.station && t.dataset.side === s.side);
  });
  syncWindowSwitch();
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
  setHtml(
    panel,
    [
      '<table><thead><tr><th>Lado</th><th>Transversal</th><th>Sagital</th><th>DTE</th><th>Ratio</th></tr></thead>',
      `<tbody>${sideRow('der')}${sideRow('izq')}</tbody></table>`,
      `<div>Media bilateral: ${report.bilateralMeanMm?.toFixed(2) ?? '—'} mm · Asimetría: ${report.asymmetryMm?.toFixed(2) ?? '—'} mm</div>`,
      `<div>Flags: ${report.flags.length ? report.flags.join(', ') : 'ninguno'}</div>`,
    ].join(''),
  );
}

function updateAcousticLabel(): void {
  const output = acousticOutput({
    transducer: s.settings.transducer,
    station: s.station,
    mode: imagingMode(s),
    frequencyMhz: s.settings.frequencyMhz,
    focusMm: s.settings.focusMm,
    prfHz: s.settings.prfHz,
    gateMm: s.settings.gateMm,
    outputPowerDb: s.settings.outputPowerDb,
  });
  const el = $('acousticLabel');
  el.textContent = `MI ${output.mi.toFixed(2)}  ${output.tiKind} ${output.ti.toFixed(2)}`;
  el.classList.toggle('warn', output.ocularLimitExceeded);
  if (output.ocularLimitExceeded && !alaraLogged) {
    s.debrief.setTime(clock.t);
    s.debrief.record('alara', 'límite ocular excedido', {
      ocularLimitExceeded: true,
      mi: output.mi,
      ti: output.ti,
    });
    alaraLogged = true;
  }
  if (!output.ocularLimitExceeded) alaraLogged = false;
}

function drawCineFrame(): void {
  const item = nextCine(s);
  if (!item) return;
  // El cine guarda la adquisición cruda: se dibuja sin la persistencia en vivo.
  if (s.renderer === 'gpu' && gpuPipeline) {
    drawGpuBMode(item.bmode, item.scan, item.frame.settings);
  } else {
    drawBMode(bCtx, item.bmode, {
      dynamicRangeDb: item.frame.settings.dynamicRangeDb,
      grayMap: s.grayMap,
    });
  }
  $('hint').textContent =
    `Cine ${s.cineIdx + 1}/${s.cine.length} · cuadro t=${item.frame.tSeconds.toFixed(2)} s`;
}

/* ── Modo guiado (DEC-56) ── */
const guideDrawer = $('guideDrawer');
const guideButton = $<HTMLButtonElement>('guide');
/** Progreso por guía: cambiar de examen conserva el de la otra. */
const guideProgress = new Map<string, GuideProgress>();
let guideOpen = false;
let activeGuideId: string | null = null;
let lastGuideCtx: GuideContext | null = null;
let lastGuideSummary: GuideSummary | null = null;
const guideTruthValues = guideTruth(sim);

function recordGuideEvents(prev: GuideProgress, next: GuideProgress): void {
  const guide = guideById(next.guideId);
  for (const event of completedSince(prev, next)) {
    const step = guide.steps[event.stepIndex]!;
    s.debrief.setTime(clock.t);
    s.debrief.record('guide', `${guide.title}: ${step.title}${event.manual ? ' (omitido)' : ''}`, {
      guideId: event.guideId,
      stepId: event.stepId,
      stepIndex: event.stepIndex,
      durationS: event.durationMs / 1000,
      manual: event.manual,
    });
  }
}

function setGuideProgress(next: GuideProgress): void {
  const prev = guideProgress.get(next.guideId);
  if (prev === next) return;
  if (prev) recordGuideEvents(prev, next);
  guideProgress.set(next.guideId, next);
}

/** Progreso de la guía del examen actual; pausa la del otro examen. */
function activeGuide(now: number): GuideProgress {
  const guide = guideForStation(s.station);
  if (activeGuideId && activeGuideId !== guide.id) {
    const other = guideProgress.get(activeGuideId);
    if (other) guideProgress.set(other.guideId, pauseGuide(other, now));
  }
  activeGuideId = guide.id;
  let progress = guideProgress.get(guide.id);
  if (!progress) {
    progress = startGuide(guide.id, now);
    guideProgress.set(guide.id, progress);
  } else if (progress.pausedAtMs !== null) {
    progress = resumeGuide(progress, now);
    guideProgress.set(guide.id, progress);
  }
  return progress;
}

function updateGuide(now: number): void {
  if (!guideOpen) return;
  const ctx = buildGuideContext(sim, s, pw, measurementMeta);
  lastGuideCtx = ctx;
  const progress = advance(activeGuide(now), ctx, now);
  setGuideProgress(progress);
  lastGuideSummary = isGuideDone(progress) ? guideSummary(progress, ctx, guideTruthValues) : null;
  renderGuidePanel({ progress, hint: hintVisible(progress, now), summary: lastGuideSummary });
  setSpotlight(currentStep(progress)?.target ?? null);
}

function setGuideOpen(open: boolean): void {
  const now = performance.now();
  guideOpen = open;
  guideDrawer.hidden = !open;
  guideButton.classList.toggle('on', open);
  guideButton.setAttribute('aria-expanded', String(open));
  document.body.dataset.guide = open ? 'open' : 'closed';
  if (open) {
    activeGuide(now);
    updateGuide(now);
  } else {
    if (activeGuideId) {
      const progress = guideProgress.get(activeGuideId);
      if (progress) guideProgress.set(progress.guideId, pauseGuide(progress, now));
    }
    activeGuideId = null;
    setSpotlight(null);
  }
  fitBmode();
}

function guideAction(action: (p: GuideProgress, now: number) => GuideProgress): void {
  const now = performance.now();
  const next = action(activeGuide(now), now);
  setGuideProgress(next);
  updateGuide(now);
}

guideButton.addEventListener('click', () => setGuideOpen(!guideOpen));
$('guideClose').addEventListener('click', () => setGuideOpen(false));
$('guidePrev').addEventListener('click', () => guideAction(prevStep));
$('guideNext').addEventListener('click', () =>
  guideAction((p, now) => nextStep(p, now, lastGuideCtx ?? undefined)),
);
$('guideReset').addEventListener('click', () => {
  guideAction(resetGuide);
  s.debrief.setTime(clock.t);
  s.debrief.record('guide', `${guideForStation(s.station).title}: reiniciar`, {
    guideId: guideForStation(s.station).id,
    reset: true,
  });
});
$('guideExport').addEventListener('click', () => {
  const progress = activeGuideId ? guideProgress.get(activeGuideId) : undefined;
  if (!progress || !lastGuideSummary) return;
  exportGuideReport(sim, s, progress, lastGuideSummary, (name, href) => {
    const a = document.createElement('a');
    a.download = name;
    a.href = href;
    a.click();
  });
  s.debrief.setTime(clock.t);
  s.debrief.record('export', `informe guía ${progress.guideId}`);
});

function frameLoop(now: number): void {
  const elapsed = Math.min(0.2, (now - lastT) / 1000);
  lastT = now;
  try {
    const steps = clock.requestSteps(elapsed);
    for (let i = 0; i < steps; i++) clock.advance();
    s.tSec = clock.t;
    pw.step(clock, elapsed);
    if (!s.frozen) {
      // Canalización (DEC-54): se pide el siguiente fotograma en cuanto hay un
      // worker libre (sin el antiguo tope fijo de 90 ms), como mucho a 30 fps.
      if (renderer.idle > 0 && now - lastRender >= MIN_RENDER_INTERVAL_MS) {
        lastRender = now;
        const phys = sim.physStateAt(clock.t);
        sendRenderRequest({
          t: phys.t,
          cardiacPhase: phys.cardiacPhase,
          respiratoryPhase: phys.respiratoryPhase,
          flowModulation: phys.flowModulation,
          handMotion: s.handMotion,
        });
      }
    } else if (s.cinePlaying && s.cine.length) {
      drawCineFrame();
    }
    const navPose = currentPose(sim, { ...s, tSec: clock.t, handMotion: s.handMotion });
    const gateCenter = s.pwOn ? pw.gateCenter(navPose) : null;
    if (navigator3d) {
      navigator3d.update(
        s,
        currentScan,
        navPose,
        gateCenter,
        s.colorOn && isTcdStation(s.station) ? s.settings.colorBox : null,
      );
      navigator3d.renderIfNeeded(now);
    }
    // La vista de cabeza es una segunda superficie WebGL: a ritmo reducido
    // basta para la interacción y no satura el renderizador por software.
    if (headView && headView.update(s, navPose, currentScan)) {
      if (headView.interacting || now - lastHeadRender > 150) {
        lastHeadRender = now;
        headView.render();
      }
    } else if (headView?.interacting) {
      headView.render();
    }
    drawSpectral(spectralCtx, sim, s, pw);
    // Paneles DOM a 4 Hz (DEC-54): innerHTML solo si cambia y los <details>
    // cerrados no se recalculan. Cualquier entrada del usuario fuerza el refresco.
    if (now - lastPanelUpdate >= PANEL_INTERVAL_MS) {
      lastPanelUpdate = now;
      updateReadouts(readoutsEl, sim, s, pw);
      syncProtocolControls();
      if (onsdReportPanel.open) updateOnsdReport();
      if (debriefPanel.open) updateDebriefPanel();
      updateAcousticLabel();
      updateGuide(now);
    }
  } catch (err) {
    logError('frame', err);
  }
  requestAnimationFrame(frameLoop);
}

const ranges: [string, string, (v: number) => void, (v: number) => string][] = [
  ['tilt', 'tiltV', (v: number) => (s.tiltDeg = v), (v: number) => `${v}°`],
  ['shift', 'shiftV', (v: number) => (s.offsetMm = v), (v: number) => `${v} mm`],
  ['shiftY', 'shiftYV', (v: number) => (s.offsetVMm = v), (v: number) => `${v} mm`],
  ['angul', 'angulV', (v: number) => (s.tiltVDeg = v), (v: number) => `${v}°`],
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
  ['spectralGain', 'spectralGainV', (v: number) => setSetting('spectralGainDb', v), (v: number) => `${v} dB`],
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

const tgcInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-tgc]'));
tgcInputs.forEach((input) => {
  const band = Number(input.dataset.tgc);
  const update = () => {
    const v = parseFloat(input.value);
    const next = s.settings.tgcDb.slice();
    next[band] = v;
    s.settings = { ...s.settings, tgcDb: next };
    $('tgcV').textContent = `${v} dB`;
    s.debrief.setTime(clock.t);
    s.debrief.record('settings', `tgc${band}=${v}`, { id: `tgc${band}`, value: v });
  };
  input.addEventListener('input', update);
});

($('densidad') as HTMLSelectElement).addEventListener('change', (event) => {
  setLineDensity((event.target as HTMLSelectElement).value as LineDensity);
});
const sweepInput = $('sweep') as HTMLSelectElement;
const sweepValue = $('sweepV');
sweepInput.value = String(s.sweepSeconds);
sweepValue.textContent = `${s.sweepSeconds} s`;
sweepInput.addEventListener('change', () => {
  s.sweepSeconds = Number(sweepInput.value) as 2 | 3 | 4 | 6;
  sweepValue.textContent = `${s.sweepSeconds} s`;
});
const colormapInput = $('colormap') as HTMLSelectElement;
colormapInput.value = s.spectralColormap;
colormapInput.addEventListener('change', () => {
  s.spectralColormap = colormapInput.value as 'gris' | 'ambar';
});
const persistenceInput = $('persistencia') as HTMLSelectElement;
persistenceInput.value = String(s.persistence);
persistenceInput.addEventListener('change', () => {
  s.persistence = Number(persistenceInput.value) as AppState['persistence'];
  bmodePersist = null;
  s.debrief.setTime(clock.t);
  s.debrief.record('settings', `persistencia=${s.persistence}`, {
    id: 'persistencia',
    value: s.persistence,
  });
});
const grayMapInput = $('mapaGris') as HTMLSelectElement;
grayMapInput.value = s.grayMap;
grayMapInput.addEventListener('change', () => {
  s.grayMap = grayMapInput.value as AppState['grayMap'];
  s.debrief.setTime(clock.t);
  s.debrief.record('settings', `mapaGris=${s.grayMap}`, { id: 'mapaGris', value: s.grayMap });
});
const rendererInput = $('renderer') as HTMLSelectElement;
const rendererControl = $('rendererCtl');
rendererControl.hidden = !gpuAvailable;
rendererInput.value = s.renderer;
rendererInput.addEventListener('change', () => {
  s.renderer = rendererInput.value as 'cpu' | 'gpu';
  document.body.dataset.renderer = s.renderer;
});
const volumeInput = $('volume') as HTMLInputElement;
const volumeValue = $('volumeV');
volumeInput.value = String(s.volume);
volumeValue.textContent = `${s.volume}%`;
volumeInput.addEventListener('input', () => {
  s.volume = Number(volumeInput.value);
  volumeValue.textContent = `${s.volume}%`;
  pw.setVolume(s.volume);
});
const handMotionInput = $('handMotion') as HTMLInputElement;
handMotionInput.checked = s.handMotion;
handMotionInput.addEventListener('change', () => {
  s.handMotion = handMotionInput.checked;
  s.debrief.setTime(clock.t);
  s.debrief.record('settings', `microMovimientoMano=${s.handMotion ? 'on' : 'off'}`, {
    id: 'handMotion',
    value: s.handMotion,
  });
});

$('planoMesencefalico').addEventListener('click', () => setTiltPreset(0));
$('planoDiencefalico').addEventListener('click', () => setTiltPreset(10));

document.querySelectorAll('.tab').forEach((el) =>
  el.addEventListener('click', () => {
    const t = el as HTMLElement;
    setStation(t.dataset.station as Station, t.dataset.side as Side);
  }),
);
// Pulsar el cuerpo de la píldora de examen (icono/nombre) cambia de examen
// conservando el lado actual; los botones D/I siguen siendo las `.tab`.
document.querySelectorAll<HTMLElement>('.exam').forEach((pill) =>
  pill.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.tab, .win')) return;
    const station = pill.dataset.exam as Station;
    // El examen DTC abarca las ventanas temporal y submandibular.
    if (station === s.station || (station === 'temporal' && isTcdStation(s.station))) return;
    setStation(station, s.side);
  }),
);
// Sub-conmutador «Ventana: Temporal | Submandibular» dentro del examen DTC.
document.querySelectorAll<HTMLElement>('.win').forEach((b) =>
  b.addEventListener('click', () => {
    const station = b.dataset.window as Station;
    if (station === s.station) return;
    setStation(station, s.side);
  }),
);
$('freeze').addEventListener('click', toggleFreeze);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
let lastProbeKeyT = -Infinity;
let probeKeyHintShown = false;
/** Navegación de sonda por teclado: flechas deslizan, Mayús+flechas inclinan,
 * Q/E rotación de marcador, +/− presión, R reinicia. Solo si el foco no está
 * en un control editable. Debrief 'probe' limitado a 1 evento/300 ms. */
function probeKey(e: KeyboardEvent): boolean {
  const el = document.activeElement;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
    return false;
  const apply = (f: () => void): true => {
    f();
    if (!probeKeyHintShown) {
      probeKeyHintShown = true;
      const hint = $('keyHint');
      hint.hidden = false;
      setTimeout(() => (hint.hidden = true), 6000);
    }
    const now = performance.now();
    if (now - lastProbeKeyT >= 300) {
      lastProbeKeyT = now;
      s.debrief.setTime(clock.t);
      s.debrief.record('probe', `sonda por teclado (${e.code}${e.shiftKey ? ' ⇧' : ''})`, {
        offsetMm: s.offsetMm,
        offsetVMm: s.offsetVMm,
        tiltDeg: s.tiltDeg,
        tiltVDeg: s.tiltVDeg,
        rotDeg: s.rotDeg,
        press: s.press,
      });
    }
    return true;
  };
  switch (e.code) {
    case 'ArrowLeft':
      return apply(() => {
        if (e.shiftKey) s.tiltVDeg = clamp(s.tiltVDeg - 1, -25, 25);
        else s.offsetMm = clamp(s.offsetMm - 1, -18, 18);
      });
    case 'ArrowRight':
      return apply(() => {
        if (e.shiftKey) s.tiltVDeg = clamp(s.tiltVDeg + 1, -25, 25);
        else s.offsetMm = clamp(s.offsetMm + 1, -18, 18);
      });
    case 'ArrowUp':
      return apply(() => {
        if (e.shiftKey) s.tiltDeg = clamp(s.tiltDeg - 1, -35, 35);
        else s.offsetVMm = clamp(s.offsetVMm + 1, -20, 20);
      });
    case 'ArrowDown':
      return apply(() => {
        if (e.shiftKey) s.tiltDeg = clamp(s.tiltDeg + 1, -35, 35);
        else s.offsetVMm = clamp(s.offsetVMm - 1, -20, 20);
      });
    case 'KeyQ':
      return apply(() => (s.rotDeg = clamp(s.rotDeg - 5, -90, 90)));
    case 'KeyE':
      return apply(() => (s.rotDeg = clamp(s.rotDeg + 5, -90, 90)));
    case 'Equal':
    case 'NumpadAdd':
      return apply(() => (s.press = clamp(s.press + 0.1, 0, 1)));
    case 'Minus':
    case 'NumpadSubtract':
      return apply(() => (s.press = clamp(s.press - 0.1, 0, 1)));
    case 'KeyR':
      return apply(() => {
        s.offsetMm = 0;
        s.offsetVMm = 0;
        s.tiltDeg = 0;
        s.tiltVDeg = 0;
        s.rotDeg = 0;
        s.press = 0.3;
      });
    default:
      return false;
  }
}
document.addEventListener('keydown', (e) => {
  if (probeKey(e)) {
    e.preventDefault();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    toggleFreeze();
  } else if (e.key === 'p') $('pw').click();
  else if (e.key === 'f') $('color').click();
  else if (e.key === 'c') $('caliper').click();
  else if (e.key === 'd') $('teaching').click();
  else if (e.key === 'g') guideButton.click();
});
$('cine').addEventListener('click', () => {
  s.cinePlaying = !s.cinePlaying;
  $('cine').classList.toggle('on', s.cinePlaying);
});
$('pw').addEventListener('click', () => {
  setPwOn(!s.pwOn);
  if (s.pwOn) pw.reset();
  s.debrief.setTime(clock.t);
  s.debrief.record(s.pwOn ? 'pw-on' : 'pw-off', s.pwOn ? 'PW activar' : 'PW desactivar', { pwOn: s.pwOn });
});
$('color').addEventListener('click', () => {
  setColorOn(!s.colorOn);
  s.debrief.setTime(clock.t);
  s.debrief.record('settings', `color=${s.colorOn ? 'on' : 'off'}`, { id: 'color', value: s.colorOn });
});
$('audio').addEventListener('click', () => {
  s.audioOn = !s.audioOn;
  pw.setAudioEnabled(s.audioOn);
  pw.setVolume(s.volume);
  $('audio').classList.toggle('on', s.audioOn);
});
$('teaching').addEventListener('click', () => {
  s.teachingMode = !s.teachingMode;
  $('teaching').classList.toggle('on', s.teachingMode);
  ($('scenarioPanel') as HTMLDetailsElement).open = s.teachingMode;
  $('debrief').hidden = !s.teachingMode;
  $('exportDebrief').hidden = !s.teachingMode;
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
  s.debrief.setTime(clock.t);
  s.debrief.record('protocol', s.onsdActive ? 'protocolo DVNO iniciar' : 'protocolo DVNO reiniciar', {
    started: s.onsdActive,
  });
});
let boxDrag: { du: number; dz: number; x0: number; y0: number; moved: boolean } | null = null;
let suppressClick = false;
bmodeCv.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !s.colorOn) return;
  const r = bmodeCv.getBoundingClientRect();
  const point = canvasToImagePoint(
    ((e.clientX - r.left) / r.width) * bmodeCv.width,
    ((e.clientY - r.top) / r.height) * bmodeCv.height,
    s,
    bmodeCv.width,
    bmodeCv.height,
  );
  const box = s.settings.colorBox;
  if (Math.abs(point.u - box.uCenter) > box.uHalf || point.z < box.zMinMm || point.z > box.zMaxMm) {
    return;
  }
  boxDrag = {
    du: point.u - box.uCenter,
    dz: point.z - (box.zMinMm + box.zMaxMm) / 2,
    x0: e.clientX,
    y0: e.clientY,
    moved: false,
  };
  bmodeCv.setPointerCapture(e.pointerId);
});
bmodeCv.addEventListener('pointermove', (e) => {
  if (!boxDrag) return;
  if (Math.hypot(e.clientX - boxDrag.x0, e.clientY - boxDrag.y0) >= 4) boxDrag.moved = true;
  if (!boxDrag.moved) return;
  const r = bmodeCv.getBoundingClientRect();
  const point = canvasToImagePoint(
    ((e.clientX - r.left) / r.width) * bmodeCv.width,
    ((e.clientY - r.top) / r.height) * bmodeCv.height,
    s,
    bmodeCv.width,
    bmodeCv.height,
  );
  const box = s.settings.colorBox;
  const halfU = (currentScan?.widthMmOrRad ?? box.uHalf * 2) / 2;
  const uCenter = Math.max(-halfU + box.uHalf, Math.min(halfU - box.uHalf, point.u - boxDrag.du));
  const halfZ = (box.zMaxMm - box.zMinMm) / 2;
  const zCenter = Math.max(2 + halfZ, Math.min(s.settings.depthMm - halfZ, point.z - boxDrag.dz));
  s.settings = {
    ...s.settings,
    colorBox: { uCenter, uHalf: box.uHalf, zMinMm: zCenter - halfZ, zMaxMm: zCenter + halfZ },
  };
});
bmodeCv.addEventListener('pointerup', (e) => {
  if (!boxDrag) return;
  if (boxDrag.moved) {
    suppressClick = true;
    s.debrief.setTime(clock.t);
    s.debrief.record(
      'settings',
      `cajaColor=${s.settings.colorBox.uCenter.toFixed(3)},${s.settings.colorBox.zMinMm.toFixed(1)}-${s.settings.colorBox.zMaxMm.toFixed(1)}`,
      {},
    );
  }
  boxDrag = null;
  if (bmodeCv.hasPointerCapture(e.pointerId)) bmodeCv.releasePointerCapture(e.pointerId);
});
bmodeCv.addEventListener('click', (e) => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const r = bmodeCv.getBoundingClientRect();
  const point = canvasToImagePoint(
    ((e.clientX - r.left) / r.width) * bmodeCv.width,
    ((e.clientY - r.top) / r.height) * bmodeCv.height,
    s,
    bmodeCv.width,
    bmodeCv.height,
  );
  if (s.pwOn) {
    s.gateDepthMm = point.z;
    s.gateUMm = point.u;
    return;
  }
  // El protocolo DVNO gira el marcador al completar un hueco: la rotación de
  // la medición es la de antes del clic. Solo se registra una medición nueva
  // (antes un clic sin caliper activo re-registraba la última).
  const rotBefore = s.rotDeg;
  const countBefore = s.measurements.length;
  addCaliperPoint(sim, s, point);
  if (s.measurements.length > countBefore) recordMeasurement(rotBefore);
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
  s.debrief.setTime(clock.t);
  s.debrief.record('export', 'informe DVNO');
});
$('export').addEventListener('click', () => {
  s.debrief.setTime(clock.t);
  s.debrief.record('export', 'sesión clínica');
});
$('debrief').addEventListener('click', () => {
  if (!s.teachingMode) return;
  ($('debriefPanel') as HTMLDetailsElement).open = true;
});
$('exportDebrief').addEventListener('click', () => {
  if (!s.teachingMode) return;
  s.debrief.setTime(clock.t);
  s.debrief.record('export', 'debriefing');
  const data = JSON.stringify(buildDebrief(s.debrief, sim, s, pw.hemodynamics()), null, 2);
  const href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.download = `neurosono-debrief-${Date.now()}.json`;
  a.href = href;
  a.click();
});
setStation('ojo', 'der');
requestAnimationFrame(frameLoop);
