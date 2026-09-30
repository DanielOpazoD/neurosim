/**
 * Ayudas de presentación para canvas, espectro y lecturas del panel.
 * No contiene adquisición ni estado físico propio.
 */
import { trueOnsdMm } from '../anatomy/eye';
import { BONE_RIDGES, diencephalonShapes } from '../anatomy/head';
import { cross, dot, normalize, sub, type Vec3 } from '../core/vec3';
import type { ReferenceCase } from '../domain/referenceCase';
import type { AcquiredFrame } from '../domain/contracts';
import { drawSpectrum } from './canvasDraw';
import type { ScanGeometry } from '../ultrasound/probe';
import { imageToPatient, LINEAR_APERTURE_MM, patientToImage } from '../ultrasound/probe';
import { currentPose } from '../app/poses';
import { imagingMode, type AppState, type SpectralMark } from '../app/state';
import { spectralGeometry, spectralPointToPixel, type SpectralGeometry } from './spectrogramRaster';
import {
  imagePointToCanvas,
  canvasToImagePoint,
  dteGuide,
  dvnoReference,
  entryVisible,
  formatMeasurementMm,
  manualResistanceIndex,
  measurementDistance,
} from '../app/measurements';
import type { ImagePoint } from '../domain/measure';
import { buildReport } from '../domain/onsdProtocol';
import type { PwController } from '../app/pwController';
import { angleCorrectionErrorFactor } from '../doppler/insonation';
import { acousticOutput } from '../ultrasound/acousticOutput';
import { lindegaardInterpretation, observedTrace } from '../doppler/measureMca';
import { DOPPLER } from '../doppler/params';

export { canvasToImagePoint, imagePointToCanvas };

/** Contorno de la caja de Doppler color (sector: arcos+radiales; lineal: rectángulo). */
export function drawColorBox(
  ctx: CanvasRenderingContext2D,
  s: AppState,
  box: { uCenter: number; uHalf: number; zMinMm: number; zMaxMm: number },
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const uMin = box.uCenter - box.uHalf;
  const uMax = box.uCenter + box.uHalf;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (s.settings.transducer === 'linear') {
    const x0 = (uMin / LINEAR_APERTURE_MM + 0.5) * W;
    const x1 = (uMax / LINEAR_APERTURE_MM + 0.5) * W;
    const y0 = (box.zMinMm / s.settings.depthMm) * H;
    const y1 = (box.zMaxMm / s.settings.depthMm) * H;
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  } else {
    const cx = W / 2;
    const scalePx = Math.min(H * 1.15, Math.hypot(W / 2, H)) / s.settings.depthMm;
    const px = (u: number, z: number): [number, number] => [
      cx + Math.sin(u) * z * scalePx,
      Math.cos(u) * z * scalePx,
    ];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const u = uMin + (i / steps) * (uMax - uMin);
      const [x, y] = px(u, box.zMinMm);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    {
      const [x1, y1] = px(uMax, box.zMaxMm);
      ctx.lineTo(x1, y1);
    }
    for (let i = steps; i >= 0; i--) {
      const u = uMin + (i / steps) * (uMax - uMin);
      const [x, y] = px(u, box.zMaxMm);
      ctx.lineTo(x, y);
    }
    const [x0, y0] = px(uMin, box.zMinMm);
    ctx.lineTo(x0, y0);
  }
  ctx.stroke();
}

