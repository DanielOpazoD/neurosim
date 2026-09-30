/**
 * Mediciones y conversiones de coordenadas de imagen.
 * La capa no dibuja: devuelve puntos y registra medidas en el estado.
 *
 * Herramienta de calibre (DEC-61): la geometría de la interacción (distancia
 * en vivo, extremo más cercano, imán a la referencia DVNO, restricción
 * perpendicular al nervio) vive aquí como funciones puras; `src/ui/caliperTool.ts`
 * solo traduce eventos de puntero y `src/ui/overlays.ts` dibuja.
 */
import { fromEyeLocal, nerveCenterline, sheathRadiiAt } from '../anatomy/eye';
import { add, scale } from '../core/vec3';
import type { AcquiredFrame, Measurement, Side, TransducerKind } from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import { caliperDistanceMm, recordDistance, type ImagePoint } from '../domain/measure';
import { ANATOMIA_OJO } from '../anatomy/params';
import { beamDirAt, LINEAR_APERTURE_MM, patientToImage, type ScanGeometry } from '../ultrasound/probe';
import { currentPose } from './poses';
import type { AppState, CaliperEntry, SpectralMark } from './state';
import {
  addProtocolMeasurement,
  nextSlot,
  planeForRotation,
  type OnsdKey,
  type OnsdPlane,
} from '../domain/onsdProtocol';

export function canvasToImagePoint(
  x: number,
  y: number,
  s: AppState,
  width: number,
  height: number,
): ImagePoint {
  if (s.settings.transducer === 'linear') {
    return { u: (x / width - 0.5) * LINEAR_APERTURE_MM, z: (y / height) * s.settings.depthMm };
  }
  const scalePx = Math.min(height * 1.15, Math.hypot(width / 2, height)) / s.settings.depthMm;
  return { u: Math.atan2(x - width / 2, y), z: Math.hypot(x - width / 2, y) / scalePx };
}

export function imagePointToCanvas(
  p: ImagePoint,
  s: AppState,
  width: number,
  height: number,
): [number, number] {
  if (s.settings.transducer === 'linear') {
    return [(p.u / LINEAR_APERTURE_MM + 0.5) * width, (p.z / s.settings.depthMm) * height];
  }
  const scalePx = Math.min(height * 1.15, Math.hypot(width / 2, height)) / s.settings.depthMm;
  return [width / 2 + Math.sin(p.u) * p.z * scalePx, Math.cos(p.u) * p.z * scalePx];
}

// ── Geometría pura de la herramienta de calibre (DEC-61) ─────────────────

/** Punto 2D (píxeles de canvas o mm del plano de imagen). */
export interface Pt2 {
  readonly x: number;
  readonly y: number;
}

/** Segmento con extremos `a`/`b` (píxeles de canvas). */
export interface Segment2 {
  readonly a: Pt2;
  readonly b: Pt2;
}

/** Distancia física (mm) entre dos puntos de imagen de un cuadro. */
export function measurementDistance(frame: AcquiredFrame, a: ImagePoint, b: ImagePoint): number {
  return caliperDistanceMm(frame, a, b);
}

/** Decimales del valor mostrado: DVNO 2 (centésimas), distancia/DTE 1. */
export function formatMeasurementMm(kind: Measurement['kind'], mm: number): string {
  return `${mm.toFixed(kind === 'dvno' ? 2 : 1)} mm`;
}

/**
 * Extremo más cercano a `point` entre los segmentos, a ≤ `tolPx` (empate:
 * el primero). Devuelve el índice del segmento y qué extremo.
 */
export function nearestEndpoint(
  segments: readonly Segment2[],
  point: Pt2,
  tolPx: number,
): { index: number; end: 'a' | 'b'; distPx: number } | null {
  let best: { index: number; end: 'a' | 'b'; distPx: number } | null = null;
  segments.forEach((seg, index) => {
    for (const end of ['a', 'b'] as const) {
      const q = seg[end];
      const d = Math.hypot(q.x - point.x, q.y - point.y);
      if (d <= tolPx && (!best || d < best.distPx)) best = { index, end, distPx: d };
    }
  });
  return best;
}

