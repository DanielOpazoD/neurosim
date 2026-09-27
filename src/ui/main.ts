/**
 * Punto de entrada de la aplicación: cablea caso → sonda → imagen →
 * PW → medición. La UI solo lee y manda; la física está en los módulos.
 */
import { SimulationClock } from '../core/clock';
import { add, normalize, scale, type Vec3 } from '../core/vec3';
import { buildReferenceCase } from '../domain/referenceCase';
import type { AcquisitionSettings, ProbePose, Side, Station } from '../domain/contracts';
import { defaultEyeSettings, defaultTemporalSettings } from '../domain/settings';
import { classifyEye, fromEyeLocal, nerveCenterline } from '../anatomy/eye';
import { classifyHead } from '../anatomy/head';
import { renderBMode, type BModeFrame } from '../ultrasound/bmode';
import {
  buildScan,
  beamDirAt,
  elevAxis,
  patientToImage,
  rotateAround,
  LINEAR_APERTURE_MM,
  type ScanGeometry,
} from '../ultrasound/probe';
import { drawBMode, drawColorOverlay, drawSpectrum } from './canvasDraw';
import { PwDopplerChain } from '../doppler/pwChain';
import { renderColorDoppler } from '../doppler/color';
import { DopplerAudio } from '../doppler/audio';
import { transmissionTo } from '../ultrasound/attenuation';
import { measureBeats, observedTrace, summarizeBeats } from '../doppler/measureMca';
import { recordDistance, type ImagePoint } from '../domain/measure';
import type { AcquiredFrame, Measurement } from '../domain/contracts';
import { NEURO_PARAMS } from '../domain/parameters';

const sim = buildReferenceCase();
const clock = new SimulationClock();

interface StationState {
  station: Station;
  side: Side;
  settings: AcquisitionSettings;
  offsetMm: number;
  tiltDeg: number;
  rotDeg: number;
  press: number;
}

const state: StationState = {
  station: 'ojo',
  side: 'der',
  settings: defaultEyeSettings(),
  offsetMm: 0,
  tiltDeg: 0,
  rotDeg: 0,
  press: 0.3,
};

let frozen = false;
let pwOn = false;
let caliperMode: 'none' | 'dist' | 'dvno' = 'none';
let caliperPts: ImagePoint[] = [];
const measurements: Measurement[] = [];
const cine: { frame: AcquiredFrame; bmode: BModeFrame; scan: ScanGeometry }[] = [];
let cinePlaying = false;
let cineIdx = 0;
let currentFrame: AcquiredFrame | null = null;
let gateDepthMm = 52;
let gateUMm = 0;
let audio: DopplerAudio | null = null;
/** Envoltura: la cadena la recibe siempre; delega cuando el usuario activa audio. */
const audioForwarder = {
  pushIQ(re: Float32Array, im: Float32Array, n: number, prfHz: number): void {
    audio?.pushIQ(re, im, n, prfHz);
  },
  reset(): void {
    audio?.reset();
  },
};

// ---------- poses ----------

function eyePose(side: Side): ProbePose {
  const eye = sim.eyes[side];
  // Sonda sobre el párpado cerrado, anterior al globo (+z paciente),
  // mirando posterior (−z). Lateral = izquierda del paciente (+x levógiro).
  const anterior: Vec3 = [0, 0, 1];
  const lateral: Vec3 = [1, 0, 0];
  const tilt = (state.tiltDeg * Math.PI) / 180;
  const rot = (state.rotDeg * Math.PI) / 180;
  // Origen dentro de la capa de gel (r+1.2..r+3.7 en el marco local):
  // la sonda está acoplada al párpado a través del gel.
  const origin = add(
    eye.center,
    add(scale(anterior, eye.globeRadiusMm + 3.2), scale(lateral, state.offsetMm)),
  );
  const fwd = normalize(rotateAround(scale(anterior, -1), lateral, tilt));
  const lat = rotateAround(lateral, fwd, rot);
  return { origin, forward: fwd, lateral: normalize(lat), markerAngleRad: rot, contactPressure: state.press };
}