export function drawGateMarker(
  ctx: CanvasRenderingContext2D,
  sim: ReferenceCase,
  s: AppState,
  scan: ScanGeometry,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const pose = currentPose(sim, s);
  const center = imageToPatient(pose, scan.kind, s.gateUMm, s.gateDepthMm);
  const { u, z } = patientToImage(pose, scan.kind, center);
  if (scan.kind === 'linear') {
    const x = (u / scan.widthMmOrRad + 0.5) * W;
    const y = (z / s.settings.depthMm) * H;
    ctx.strokeStyle = 'rgba(80,190,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.strokeRect(x - 8, y - 6, 16, 12);
  } else {
    const scalePx = Math.min(H * 1.15, Math.hypot(W / 2, H)) / s.settings.depthMm;
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

/** Estado de interacción del calibre que se dibuja (DEC-61; lo mantiene `CaliperTool`). */
export interface CaliperView {
  /** Medición en curso: punto A y cursor (banda elástica A→cursor). */
  readonly pending: { readonly a: ImagePoint; readonly cursor: ImagePoint | null } | null;
  /** Entrada bajo el cursor y, si procede, su extremo. */
  readonly hoverId: number | null;
  readonly hoverEnd: 'a' | 'b' | null;
  /** Entrada seleccionada (clic en la línea o en la lista). */
  readonly selectedId: number | null;
  /** Entrada cuyo extremo se arrastra. */
  readonly editingId: number | null;
  /** Punto (px de canvas) donde actuó el imán de la referencia DVNO. */
  readonly snapPx: readonly [number, number] | null;
  /** Cursor actual sobre el canvas (px) para la cruz de precisión y la lupa. */
  readonly cursorPx: readonly [number, number] | null;
}

const CALIPER_COLOR = '#ffd24a';
const CALIPER_HOT = '#fff4b8';
const REF_COLOR = 'rgba(77,163,255,0.85)';

/** Trazo de medición con marcas perpendiculares de 8 px en los extremos. */
function caliperStroke(
  ctx: CanvasRenderingContext2D,
  a: [number, number],
  b: [number, number],
  color: string,
  width: number,
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * 4;
  const ny = (dx / len) * 4;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  for (const p of [a, b]) {
    ctx.moveTo(p[0] - nx, p[1] - ny);
    ctx.lineTo(p[0] + nx, p[1] + ny);
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}

/** Rótulo con fondo oscuro, recortado al canvas. */
function caliperLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  ctx.font = '11px sans-serif';
  const w = ctx.measureText(text).width + 8;
  const h = 15;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const lx = Math.min(W - w - 2, Math.max(2, x));
  const ly = Math.min(H - h - 2, Math.max(2, y - h / 2));
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(lx, ly, w, h);
  ctx.fillStyle = color;
  ctx.fillText(text, lx + 4, ly + 11);
}

/**
 * Capa de calibre (DEC-61): referencia DVNO a 3 mm (perpendicular al eje del
 * nervio), mediciones confirmadas visibles con número, rótulo y valor,
 * resaltado de la entrada bajo el cursor/seleccionada, banda elástica con la
 * distancia en vivo y el indicador del imán.
 */
export function drawCaliperOverlay(
  ctx: CanvasRenderingContext2D,
  sim: ReferenceCase,
  s: AppState,
  view: CaliperView,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const px = (p: ImagePoint) => imagePointToCanvas(p, s, W, H);
  if (s.caliperMode === 'dvno' && s.station === 'ojo' && s.currentFrame) {
    const ref = dvnoReference(sim, s);
    const a = px(ref.a);
    const b = px(ref.b);
    ctx.strokeStyle = REF_COLOR;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    const c = px(ref.center);
    ctx.fillStyle = REF_COLOR;
    ctx.beginPath();
    ctx.arc(c[0], c[1], 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '10px sans-serif';
    ctx.fillText('3 mm retroglobo', Math.max(a[0], b[0]) + 6, Math.min(a[1], b[1]) + 4);
  }
  for (const entry of s.caliperEntries) {
    if (!entryVisible(entry, s)) continue;
    const hot = entry.id === view.hoverId || entry.id === view.selectedId || entry.id === view.editingId;
    const a = px(entry.a);
    const b = px(entry.b);
    caliperStroke(ctx, a, b, hot ? CALIPER_HOT : CALIPER_COLOR, hot ? 2 : 1.25);
    if (entry.id === view.hoverId && view.hoverEnd) {
      const e = view.hoverEnd === 'a' ? a : b;
      ctx.strokeStyle = CALIPER_HOT;
      ctx.beginPath();
      ctx.arc(e[0], e[1], 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Número + rótulo + valor junto al extremo lejano (B), hacia fuera.
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const value = formatMeasurementMm(entry.measurement.kind, entry.measurement.value);
    const text =
      entry.measurement.kind === 'distancia'
        ? `${entry.id} · ${value}`
        : `${entry.id} · ${entry.tag} ${value}`;
    caliperLabel(
      ctx,
      text,
      b[0] + (dx / len) * 8 + (dx < 0 ? -8 : 2),
      b[1] + (dy / len) * 8,
      hot ? CALIPER_HOT : CALIPER_COLOR,
    );
  }
  const pending = view.pending;
  if (pending) {
    const a = px(pending.a);
    ctx.strokeStyle = CALIPER_COLOR;
    ctx.beginPath();
    ctx.moveTo(a[0] - 5, a[1]);
    ctx.lineTo(a[0] + 5, a[1]);
    ctx.moveTo(a[0], a[1] - 5);
    ctx.lineTo(a[0], a[1] + 5);
    ctx.stroke();
    if (pending.cursor && s.currentFrame) {
      const b = px(pending.cursor);
      caliperStroke(ctx, a, b, CALIPER_COLOR, 1.5);
      const kind = s.caliperMode === 'dvno' ? 'dvno' : s.caliperMode === 'dte' ? 'dte' : 'distancia';
      const mm = measurementDistance(s.currentFrame, pending.a, pending.cursor);
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      // Rótulo flotante junto al punto medio, desplazado 12 px en la normal.
      caliperLabel(
        ctx,
        formatMeasurementMm(kind, mm),
        mx + (-(b[1] - a[1]) / len) * 12 + 4,
        my + ((b[0] - a[0]) / len) * 12,
        CALIPER_COLOR,
      );
    }
  }
  if (view.editingId !== null) {
    const entry = s.caliperEntries.find((e) => e.id === view.editingId);
    if (entry) {
      const a = px(entry.a);
      const b = px(entry.b);
      const mm = measurementDistance(entry.frame, entry.a, entry.b);
      caliperLabel(
        ctx,
        formatMeasurementMm(entry.measurement.kind, mm),
        (a[0] + b[0]) / 2 + 10,
        (a[1] + b[1]) / 2 - 10,
        CALIPER_HOT,
      );
    }
  }
  if (view.snapPx) {
    const [x, y] = view.snapPx;
    ctx.strokeStyle = '#8fd3ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 6);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  if (view.cursorPx && s.caliperMode !== 'none') drawCaliperMagnifier(ctx, view.cursorPx);
}

/** Radio de la burbuja de la lupa y lado de la región de origen (px). */
const MAG_RADIUS_PX = 42;
const MAG_SRC_HALF_PX = 14;

/**
 * Cursor de precisión y lupa (DEC-61): cruz fina bajo el puntero y burbuja
 * circular ×3 (R/SRC) con la región vecina, copiada del propio canvas — el
 * B-mode ya está compuesto ahí en las rutas CPU y GPU. Se dibuja la última
 * para cubrir trazos y rótulos.
 */
function drawCaliperMagnifier(ctx: CanvasRenderingContext2D, cursorPx: readonly [number, number]): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const [cx, cy] = cursorPx;
  ctx.strokeStyle = 'rgba(255,210,74,0.85)';
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy);
  ctx.lineTo(cx + 6, cy);
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx, cy + 6);
  ctx.stroke();
  // Burbuja arriba-izquierda del cursor; si no cabe, al lado contrario.
  const bx =
    cx - MAG_RADIUS_PX - 26 >= 4 ? cx - MAG_RADIUS_PX - 26 : Math.min(W - 2 * MAG_RADIUS_PX - 4, cx + 26);
  const by =
    cy - MAG_RADIUS_PX - 26 >= 4 ? cy - MAG_RADIUS_PX - 26 : Math.min(H - 2 * MAG_RADIUS_PX - 4, cy + 26);
  const sx = Math.min(Math.max(0, cx - MAG_SRC_HALF_PX), W - 2 * MAG_SRC_HALF_PX);
  const sy = Math.min(Math.max(0, cy - MAG_SRC_HALF_PX), H - 2 * MAG_SRC_HALF_PX);
  ctx.save();
  ctx.beginPath();
  ctx.arc(bx + MAG_RADIUS_PX, by + MAG_RADIUS_PX, MAG_RADIUS_PX, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(bx, by, 2 * MAG_RADIUS_PX, 2 * MAG_RADIUS_PX);
  ctx.drawImage(
    ctx.canvas,
    sx,
    sy,
    2 * MAG_SRC_HALF_PX,
    2 * MAG_SRC_HALF_PX,
    bx,
    by,
    2 * MAG_RADIUS_PX,
    2 * MAG_RADIUS_PX,
  );
  ctx.restore();
  ctx.strokeStyle = CALIPER_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(bx + MAG_RADIUS_PX, by + MAG_RADIUS_PX, MAG_RADIUS_PX - 0.75, 0, Math.PI * 2);
  ctx.stroke();
  // Cruz en la posición ampliada del cursor (recolocada si el origen se recortó).
  const gx = bx + ((cx - sx) / (2 * MAG_SRC_HALF_PX)) * 2 * MAG_RADIUS_PX;
  const gy = by + ((cy - sy) / (2 * MAG_SRC_HALF_PX)) * 2 * MAG_RADIUS_PX;
  ctx.beginPath();
  ctx.moveTo(gx - 8, gy);
  ctx.lineTo(gx + 8, gy);
  ctx.moveTo(gx, gy - 8);
  ctx.lineTo(gx, gy + 8);
  ctx.stroke();
  ctx.lineWidth = 1;
}

export function drawScale(
  ctx: CanvasRenderingContext2D,
  sim: ReferenceCase,
  s: AppState,
  currentFrame: AcquiredFrame | null,
): void {
  const H = ctx.canvas.height;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px monospace';
  for (let mm = 10; mm < s.settings.depthMm; mm += 10) {
    const y = (mm / s.settings.depthMm) * H;
    ctx.fillRect(4, y, 6, 1);
    ctx.fillText(`${mm} mm`, 12, y + 3);
  }
  if (s.station !== 'ojo' || !currentFrame) return;
  if (s.caliperMode === 'dte') {
    const [a, b] = dteGuide(sim, s);
    const [x1, y1] = imagePointToCanvas(a, s, ctx.canvas.width, ctx.canvas.height);
    const [x2, y2] = imagePointToCanvas(b, s, ctx.canvas.width, ctx.canvas.height);
    ctx.strokeStyle = 'rgba(77,163,255,0.8)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(77,163,255,0.9)';
    ctx.fillText(`DTE ${s.side}`, x1 + 8, y1 - 4);
  }
  // La referencia DVNO a 3 mm se dibuja en la capa de calibre (`drawCaliperOverlay`).
}

/** Etiquetas docentes del plano diencefálico/mesencefálico sobre el B-mode
 * (III ventrículo, tálamos, pineal, mesencéfalo, alas esfenoidales). Solo si
 * el centro proyectado cae a ≤3 mm del plano de barrido en elevación. */
export function drawTeachingLandmarks(
  ctx: CanvasRenderingContext2D,
  sim: ReferenceCase,
  s: AppState,
  scan: ScanGeometry,
): void {
  if (!s.teachingMode || s.station !== 'temporal' || scan.kind !== 'sector') return;
  const h = sim.head;
  const pose = currentPose(sim, s);
  const fwd = normalize(pose.forward);
  const elev = normalize(cross(pose.lateral, fwd));
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const scalePx = Math.min(H * 1.15, Math.hypot(W / 2, H)) / s.settings.depthMm;
  const shapes = diencephalonShapes(h);
  const c = h.thirdVentricleCenter;
  const items: [string, Vec3][] = [
    ['III ventrículo', c],
    ['tálamo', shapes.thalami[0]!.center],
    ['tálamo', shapes.thalami[1]!.center],
    ['pineal', [c[0], c[1], c[2] - 7]],
    ['mesencéfalo', h.midbrainCenter],
  ];
  // Crestas óseas (N15b): se rotula el punto de la cresta más cercano al plano.
  for (const ridge of BONE_RIDGES) {
    let best: Vec3 | null = null;
    let bestD = Infinity;
    for (let i = 0; i + 1 < ridge.points.length; i++) {
      const a = ridge.points[i]!;
      const b = ridge.points[i + 1]!;
      for (let t = 0; t <= 1; t += 0.1) {
        const q: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const d = Math.abs(dot(sub(q, pose.origin), elev));
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    if (best) items.push([ridge.id === 'alaEsfenoidal' ? 'ala esfenoidal' : 'peñasco', best]);
  }
  ctx.font = '10px sans-serif';
  ctx.fillStyle = 'rgba(143,211,255,0.8)';
  for (const [label, p] of items) {
    const rel = sub(p, pose.origin);
    if (Math.abs(dot(rel, elev)) > 3) continue; // fuera del plano en elevación
    const zAxial = dot(rel, fwd);
    if (zAxial <= 0) continue;
    const uComp = dot(rel, pose.lateral);
    const r = Math.hypot(zAxial, uComp);
    if (r > s.settings.depthMm) continue;
    const u = Math.atan2(uComp, zAxial);
    const x = W / 2 + Math.sin(u) * r * scalePx;
    const y = Math.cos(u) * r * scalePx;
    if (x < 4 || x > W - 4 || y < 4 || y > H - 4) continue;
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(label, x + 4, y - 3);
  }
}

/** Tope de redibujado del espectrograma (DEC-55): 30 Hz. */
export const SPECTRAL_MIN_REDRAW_MS = 1000 / 30;
const spectralDrawn = new WeakMap<CanvasRenderingContext2D, { key: string; at: number }>();

/**
 * Espectrograma: se rasteriza solo si llegaron columnas nuevas o cambió algo
 * que afecta al dibujo (barrido, mapa, ganancia, línea de base, inversión…),
 * y como mucho a 30 Hz. Devuelve si redibujó.
 */
/** Vista que consume `drawSpectralMarks`: marcas de velocidad (DEC-62). */
export interface SpectralMarksView {
  /** Punto (t, v) en colocación, siguiendo al cursor hasta confirmar. */
  readonly pending: { readonly t: number; readonly vCms: number } | null;
  readonly hoverId: number | null;
  readonly selectedId: number | null;
  readonly editingId: number | null;
  readonly cursorPx: readonly [number, number] | null;
}

/** Marcas de velocidad sobre la traza: cruz, etiqueta con signo y resaltado. */
export function drawSpectralMarks(
  ctx: CanvasRenderingContext2D,
  marks: readonly SpectralMark[],
  view: SpectralMarksView | undefined,
  geom: SpectralGeometry,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const drawOne = (x: number, y: number, text: string, hot: boolean): void => {
    const color = hot ? CALIPER_HOT : CALIPER_COLOR;
    ctx.strokeStyle = color;
    ctx.lineWidth = hot ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x + 6, y);
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x, y + 6);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    caliperLabel(ctx, text, x + 8, y - 10, color);
  };
  const label = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)} cm/s`;
  for (const m of marks) {
    const p = spectralPointToPixel(m.tSeconds, m.velocityCms, W, H, geom);
    if (!p) continue;
    const hot = m.id === view?.hoverId || m.id === view?.selectedId || m.id === view?.editingId;
    drawOne(p[0], p[1], `${m.id} · ${label(m.velocityCms)}`, hot);
  }
  if (view?.pending) {
    const p = spectralPointToPixel(view.pending.t, view.pending.vCms, W, H, geom);
    if (p) drawOne(p[0], p[1], label(view.pending.vCms), true);
  }
}

export function drawSpectral(
  ctx: CanvasRenderingContext2D,
  sim: ReferenceCase,
  s: AppState,
  controller: PwController,
  now = performance.now(),
  marksView?: SpectralMarksView,
): boolean {
  const live = s.pwOn && controller.chainSceneKey === `${s.station}-${s.side}`;
  const marksKey = live
    ? s.spectralMarks.map((m) => `${m.id}@${m.tSeconds.toFixed(2)}=${m.velocityCms.toFixed(1)}`).join(',') +
      `|${marksView?.hoverId}|${marksView?.selectedId}|${marksView?.editingId}|${
        marksView?.pending ? `${marksView.pending.t.toFixed(2)}=${marksView.pending.vCms.toFixed(0)}` : ''
      }`
    : '';
  const key = live
    ? [
        'pw',
        controller.revision,
        ctx.canvas.width,
        ctx.canvas.height,
        s.settings.baseline,
        s.settings.frequencyMhz,
        s.settings.angleCorrectionDeg,
        s.settings.invertColor,
        s.settings.spectralGainDb,
        s.settings.dynamicRangeDb,
        s.settings.wallFilterHz,
        s.sweepSeconds,
        s.spectralColormap,
        s.teachingMode,
        marksKey,
      ].join('|')
    : `off|${s.pwOn}|${ctx.canvas.width}|${ctx.canvas.height}`;
  const last = spectralDrawn.get(ctx);
  if (last && last.key === key) return false;
  if (last && now - last.at < SPECTRAL_MIN_REDRAW_MS && now >= last.at) return false;
  spectralDrawn.set(ctx, { key, at: now });
  if (!live) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!s.pwOn) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '12px sans-serif';
      ctx.fillText('Activa PW para el espectro', 16, 24);
    }
    return true;
  }
  const columns = controller.columns;
  drawSpectrum(ctx, columns, {
    fftSize: controller.fftSize,
    baseline: s.settings.baseline,
    f0Mhz: s.settings.frequencyMhz,
    angleCorrectionDeg: s.settings.angleCorrectionDeg,
    invert: s.settings.invertColor,
    gainDb: s.settings.spectralGainDb,
    drDb: s.settings.dynamicRangeDb,
    floorOffsetDb: DOPPLER.params.spectralFloorOffsetDb.value,
    sweepSeconds: s.sweepSeconds,
    gamma: DOPPLER.params.spectralGammaDisplay.value,
    floorPercentile: DOPPLER.params.spectralFloorPercentile.value,
    colormap: s.spectralColormap,
    teachingTrace: s.teachingMode
      ? observedTrace(columns.slice(-400), {
          f0Hz: s.settings.frequencyMhz * 1e6,
          angleCorrectionRad: (s.settings.angleCorrectionDeg * Math.PI) / 180,
          invert: s.settings.invertColor,
          fftSize: controller.fftSize,
          wallFilterHz: s.settings.wallFilterHz,
        })
      : undefined,
  });
  const geom = spectralGeometry(
    columns,
    s.sweepSeconds,
    s.settings.baseline,
    s.settings.invertColor,
    s.settings.frequencyMhz,
    s.settings.angleCorrectionDeg,
  );
  if (geom && (s.spectralMarks.length || marksView?.pending)) {
    drawSpectralMarks(ctx, s.spectralMarks, marksView, geom);
  }
  return true;
}

/** Mosaico de medidas (DEC-53): `k` etiqueta, `v` valor grande, `unit` en
 * pequeño; `wide` ocupa las dos columnas para texto largo. La etiqueta y el
 * valor quedan en líneas distintas de `innerText` (lo leen las pruebas e2e). */
const row = (k: string, v: string, opts: { unit?: string; wide?: boolean; warn?: boolean } = {}) => {
  const cls = ['stat', opts.wide ? 'wide' : '', opts.warn ? 'warn' : ''].filter(Boolean).join(' ');
  const unit = opts.unit ? ` <small>${opts.unit}</small>` : '';
  return `<div class="${cls}"><span class="k">${k}</span><span class="v">${v}${unit}</span></div>`;
};
const wide = (k: string, v: string) => row(k, v, { wide: true });

const lastHtml = new WeakMap<HTMLElement, string>();
/** Escribe `innerHTML` solo si el marcado cambió (evita relayout por rAF). */
export function setHtml(el: HTMLElement, html: string): void {
  if (lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  el.innerHTML = html;
}

export function updateReadouts(
  el: HTMLElement,
  sim: ReferenceCase,
  s: AppState,
  controller: PwController,
): void {
  const summary = controller.latestMcaMeasure();
  const angle = s.teachingMode ? controller.insonation() : null;
  const angleRows =
    angle && angle.vesselId && Number.isFinite(angle.realDeg)
      ? [
          wide(
            'Insonación',
            `θ real ${angle.realDeg.toFixed(0)}° · proyectado ${angle.projectedDeg.toFixed(0)}° · corrección ${s.settings.angleCorrectionDeg.toFixed(0)}° → factor ×${angleCorrectionErrorFactor(angle.realDeg, s.settings.angleCorrectionDeg).toFixed(2)}`,
          ),
        ]
      : [];
  const hemo = s.teachingMode ? controller.hemodynamics() : null;
  const hemoRows = hemo
    ? [
        wide(
          'Hemodinámica',
          `PPC ${hemo.cppMmHg.toFixed(0)} · CrCP ${hemo.crcpMmHg.toFixed(0)} · flujo ×${hemo.flowFactor.toFixed(2)} · PI esp. ${hemo.expectedPi.toFixed(2)}`,
        ),
      ]
    : [];
  const alara = acousticOutput({
    transducer: s.settings.transducer,
    station: s.station,
    mode: imagingMode(s),
    frequencyMhz: s.settings.frequencyMhz,
    focusMm: s.settings.focusMm,
    prfHz: s.settings.prfHz,
    gateMm: s.settings.gateMm,
    outputPowerDb: s.settings.outputPowerDb,
  });
  const alaraRows =
    s.teachingMode && alara.ocularLimitExceeded
      ? [row('ALARA', 'supera límite oftálmico (MI ≤ 0,23 · TI ≤ 1,0)', { wide: true, warn: true })]
      : [];
  const report = buildReport(s.onsd);
  const reportRows =
    s.station === 'ojo' && (s.onsdActive || report.complete)
      ? [
          wide(
            'Protocolo DVNO',
            s.onsdActive
              ? s.caliperMode === 'dte'
                ? `DTE ${s.side}`
                : `${s.side} · ${planeForLabel(s.rotDeg)}`
              : 'completo',
          ),
          wide(
            'Informe',
            report.complete
              ? `ratio ${((report.perSide.der.ratio! + report.perSide.izq.ratio!) / 2).toFixed(2)}`
              : `faltan ${report.flags.includes('plano-incompleto') ? 'DVNO' : 'DTE'}`,
          ),
          ...(s.teachingMode
            ? [
                wide(
                  'DVNO real (modelo)',
                  `der ${trueOnsdMm(sim.eyes.der, 3, 'interno').toFixed(2)} · izq ${trueOnsdMm(sim.eyes.izq, 3, 'interno').toFixed(2)} mm`,
                ),
              ]
            : []),
          ...(s.onsdWarning
            ? [row('Aviso', 'Plano/lado no coincide con el paso del protocolo', { wide: true, warn: true })]
            : []),
        ]
      : [];
  if (summary) {
    const comp = controller.composition();
    setHtml(
      el,
      [
        row('PSV', `${Math.abs(summary.psvCms).toFixed(0)}`, { unit: 'cm/s' }),
        row('EDV', `${Math.abs(summary.edvCms).toFixed(0)}`, { unit: 'cm/s' }),
        row('TAMax', `${Math.abs(summary.taMaxCms).toFixed(0)}`, { unit: 'cm/s' }),
        row('PI (Gosling)', summary.pi.toFixed(2)),
        row('IR', summary.ri.toFixed(2)),
        row('Latidos', `${summary.beats}`),
        row('Sangre en puerta', `${((comp?.bloodFraction ?? 0) * 100).toFixed(0)}`, { unit: '%' }),
        wide('Vaso dominante', comp?.dominantVesselId ?? '—'),
        ...lindegaardRows(s, controller),
        ...spectralDerivedRows(s),
        ...angleRows,
        ...hemoRows,
        ...alaraRows,
        ...reportRows,
      ].join(''),
    );
    return;
  }
  if (s.measurements.length) {
    const last = s.measurements[s.measurements.length - 1]!;
    const label =
      last.kind === 'dvno'
        ? `DVNO ${last.convention ?? ''}`
        : last.kind === 'dte'
          ? 'DTE'
          : last.kind === 'trazado-espectral'
            ? 'Velocidad'
            : 'Distancia';
    setHtml(
      el,
      [
        row(label, last.unit === 'cm/s' ? last.value.toFixed(0) : last.value.toFixed(2), { unit: last.unit }),
        row('Cuadro', `t=${last.frameTSeconds.toFixed(2)}`, { unit: 's' }),
        row('Ref. retroglobo', `${last.referenceOffsetMm ?? '—'}`, { unit: 'mm' }),
        row('Medidas', `${s.measurements.length}`),
        ...spectralDerivedRows(s),
      ].join(''),
    );
  } else {
    setHtml(el, [...angleRows, ...hemoRows, ...alaraRows, ...reportRows, row('Sin medidas', '—')].join(''));
  }
}

/**
 * Índices derivados de las marcas espectrales (DEC-62): con ≥ 2 marcas del
 * mismo signo, IR = (|PSV| − |EDV|) / |PSV| con la mayor y la menor |v| —
 * el equivalente manual del IR automático. Δt documenta la separación en la
 * traza (latido aproximado si las marcas están en el mismo ciclo).
 */
function spectralDerivedRows(s: AppState): string[] {
  const rows: string[] = [];
  for (const sign of [1, -1] as const) {
    const ri = manualResistanceIndex(s.spectralMarks, sign);
    if (!ri) continue;
    rows.push(
      wide(
        sign > 0 ? 'IR manual (+)' : 'IR manual (−)',
        `${ri.ri.toFixed(2)} = (${ri.psvCms.toFixed(0)} − ${ri.edvCms.toFixed(0)}) / ${ri.psvCms.toFixed(0)} · Δt ${ri.deltaTs.toFixed(1)} s`,
      ),
    );
  }
  return rows;
}

/**
 * Filas del Lindegaard (DEC-58). Temporal con la puerta en M1: índice con la
 * ACI medida del mismo lado («ACI medida») o, si falta, con la de referencia
 * del caso. Submandibular con la puerta en la ACI: TAMax guardada para el
 * índice de ese lado.
 */
function lindegaardRows(s: AppState, controller: PwController): string[] {
  const li = controller.lindegaard();
  if (li) {
    const label = li.icaSource === 'medida' ? 'ACI medida' : 'ACI de referencia';
    return [
      row(
        `Lindegaard · ${label}`,
        `TAMax ACM ${li.mcaTaMaxCms.toFixed(0)} / ACI ${li.icaTaMaxCms.toFixed(0)} = ${li.ratio.toFixed(1)}`,
        { wide: true, warn: li.ratio >= 3 },
      ),
      wide('Interpretación', lindegaardInterpretation(li.ratio)),
    ];
  }
  const ica = s.station === 'submandibular' ? controller.measuredIca(s.side) : null;
  if (ica && controller.composition()?.dominantVesselId?.startsWith('aci-')) {
    return [wide('ACI medida', `TAMax ${ica.taMaxCms.toFixed(0)} cm/s → Lindegaard ${s.side}`)];
  }
  return [];
}

function planeForLabel(rotDeg: number): string {
  const mod = ((rotDeg % 180) + 180) % 180;
  return mod < 45 || mod >= 135 ? 'transversal' : 'sagital';
}