/** Proyección de `p` sobre el segmento ab (parámetro t ∈ [0,1] y punto). */
function projectOnSegment(p: Pt2, a: Pt2, b: Pt2): { t: number; q: Pt2 } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const den = dx * dx + dy * dy;
  const t = den < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den));
  return { t, q: { x: a.x + dx * t, y: a.y + dy * t } };
}

/** Segmento más cercano a `point` (distancia al trazo) a ≤ `tolPx`. */
export function nearestSegment(
  segments: readonly Segment2[],
  point: Pt2,
  tolPx: number,
): { index: number; distPx: number } | null {
  let best: { index: number; distPx: number } | null = null;
  segments.forEach((seg, index) => {
    const { q } = projectOnSegment(point, seg.a, seg.b);
    const d = Math.hypot(q.x - point.x, q.y - point.y);
    if (d <= tolPx && (!best || d < best.distPx)) best = { index, distPx: d };
  });
  return best;
}

/**
 * Imán a la línea de referencia: si `point` está a ≤ `tolPx` del segmento
 * `refLine`, devuelve su proyección sobre él (`snapped` = true); si no, el
 * punto tal cual.
 */
export function snapToReference(
  point: Pt2,
  refLine: Segment2,
  tolPx: number,
): { point: Pt2; snapped: boolean } {
  const { q } = projectOnSegment(point, refLine.a, refLine.b);
  if (Math.hypot(q.x - point.x, q.y - point.y) <= tolPx) return { point: q, snapped: true };
  return { point, snapped: false };
}

/**
 * Restringe b para que ab sea perpendicular a `axisDir` (quita a b − a su
 * componente sobre el eje). Opera en un marco cartesiano isótropo (mm del
 * plano de imagen), no en píxeles del canvas lineal (anisótropo).
 */
export function constrainPerpendicular(a: Pt2, b: Pt2, axisDir: Pt2): Pt2 {
  const n = Math.hypot(axisDir.x, axisDir.y);
  if (n < 1e-12) return b;
  const ux = axisDir.x / n;
  const uy = axisDir.y / n;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const along = dx * ux + dy * uy;
  return { x: b.x - along * ux, y: b.y - along * uy };
}

/** Punto de imagen → mm cartesianos del plano (x lateral, y axial). */
export function imagePointToPlaneMm(p: ImagePoint, kind: TransducerKind): Pt2 {
  return kind === 'linear' ? { x: p.u, y: p.z } : { x: p.z * Math.sin(p.u), y: p.z * Math.cos(p.u) };
}

/** Inversa de `imagePointToPlaneMm`. */
export function planeMmToImagePoint(p: Pt2, kind: TransducerKind): ImagePoint {
  return kind === 'linear' ? { u: p.x, z: p.y } : { u: Math.atan2(p.x, p.y), z: Math.hypot(p.x, p.y) };
}

/** Sentido corto del lado para rótulos: D / I. */
export const SIDE_SHORT: Record<Side, string> = { der: 'D', izq: 'I' };

/** Rótulo de una medición: «DVNO D transversal», «DTE I», «Distancia». */
export function measurementTag(kind: Measurement['kind'], side: Side, plane?: OnsdPlane): string {
  if (kind === 'dvno') return `DVNO ${SIDE_SHORT[side]} ${plane ?? 'transversal'}`;
  if (kind === 'dte') return `DTE ${SIDE_SHORT[side]}`;
  return 'Distancia';
}

/** Clave de pose/equipo: una medición en vivo se dibuja solo con la misma. */
export function caliperPoseKey(s: AppState): string {
  return [
    s.station,
    s.side,
    s.rotDeg,
    s.offsetMm,
    s.offsetVMm,
    s.tiltDeg,
    s.tiltVDeg,
    s.settings.transducer,
    s.settings.depthMm,
  ].join('|');
}