function temporalPose(side: Side): ProbePose {
  const wc = sim.head.windowCenter[side];
  // La sonda apunta al mesencéfalo contralateral, no al centro del cráneo:
  // el haz queda nivelado con la base craneal donde corren M1/P1.
  const inward = normalize([
    sim.head.midbrainCenter[0] - wc[0],
    sim.head.midbrainCenter[1] - wc[1],
    sim.head.midbrainCenter[2] - wc[2],
  ]);
  const up: Vec3 = [0, 1, 0];
  let lateral: Vec3 = [
    inward[1] * up[2] - inward[2] * up[1],
    inward[2] * up[0] - inward[0] * up[2],
    inward[0] * up[1] - inward[1] * up[0],
  ];
  lateral = normalize(lateral);
  const tilt = (state.tiltDeg * Math.PI) / 180;
  const rot = (state.rotDeg * Math.PI) / 180;
  const fwd = normalize(rotateAround(inward, lateral, tilt));
  const origin = add(add(wc, scale(fwd, -3)), scale(lateral, state.offsetMm));
  const lat = rotateAround(lateral, fwd, rot);
  return { origin, forward: fwd, lateral: normalize(lat), markerAngleRad: rot, contactPressure: state.press };
}

function currentPose(): ProbePose {
  return state.station === 'ojo' ? eyePose(state.side) : temporalPose(state.side);
}

function sceneClassify() {
  if (state.station === 'ojo') {
    const eye = sim.eyes[state.side];
    return { classify: (p: Vec3) => classifyEye(eye, p) };
  }
  return { classify: (p: Vec3) => classifyHead(sim.head, p) };
}

// ---------- adquisición ----------

const LINES = 176;

function acquire(): { frame: AcquiredFrame; bmode: BModeFrame; scan: ScanGeometry } {
  const pose = currentPose();
  const scan = buildScan(pose, state.settings.transducer, LINES);
  const scene = sceneClassify();
  const bmode = renderBMode(scene, scan, pose, state.settings, `seed-${sim.patient.seed}-${state.side}`);
  const g = scan;
  const frame: AcquiredFrame = {
    tSeconds: clock.t,
    geometry: {
      kind: g.kind,
      apex: g.apex,
      scanOrigin: g.lines[0]!.origin,
      lateralDir: g.lateralDir,
      axialDir: g.axialDir,
      widthMmOrRad: g.widthMmOrRad,
      depthMm: state.settings.depthMm,
    },
    settings: { ...state.settings },
    side: state.side,
    station: state.station,
    caseId: sim.patient.label,
    seed: sim.patient.seed,
  };
  return { frame, bmode, scan };
}

// ---------- doppler pulsado ----------

let chain: PwDopplerChain | null = null;
let lastPrf = -1;
let lastWf = -1;
let lastDg = -999;

function ensureChain(): PwDopplerChain {
  if (!chain) {
    chain = new PwDopplerChain(sim.head, sim.flow, sim.patient.seed, audioForwarder);
  }
  return chain;
}

function gateGeometry(pose: ProbePose) {
  const beamDir = beamDirAt(pose, state.settings.transducer, gateUMm);
  const center = add(pose.origin, scale(beamDir, gateDepthMm));
  const elev = elevAxis(pose);
  const f0 = state.settings.frequencyMhz * 1e6;
  const c = 1540e3; // mm/s
  const lambda = c / f0;
  const latSigma = Math.max(0.8, (lambda * gateDepthMm) / 10 / 2); // ancho de haz ~ λz/D
  return {
    center,
    beamDir,
    lateral: pose.lateral,
    elevation: elev,
    lengthMm: state.settings.gateMm,
    lateralSigmaMm: latSigma,
    elevationSigmaMm: Math.max(1.5, latSigma * 2),
    pulseSigmaMm: Math.max(0.4, lambda * 1.5),
    apertureAngleSigmaRad: 0.04,
    transmission: transmissionTo(sim.head, pose.origin, center, state.settings.frequencyMhz),
  };
}

// ---------- render loop ----------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bmodeCv = $<HTMLCanvasElement>('bmode');
const spectralCv = $<HTMLCanvasElement>('spectral');
const pospad = $<HTMLCanvasElement>('pospad');
const bCtx = bmodeCv.getContext('2d')!;
const sCtx = spectralCv.getContext('2d')!;

let lastRender = 0;
let lastT = performance.now();

function frameLoop(now: number): void {
  const elapsed = Math.min(0.2, (now - lastT) / 1000);
  lastT = now;
  const steps = clock.requestSteps(elapsed);
  for (let i = 0; i < steps; i++) clock.advance();
  const t = clock.t;

  if (pwOn && state.station === 'temporal' && !frozen) {
    const c = ensureChain();
    const s = state.settings;
    // cambios de equipo en caliente: re-sincronizar la cadena PW
    if (s.prfHz !== lastPrf || s.wallFilterHz !== lastWf || s.dopplerGainDb !== lastDg) {
      c.begin(s.prfHz, s.frequencyMhz * 1e6, s.dopplerGainDb, s.wallFilterHz, clock.t);
      lastPrf = s.prfHz;
      lastWf = s.wallFilterHz;
      lastDg = s.dopplerGainDb;
    }
    const pose = currentPose();
    c.setGate(gateGeometry(pose));
    c.step(
      { t, cardiacPhase: sim.cardiac.phaseAt(t), heartRateBpm: sim.patient.physiology.heartRateBpm },
      [0, 0, 0],
      elapsed,
    );
    c.flush();
  }

  if (now - lastRender > 90 && !frozen) {
    lastRender = now;
    const { frame, bmode, scan } = acquire();
    currentFrame = frame;
    cine.push({ frame, bmode, scan });
    if (cine.length > 64) cine.shift();
    drawFrame(bmode, scan);
  } else if (frozen && cinePlaying && cine.length) {
    drawCineFrame();
  }
  drawSpectral();
  updateReadouts();
  requestAnimationFrame(frameLoop);
}

function drawFrame(bmode: BModeFrame, scan: ScanGeometry): void {
  drawBMode(bCtx, bmode, { dynamicRangeDb: state.settings.dynamicRangeDb });
  if (state.station === 'temporal') {
    const [vel, pow] = renderColorDoppler(
      sim.head,
      sim.flow,
      scan,
      currentPose(),
      state.settings,
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
      state.settings.depthMm,
      state.settings.prfHz,
      state.settings.frequencyMhz,
    );
    if (pwOn) drawGateMarker(bCtx, scan);
  }
  drawCaliperMarks();
  drawScale();
}

function drawCineFrame(): void {
  if (!cine.length) return;
  cineIdx = (cineIdx + 1) % cine.length;
  const item = cine[cineIdx]!;
  // cine reproduce cuadros guardados: no recalcula nada del estado actual
  drawBMode(bCtx, item.bmode, { dynamicRangeDb: item.frame.settings.dynamicRangeDb });
  $('hint').textContent = `Cine ${cineIdx + 1}/${cine.length} · cuadro t=${item.frame.tSeconds.toFixed(2)} s`;
}