/** ¿Se dibuja la medición sobre la imagen actual? Mismo cuadro, o en vivo con la misma pose. */
export function entryVisible(entry: CaliperEntry, s: AppState): boolean {
  if (s.currentFrame && entry.frame === s.currentFrame) return true;
  return !s.frozen && entry.poseKey === caliperPoseKey(s);
}

/**
 * Referencia DVNO en la imagen (DEC-61): punto del nervio a 3 mm retroglobo,
 * dirección del eje del nervio (mm del plano, hacia posterior) y la línea
 * perpendicular a ese eje que cubre la vaina (±radio mayor + 2,5 mm). Se
 * proyecta con `patientToImage`, como la comprobación de centrado de la guía.
 */
export function dvnoReference(
  sim: ReferenceCase,
  s: AppState,
): { center: ImagePoint; axisDir: Pt2; a: ImagePoint; b: ImagePoint } {
  const eye = sim.eyes[s.side];
  const pose = currentPose(sim, s);
  const off = ANATOMIA_OJO.params.onsdOffsetMm.value;
  const at = (sMm: number) =>
    imagePointToPlaneMm(
      patientToImage(pose, 'linear', fromEyeLocal(eye, nerveCenterline(eye, sMm))),
      'linear',
    );
  const c = at(off);
  const p0 = at(off - 1.5);
  const p1 = at(off + 1.5);
  let axis = { x: p1.x - p0.x, y: p1.y - p0.y };
  const n = Math.hypot(axis.x, axis.y);
  // Nervio casi perpendicular al plano (p. ej. corte oblicuo): eje axial.
  axis = n < 1e-6 ? { x: 0, y: 1 } : { x: axis.x / n, y: axis.y / n };
  const half = sheathRadiiAt(eye, off).major + 2.5;
  const perp = { x: -axis.y, y: axis.x };
  return {
    center: planeMmToImagePoint(c, 'linear'),
    axisDir: axis,
    a: planeMmToImagePoint({ x: c.x - perp.x * half, y: c.y - perp.y * half }, 'linear'),
    b: planeMmToImagePoint({ x: c.x + perp.x * half, y: c.y + perp.y * half }, 'linear'),
  };
}

// ── Registro de mediciones ───────────────────────────────────────────────

/**
 * Confirma una medición A→B del modo de calibre activo sobre el cuadro
 * actual: la registra en `s.measurements`, crea su entrada dibujable y
 * avanza el protocolo DVNO (huecos, giro automático, DTE) como antes.
 */
export function commitMeasurement(
  sim: ReferenceCase,
  s: AppState,
  a: ImagePoint,
  b: ImagePoint,
): CaliperEntry | null {
  if (s.caliperMode === 'none' || !s.currentFrame) return null;
  const frame = s.currentFrame;
  const mode = s.caliperMode;
  const side = s.side;
  const poseKey = caliperPoseKey(s);
  const m = recordDistance(frame, side, a, b, {
    kind: mode === 'dvno' ? 'dvno' : mode === 'dte' ? 'dte' : 'distancia',
    convention: mode === 'dvno' ? 'interno' : undefined,
    referenceOffsetMm: mode === 'dvno' ? ANATOMIA_OJO.params.onsdOffsetMm.value : undefined,
  });
  s.measurements.push(m);
  let plane: OnsdPlane = planeForRotation(s.rotDeg);
  let onsdKey: OnsdKey | undefined;
  let dteSide: Side | undefined;
  if (mode === 'dvno' && s.onsdActive) {
    const slot = nextSlot(s.onsd);
    if (slot && slot.side === s.side && slot.plane === planeForRotation(s.rotDeg)) {
      plane = slot.plane;
      onsdKey = `${slot.side}-${slot.plane}`;
      s.onsd = addProtocolMeasurement(s.onsd, slot, m);
      const upcoming = nextSlot(s.onsd);
      if (upcoming) {
        s.side = upcoming.side;
        s.rotDeg = upcoming.plane === 'sagital' ? 90 : 0;
      } else {
        s.caliperMode = 'dte';
        s.side = s.onsd.dte.der ? 'izq' : 'der';
        s.rotDeg = 0;
      }
    } else {
      s.onsdWarning = true;
    }
  } else if (mode === 'dte' && s.onsdActive) {
    dteSide = s.side;
    s.onsd = { ...s.onsd, dte: { ...s.onsd.dte, [s.side]: m } };
    const nextSide = s.onsd.dte.der ? (s.onsd.dte.izq ? null : 'izq') : 'der';
    if (nextSide) s.side = nextSide;
    else s.caliperMode = 'none';
  }
  s.caliperPts = [];
  const entry: CaliperEntry = {
    id: s.caliperSeq++,
    measurement: m,
    a,
    b,
    frame,
    poseKey,
    tag: measurementTag(m.kind, side, plane),
    onsdKey,
    dteSide,
  };
  s.caliperEntries.push(entry);
  return entry;
}