function drawGateMarker(ctx: CanvasRenderingContext2D, scan: ScanGeometry): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const pose = currentPose();
  const center = add(pose.origin, scale(beamDirAt(pose, scan.kind, gateUMm), gateDepthMm));
  const { u, z } = patientToImage(pose, scan.kind, center);
  if (scan.kind === 'linear') {
    const x = (u / scan.widthMmOrRad + 0.5) * W;
    const y = (z / state.settings.depthMm) * H;
    ctx.strokeStyle = 'rgba(80,190,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.strokeRect(x - 8, y - 6, 16, 12);
  } else {
    const scalePx = Math.min(H * 1.15, Math.hypot(W / 2, H)) / state.settings.depthMm;
    const x = W / 2 + Math.sin(u) * z * scalePx;
    const y = Math.cos(u) * z * scalePx;
    ctx.strokeStyle = 'rgba(80,190,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.strokeRect(x - 8, y - 6, 16, 12);
  }
}

function canvasToImagePoint(x: number, y: number): ImagePoint {
  const W = bmodeCv.width;
  const H = bmodeCv.height;
  const s = state.settings;
  if (s.transducer === 'linear') {
    return { u: (x / W - 0.5) * LINEAR_APERTURE_MM, z: (y / H) * s.depthMm };
  }
  const scalePx = Math.min(H * 1.15, Math.hypot(W / 2, H)) / s.depthMm;
  return { u: Math.atan2(x - W / 2, y), z: Math.hypot(x - W / 2, y) / scalePx };
}

function drawCaliperMarks(): void {
  for (const p of caliperPts) {
    const [x, y] = imagePointToCanvas(p);
    bCtx.strokeStyle = '#ffd24a';
    bCtx.beginPath();
    bCtx.moveTo(x - 6, y);
    bCtx.lineTo(x + 6, y);
    bCtx.moveTo(x, y - 6);
    bCtx.lineTo(x, y + 6);
    bCtx.stroke();
  }
  if (caliperPts.length === 2) {
    const [x1, y1] = imagePointToCanvas(caliperPts[0]!);
    const [x2, y2] = imagePointToCanvas(caliperPts[1]!);
    bCtx.strokeStyle = '#ffd24a';
    bCtx.beginPath();
    bCtx.moveTo(x1, y1);
    bCtx.lineTo(x2, y2);
    bCtx.stroke();
  }
}

function imagePointToCanvas(p: ImagePoint): [number, number] {
  const W = bmodeCv.width;
  const H = bmodeCv.height;
  const s = state.settings;
  if (s.transducer === 'linear') {
    return [(p.u / LINEAR_APERTURE_MM + 0.5) * W, (p.z / s.depthMm) * H];
  }
  const scalePx = Math.min(H * 1.15, Math.hypot(W / 2, H)) / s.depthMm;
  return [W / 2 + Math.sin(p.u) * p.z * scalePx, Math.cos(p.u) * p.z * scalePx];
}

function drawScale(): void {
  const H = bmodeCv.height;
  const s = state.settings;
  bCtx.fillStyle = 'rgba(255,255,255,0.5)';
  bCtx.font = '10px monospace';
  for (let mm = 10; mm < s.depthMm; mm += 10) {
    const y = (mm / s.depthMm) * H;
    bCtx.fillRect(4, y, 6, 1);
    bCtx.fillText(`${mm} mm`, 12, y + 3);
  }
  if (state.station === 'ojo' && caliperMode === 'dvno' && currentFrame) {
    // Guía docente: profundidad de la sección a 3 mm retroglobo en el nervio.
    const eye = sim.eyes[state.side];
    const c3 = nerveCenterline(eye, NEURO_PARAMS.params.onsdOffsetMm.value);
    const patient = fromEyeLocal(eye, c3);
    const { u, z } = patientToImage(eyePose(state.side), 'linear', patient);
    const W = bmodeCv.width;
    const x = (u / LINEAR_APERTURE_MM + 0.5) * W;
    const y = (z / s.depthMm) * H;
    bCtx.strokeStyle = 'rgba(77,163,255,0.8)';
    bCtx.setLineDash([5, 4]);
    bCtx.beginPath();
    bCtx.moveTo(0, y);
    bCtx.lineTo(W, y);
    bCtx.stroke();
    bCtx.setLineDash([]);
    bCtx.fillStyle = 'rgba(77,163,255,0.9)';
    bCtx.fillText('3 mm retroglobo', x + 8, y - 4);
  }
}

function drawSpectral(): void {
  if (!pwOn || state.station !== 'temporal' || !chain) {
    sCtx.fillStyle = '#000';
    sCtx.fillRect(0, 0, spectralCv.width, spectralCv.height);
    if (!pwOn) {
      sCtx.fillStyle = 'rgba(255,255,255,0.35)';
      sCtx.font = '12px sans-serif';
      sCtx.fillText('Activa PW (ventana temporal) para el espectro', 16, 24);
    }
    return;
  }
  drawSpectrum(sCtx, chain.spectral.columns, {
    fftSize: chain.spectral.fftSize,
    baseline: state.settings.baseline,
    f0Mhz: state.settings.frequencyMhz,
    angleCorrectionDeg: state.settings.angleCorrectionDeg,
    invert: state.settings.invertColor,
    gainDb: state.settings.dopplerGainDb,
    windowSeconds: 5,
  });
}

// ---------- lecturas ----------

function updateReadouts(): void {
  const el = $('readouts');
  if (!el) return;
  if (pwOn && state.station === 'temporal' && chain && chain.spectral.columns.length > 20) {
    const cols = chain.spectral.columns.slice(-400);
    const trace = observedTrace(cols, {
      f0Hz: state.settings.frequencyMhz * 1e6,
      angleCorrectionRad: (state.settings.angleCorrectionDeg * Math.PI) / 180,
      invert: state.settings.invertColor,
      fftSize: chain.spectral.fftSize,
      wallFilterHz: state.settings.wallFilterHz,
    });
    const t0 = trace[0]?.t ?? 0;
    const t1 = trace[trace.length - 1]?.t ?? 0;
    const beats = sim.cardiac.beatsIn(t0, t1);
    const ms = measureBeats(
      trace,
      beats.map((b) => ({ tStart: b.tStart, rr: b.rr })),
    );
    const s = summarizeBeats(ms);
    const comp = chain.sampleVolume.lastComposition;
    if (s) {
      el.innerHTML = [
        row('PSV', `${Math.abs(s.psvCms).toFixed(0)} cm/s`),
        row('EDV', `${Math.abs(s.edvCms).toFixed(0)} cm/s`),
        row('TAMax', `${Math.abs(s.taMaxCms).toFixed(0)} cm/s`),
        row('PI (Gosling)', s.pi.toFixed(2)),
        row('IR', s.ri.toFixed(2)),
        row('Latidos', `${s.beats}`),
        row('Sangre en puerta', `${(comp.bloodFraction * 100).toFixed(0)}%`),
        row('Vaso dominante', comp.dominantVesselId ?? '—'),
      ].join('');
      return;
    }
  }
  if (measurements.length) {
    const last = measurements[measurements.length - 1]!;
    el.innerHTML = [
      row(
        last.kind === 'dvno' ? `DVNO ${last.convention ?? ''}` : 'Distancia',
        `${last.value.toFixed(2)} mm`,
      ),
      row('Cuadro', `t=${last.frameTSeconds.toFixed(2)} s`),
      row('Ref. retroglobo', `${last.referenceOffsetMm ?? '—'} mm`),
      row('Medidas', `${measurements.length}`),
    ].join('');
  } else {
    el.innerHTML = '<div><span>Sin medidas</span><span>—</span></div>';
  }
}

const row = (k: string, v: string) => `<div><span>${k}</span><span class="meas">${v}</span></div>`;

// ---------- interacción ----------

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