/** Sustituye una medición por su versión editada en todas las listas del estado. */
function replaceMeasurement(s: AppState, prev: Measurement, next: Measurement): void {
  const i = s.measurements.indexOf(prev);
  if (i >= 0) s.measurements[i] = next;
  const dvno = { ...s.onsd.dvno };
  let changed = false;
  for (const key of Object.keys(dvno) as OnsdKey[]) {
    if (dvno[key] === prev) {
      dvno[key] = next;
      changed = true;
    }
  }
  const dte = { ...s.onsd.dte };
  for (const side of ['der', 'izq'] as const) {
    if (dte[side] === prev) {
      dte[side] = next;
      changed = true;
    }
  }
  if (changed) s.onsd = { ...s.onsd, dvno, dte };
}

/**
 * Mueve un extremo de una medición confirmada: recalcula la distancia sobre
 * SU cuadro y sustituye la `Measurement` (lista, protocolo DVNO/DTE).
 * Devuelve la medición anterior.
 */
export function editMeasurementEndpoint(
  s: AppState,
  entry: CaliperEntry,
  end: 'a' | 'b',
  point: ImagePoint,
): Measurement {
  const prev = entry.measurement;
  if (end === 'a') entry.a = point;
  else entry.b = point;
  const next = recordDistance(entry.frame, prev.side, entry.a, entry.b, {
    kind: prev.kind,
    convention: prev.convention,
    referenceOffsetMm: prev.referenceOffsetMm,
  });
  entry.measurement = next;
  replaceMeasurement(s, prev, next);
  return prev;
}

/** Borra una medición confirmada (entrada, lista y hueco de protocolo que ocupe). */
export function deleteMeasurement(s: AppState, entry: CaliperEntry): void {
  s.caliperEntries = s.caliperEntries.filter((e) => e !== entry);
  const m = entry.measurement;
  s.measurements = s.measurements.filter((x) => x !== m);
  const dvno = { ...s.onsd.dvno };
  for (const key of Object.keys(dvno) as OnsdKey[]) if (dvno[key] === m) delete dvno[key];
  const dte = { ...s.onsd.dte };
  for (const side of ['der', 'izq'] as const) if (dte[side] === m) delete dte[side];
  s.onsd = { ...s.onsd, dvno, dte };
}

// ── Marcas de velocidad sobre la traza espectral (DEC-62) ────────────────
// El mapeo píxel ↔ (t, cm/s) es de presentación y vive en
// `src/ui/spectralCaliper.ts`; aquí solo se registra el estado.

function recordSpectral(s: AppState, tSeconds: number, velocityCms: number): Measurement {
  return {
    kind: 'trazado-espectral',
    frameTSeconds: tSeconds,
    side: s.side,
    pointsMm: [],
    value: Math.abs(velocityCms),
    unit: 'cm/s',
  };
}