bindRange(
  'tilt',
  'tiltV',
  (v) => (state.tiltDeg = v),
  (v) => `${v}°`,
);
bindRange(
  'shift',
  'shiftV',
  (v) => (state.offsetMm = v),
  (v) => `${v} mm`,
);
bindRange(
  'rot',
  'rotV',
  (v) => (state.rotDeg = v),
  (v) => `${v}°`,
);
bindRange(
  'press',
  'pressV',
  (v) => (state.press = v / 100),
  (v) => `${v}%`,
);
bindRange(
  'gain',
  'gainV',
  (v) => set('gainDb', v),
  (v) => `${v} dB`,
);
bindRange(
  'depth',
  'depthV',
  (v) => set('depthMm', v),
  (v) => `${v} mm`,
);
bindRange(
  'focus',
  'focusV',
  (v) => set('focusMm', v),
  (v) => `${v} mm`,
);
bindRange(
  'dr',
  'drV',
  (v) => set('dynamicRangeDb', v),
  (v) => `${v} dB`,
);
bindRange(
  'prf',
  'prfV',
  (v) => set('prfHz', v),
  (v) => `${v} Hz`,
);
bindRange(
  'gate',
  'gateV',
  (v) => set('gateMm', v),
  (v) => `${v} mm`,
);
bindRange(
  'wf',
  'wfV',
  (v) => set('wallFilterHz', v),
  (v) => `${v} Hz`,
);
bindRange(
  'ang',
  'angV',
  (v) => set('angleCorrectionDeg', v),
  (v) => `${v}°`,
);
bindRange(
  'base',
  'baseV',
  (v) => set('baseline', v),
  (v) => `${Math.round(v * 100)}%`,
);

function set<K extends keyof AcquisitionSettings>(k: K, v: number): void {
  (state.settings as Record<K, number>)[k] = v as never;
}

function setStation(station: Station, side: Side): void {
  state.station = station;
  state.side = side;
  state.settings = station === 'ojo' ? defaultEyeSettings() : defaultTemporalSettings();
  ($('depth') as HTMLInputElement).value = String(state.settings.depthMm);
  ($('gain') as HTMLInputElement).value = String(state.settings.gainDb);
  ($('focus') as HTMLInputElement).value = String(state.settings.focusMm);
  ($('dr') as HTMLInputElement).value = String(state.settings.dynamicRangeDb);
  ($('prf') as HTMLInputElement).value = String(state.settings.prfHz);
  ($('gate') as HTMLInputElement).value = String(state.settings.gateMm);
  ($('wf') as HTMLInputElement).value = String(state.settings.wallFilterHz);
  ($('ang') as HTMLInputElement).value = String(state.settings.angleCorrectionDeg);
  ($('base') as HTMLInputElement).value = String(state.settings.baseline);
  for (const el of document.querySelectorAll('.tab')) {
    const t = el as HTMLElement;
    t.classList.toggle('on', t.dataset.station === station && t.dataset.side === side);
  }
  document
    .querySelectorAll('.pwonly')
    .forEach((e) => ((e as HTMLElement).style.opacity = station === 'temporal' ? '1' : '0.4'));
  pwOn = false;
  $('pw').classList.remove('on');
  ($('cine') as HTMLButtonElement).disabled = true;
  cine.length = 0;
  frozen = false;
  $('freeze').textContent = 'Congelar Esp';
  $('hint').textContent =
    station === 'ojo'
      ? 'DVNO: activa «DVNO 3 mm» y marca los dos bordes de la vaina a 3 mm retroglobo.'
      : 'PW: activa, haz clic en el B-mode para poner la puerta y ajusta PRF/filtro/ángulo.';
}

document.querySelectorAll('.tab').forEach((el) => {
  el.addEventListener('click', () => {
    const t = el as HTMLElement;
    setStation(t.dataset.station as Station, t.dataset.side as Side);
  });
});

$('freeze').addEventListener('click', toggleFreeze);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    toggleFreeze();
  } else if (e.key === 'p') $('pw').click();
  else if (e.key === 'c') $('caliper').click();
});

function toggleFreeze(): void {
  frozen = !frozen;
  $('freeze').textContent = frozen ? 'Reanudar' : 'Congelar';
  $('freeze').classList.toggle('on', frozen);
  ($('cine') as HTMLButtonElement).disabled = !frozen || cine.length < 2;
}

$('cine').addEventListener('click', () => {
  cinePlaying = !cinePlaying;
  $('cine').classList.toggle('on', cinePlaying);
});

$('pw').addEventListener('click', () => {
  if (state.station !== 'temporal') return;
  pwOn = !pwOn;
  $('pw').classList.toggle('on', pwOn);
  if (pwOn) {
    const c = ensureChain();
    c.reset();
    lastPrf = -1; // fuerza re-begin en el siguiente paso
  }
});

let audioOn = false;
$('audio').addEventListener('click', () => {
  if (!audio) audio = new DopplerAudio();
  audioOn = !audioOn;
  audio.setMuted(!audioOn);
  $('audio').classList.toggle('on', audioOn);
});

$('caliper').addEventListener('click', () => {
  caliperMode = caliperMode === 'dist' ? 'none' : 'dist';
  $('caliper').classList.toggle('on', caliperMode === 'dist');
  if (caliperMode === 'dist') $('dvno').classList.remove('on');
  caliperPts = [];
});

$('dvno').addEventListener('click', () => {
  caliperMode = caliperMode === 'dvno' ? 'none' : 'dvno';
  $('dvno').classList.toggle('on', caliperMode === 'dvno');
  if (caliperMode === 'dvno') $('caliper').classList.remove('on');
  caliperPts = [];
});

bmodeCv.addEventListener('click', (e) => {
  const r = bmodeCv.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * bmodeCv.width;
  const y = ((e.clientY - r.top) / r.height) * bmodeCv.height;
  const pt = canvasToImagePoint(x, y);
  if (pwOn && state.station === 'temporal') {
    gateDepthMm = pt.z;
    gateUMm = pt.u;
    return;
  }
  if (caliperMode === 'none' || !currentFrame) return;
  caliperPts.push(pt);
  if (caliperPts.length === 2) {
    const m = recordDistance(currentFrame, state.side, caliperPts[0]!, caliperPts[1]!, {
      kind: caliperMode === 'dvno' ? 'dvno' : 'distancia',
      convention: caliperMode === 'dvno' ? 'interno' : undefined,
      referenceOffsetMm: caliperMode === 'dvno' ? NEURO_PARAMS.params.onsdOffsetMm.value : undefined,
    });
    measurements.push(m);
  }
});

$('export').addEventListener('click', () => {
  const a = document.createElement('a');
  a.download = `neurosono-${state.station}-${state.side}-${Date.now()}.png`;
  a.href = bmodeCv.toDataURL('image/png');
  a.click();
  const data = JSON.stringify(
    {
      case: sim.patient.label,
      seed: sim.patient.seed,
      measurements,
      settings: state.settings,
    },
    null,
    2,
  );
  const blob = new Blob([data], { type: 'application/json' });
  const a2 = document.createElement('a');
  a2.download = `neurosono-medidas-${Date.now()}.json`;
  a2.href = URL.createObjectURL(blob);
  a2.click();
});

// position pad: arrastrar mueve la sonda (offset + tilt según eje)
pospad.addEventListener('pointermove', (e) => {
  if (e.buttons !== 1) return;
  const r = pospad.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  state.offsetMm = (x - 0.5) * 36;
  state.tiltDeg = (y - 0.5) * 70;
  ($('shift') as HTMLInputElement).value = String(state.offsetMm);
  ($('tilt') as HTMLInputElement).value = String(state.tiltDeg);
  $('shiftV').textContent = `${state.offsetMm.toFixed(0)} mm`;
  $('tiltV').textContent = `${state.tiltDeg.toFixed(0)}°`;
});

setStation('ojo', 'der');
requestAnimationFrame(frameLoop);