/** Registra una marca de velocidad en la traza y la devuelve. */
export function addSpectralMark(s: AppState, tSeconds: number, velocityCms: number): SpectralMark {
  const m = recordSpectral(s, tSeconds, velocityCms);
  const mark: SpectralMark = { id: s.caliperSeq++, tSeconds, velocityCms, measurement: m };
  s.spectralMarks.push(mark);
  s.measurements.push(m);
  return mark;
}

/** Reposiciona una marca: actualiza (t, v) y sustituye su `Measurement`. */
export function editSpectralMark(
  s: AppState,
  mark: SpectralMark,
  tSeconds: number,
  velocityCms: number,
): Measurement {
  const prev = mark.measurement;
  mark.tSeconds = tSeconds;
  mark.velocityCms = velocityCms;
  mark.measurement = recordSpectral(s, tSeconds, velocityCms);
  replaceMeasurement(s, prev, mark.measurement);
  return prev;
}

/** Borra una marca espectral (lista de marcas y de mediciones). */
export function deleteSpectralMark(s: AppState, mark: SpectralMark): void {
  s.spectralMarks = s.spectralMarks.filter((x) => x !== mark);
  s.measurements = s.measurements.filter((x) => x !== mark.measurement);
}

/**
 * Índice de resistencia manual a partir de las marcas espectrales (DEC-62):
 * con ≥ 2 marcas del mismo signo, IR = (|PSV| − |EDV|) / |PSV| tomando la
 * mayor y la menor |v|. Devuelve null si no hay par interpretable. Es el
 * equivalente manual del IR automático del controlador PW.
 */
export function manualResistanceIndex(
  marks: readonly SpectralMark[],
  sign: 1 | -1,
): { psvCms: number; edvCms: number; ri: number; deltaTs: number } | null {
  const same = marks.filter((m) => Math.sign(m.velocityCms) === sign);
  if (same.length < 2) return null;
  const hi = same.reduce((a, b) => (Math.abs(b.velocityCms) > Math.abs(a.velocityCms) ? b : a));
  const lo = same.reduce((a, b) => (Math.abs(b.velocityCms) < Math.abs(a.velocityCms) ? b : a));
  const psv = Math.abs(hi.velocityCms);
  const edv = Math.abs(lo.velocityCms);
  return { psvCms: psv, edvCms: edv, ri: (psv - edv) / psv, deltaTs: Math.abs(hi.tSeconds - lo.tSeconds) };
}

/** Clic a clic (compatibilidad): el segundo punto confirma la medición. */
export function addCaliperPoint(sim: ReferenceCase, s: AppState, point: ImagePoint): CaliperEntry | null {
  if (s.caliperMode === 'none' || !s.currentFrame) return null;
  s.caliperPts.push(point);
  if (s.caliperPts.length !== 2) return null;
  const [a, b] = s.caliperPts as [ImagePoint, ImagePoint];
  return commitMeasurement(sim, s, a, b);
}

export function gatePoint(s: AppState, pose: ReturnType<typeof currentPose>, scan: ScanGeometry): ImagePoint {
  const beamDir = beamDirAt(pose, scan.kind, s.gateUMm);
  const center = add(pose.origin, scale(beamDir, s.gateDepthMm));
  return patientToImage(pose, scan.kind, center);
}

export function dvnoGuide(sim: ReferenceCase, s: AppState): ImagePoint {
  const eye = sim.eyes[s.side];
  return patientToImage(
    currentPose(sim, s),
    'linear',
    fromEyeLocal(eye, nerveCenterline(eye, ANATOMIA_OJO.params.onsdOffsetMm.value)),
  );
}

export function dteGuide(sim: ReferenceCase, s: AppState): [ImagePoint, ImagePoint] {
  const eye = sim.eyes[s.side];
  const pose = currentPose(sim, { ...s, rotDeg: 0 });
  const a = fromEyeLocal(eye, [-eye.globeRadiusMm, 0, 0]);
  const b = fromEyeLocal(eye, [eye.globeRadiusMm, 0, 0]);
  return [patientToImage(pose, 'linear', a), patientToImage(pose, 'linear', b)];
}
