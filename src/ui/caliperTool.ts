/**
 * Herramienta de calibre (DEC-61): traduce gestos de puntero sobre el B-mode
 * a la geometría pura de `src/app/measurements.ts` y mantiene el
 * `CaliperView` que dibuja `drawCaliperOverlay`.
 *
 * Gestos (solo con un modo de calibre activo; si no, los eventos pasan a la
 * caja de color o a la puerta PW):
 *
 * - Arrastre: bajar el puntero fija A (con imán a la referencia DVNO), mover
 *   muestra la banda elástica y la distancia en vivo, soltar confirma.
 * - Clic a clic: un clic sin arrastre ancla A; el siguiente confirma B.
 * - Edición: bajar sobre un extremo (≤ 10 px) arrastra ese extremo; en modo
 *   DVNO el extremo libre se restringe perpendicular al eje del nervio.
 * - Selección: clic sobre la línea (≤ 8 px) o en la lista del panel;
 *   Supr/Retroceso borra la seleccionada. Escape cancela anclaje, edición
 *   y selección.
 *
 * La clase no conoce el DOM: trabaja en píxeles de canvas para ser probada
 * sin navegador. `src/ui/main.ts` convierte `PointerEvent.clientX/Y` a px y
 * decide a qué gesto da prioridad (calibre > caja de color > puerta PW).
 */
import type { ReferenceCase } from '../domain/referenceCase';
import type { Measurement } from '../domain/contracts';
import type { ImagePoint } from '../domain/measure';
import {
  canvasToImagePoint,
  commitMeasurement,
  constrainPerpendicular,
  deleteMeasurement,
  dvnoReference,
  editMeasurementEndpoint,
  entryVisible,
  imagePointToCanvas,
  imagePointToPlaneMm,
  nearestEndpoint,
  nearestSegment,
  planeMmToImagePoint,
  snapToReference,
  type Segment2,
} from '../app/measurements';
import type { AppState, CaliperEntry } from '../app/state';
import type { CaliperView } from './overlays';

/** Tolerancias de interacción en píxeles de canvas. */
export const CALIPER_ENDPOINT_TOL_PX = 10;
export const CALIPER_SEGMENT_TOL_PX = 8;
export const CALIPER_SNAP_TOL_PX = 8;
export const CALIPER_DRAG_MIN_PX = 4;

export interface CaliperHooks {
  /** Medición confirmada; `rotDegBefore` es la rotación antes de que el
   * protocolo DVNO gire el marcador. */
  onCommit?(entry: CaliperEntry, rotDegBefore: number): void;
  /** Arrastre de extremo terminado (`prev` = medición anterior al gesto). */
  onEdit?(entry: CaliperEntry, prev: Measurement): void;
  onDelete?(entry: CaliperEntry): void;
}

interface MutableCaliperView {
  pending: { a: ImagePoint; cursor: ImagePoint | null } | null;
  hoverId: number | null;
  hoverEnd: 'a' | 'b' | null;
  selectedId: number | null;
  editingId: number | null;
  snapPx: readonly [number, number] | null;
  cursorPx: readonly [number, number] | null;
}

type CaliperGesture = 'idle' | 'anchor' | 'placingB' | 'editing';

/** Lo mínimo que necesita la herramienta del canvas (tests: objeto literal). */
export interface CaliperSurface {
  readonly width: number;
  readonly height: number;
}

export class CaliperTool {
  /** Vista que consume `drawCaliperOverlay` cada fotograma. */
  readonly view: CaliperView;
  private readonly v: MutableCaliperView = {
    pending: null,
    hoverId: null,
    hoverEnd: null,
    selectedId: null,
    editingId: null,
    snapPx: null,
    cursorPx: null,
  };
  private gesture: CaliperGesture = 'idle';
  private dragging = false;
  private clickSuppressed = false;
  private editEnd: 'a' | 'b' = 'b';
  private editPrev: Measurement | null = null;
  private editOrigA: ImagePoint | null = null;
  private editOrigB: ImagePoint | null = null;
  private downX = 0;
  private downY = 0;

  constructor(
    private readonly sim: ReferenceCase,
    private readonly s: AppState,
    private readonly canvas: CaliperSurface,
    private readonly hooks: CaliperHooks = {},
  ) {
    this.view = this.v;
  }

  /** ¿La herramienta responde al puntero? (modo activo y un cuadro que medir). */
  get active(): boolean {
    return this.s.caliperMode !== 'none' && this.s.currentFrame !== null;
  }

  /** Cursor CSS sugerido para el canvas. */
  get domCursor(): string {
    if (!this.active) return '';
    if (this.gesture === 'editing' || this.v.hoverEnd) return 'grab';
    if (this.v.hoverId !== null) return 'pointer';
    return 'crosshair';
  }

  // ── Gestos de puntero (coordenadas en píxeles de canvas) ────────────────

  /** Botón principal abajo. Devuelve si el gesto es del calibre. */
  down(x: number, y: number): boolean {
    if (!this.active) return false;
    // Todo gesto consumido suprime el `click` DOM que lo cierra, incluidos
    // selección por clic y gestos luego cancelados con Escape (sin esta marca
    // el `click` colocaría una puerta PW espuria con `pwOn`).
    this.clickSuppressed = true;
    this.downX = x;
    this.downY = y;
    this.dragging = false;
    const segs = this.segments();
    const endHit = nearestEndpoint(
      segs.map((e) => e.seg),
      { x, y },
      CALIPER_ENDPOINT_TOL_PX,
    );
    if (endHit) {
      const entry = segs[endHit.index]!.entry;
      this.gesture = 'editing';
      this.editEnd = endHit.end;
      this.editPrev = entry.measurement;
      this.editOrigA = entry.a;
      this.editOrigB = entry.b;
      this.v.editingId = entry.id;
      this.v.selectedId = entry.id;
      this.v.pending = null;
      return true;
    }
    const segHit = nearestSegment(
      segs.map((e) => e.seg),
      { x, y },
      CALIPER_SEGMENT_TOL_PX,
    );
    if (segHit) {
      // Un anclaje previo se descarta: el clic fue sobre otra medición.
      this.v.pending = null;
      this.gesture = 'idle';
      this.v.selectedId = segs[segHit.index]!.entry.id;
      return true;
    }
    this.v.selectedId = null;
    if (this.v.pending) {
      // Segundo punto del clic a clic (soltar confirma; arrastrar afina B).
      this.gesture = 'placingB';
    } else {
      this.v.pending = { a: this.placedAnchor(x, y), cursor: null };
      this.gesture = 'anchor';
    }
    return true;
  }

  /** Movimiento del puntero (con o sin botón). Actualiza cursor, banda y hover. */
  move(x: number, y: number): void {
    if (!this.active) {
      this.v.cursorPx = null;
      this.v.hoverId = null;
      this.v.hoverEnd = null;
      return;
    }
    this.v.cursorPx = [x, y];
    if (this.gesture === 'editing') {
      const entry = this.s.caliperEntries.find((e) => e.id === this.v.editingId);
      if (entry) {
        const fixed = this.editEnd === 'a' ? entry.b : entry.a;
        editMeasurementEndpoint(this.s, entry, this.editEnd, this.constrainedEnd(fixed, x, y));
        this.dragging = true;
      }
      return;
    }
    const pending = this.v.pending;
    if (!pending) {
      this.updateHover(x, y);
      return;
    }
    if (this.gesture === 'anchor' && !this.dragging) {
      this.dragging = Math.hypot(x - this.downX, y - this.downY) >= CALIPER_DRAG_MIN_PX;
    }
    if (this.gesture !== 'anchor' || this.dragging) {
      pending.cursor = this.constrainedEnd(pending.a, x, y);
    }
  }

  /** Botón principal arriba. Devuelve si el gesto era del calibre. */
  up(x: number, y: number): boolean {
    if (!this.active) return false;
    if (this.gesture === 'editing') {
      const entry = this.s.caliperEntries.find((e) => e.id === this.v.editingId);
      const prev = this.editPrev;
      const moved = this.dragging;
      this.gesture = 'idle';
      this.v.editingId = null;
      this.editPrev = null;
      this.editOrigA = null;
      this.editOrigB = null;
      this.dragging = false;
      if (entry && prev && moved) this.hooks.onEdit?.(entry, prev);
      return true;
    }
    const pending = this.v.pending;
    if (this.gesture === 'placingB' && pending) {
      const b = this.constrainedEnd(pending.a, x, y);
      this.v.pending = null;
      this.gesture = 'idle';
      this.commit(pending.a, b);
      return true;
    }
    if (this.gesture === 'anchor' && pending) {
      if (this.dragging) {
        const b = this.constrainedEnd(pending.a, x, y);
        this.v.pending = null;
        this.gesture = 'idle';
        this.commit(pending.a, b);
      } else {
        // Clic sin arrastre: A queda anclado y la banda sigue al ratón.
        this.gesture = 'idle';
      }
      return true;
    }
    return true;
  }

  /**
   * El `click` que cierra un gesto de calibre no debe disparar la puerta PW
   * ni un `addCaliperPoint` residual: `main` lo consulta y lo consume aquí.
   */
  consumeClick(): boolean {
    const c = this.clickSuppressed;
    this.clickSuppressed = false;
    return c;
  }

  /** Puntero fuera del canvas: se ocultan cursor y hover (el anclaje queda). */
  leave(): void {
    this.v.cursorPx = null;
    this.v.hoverId = null;
    this.v.hoverEnd = null;
    this.v.snapPx = null;
  }

  /** Supr/Retroceso borra la seleccionada; Escape cancela lo pendiente. */
  key(key: string): boolean {
    if (key === 'Escape') {
      if (this.v.editingId !== null) {
        // La edición ya movió los extremos en vivo: se restauran los originales.
        const entry = this.s.caliperEntries.find((e) => e.id === this.v.editingId);
        if (entry && this.editOrigA && this.editOrigB) {
          editMeasurementEndpoint(this.s, entry, 'a', this.editOrigA);
          editMeasurementEndpoint(this.s, entry, 'b', this.editOrigB);
        }
        this.reset();
        return true;
      }
      if (this.v.pending || this.v.selectedId !== null) {
        this.reset();
        return true;
      }
      return false;
    }
    if ((key === 'Delete' || key === 'Backspace') && this.v.selectedId !== null) {
      this.remove(this.v.selectedId);
      return true;
    }
    return false;
  }

  /** Selecciona una entrada (clic en la línea ya lo hace; esto es para la lista). */
  select(id: number | null): void {
    this.v.selectedId = id;
    if (id !== null) {
      this.v.pending = null;
      this.gesture = 'idle';
    }
  }

  /** Borra una medición por id (lista del panel o tecla Supr). */
  remove(id: number): void {
    const entry = this.s.caliperEntries.find((e) => e.id === id);
    if (!entry) return;
    deleteMeasurement(this.s, entry);
    if (this.v.selectedId === id) this.v.selectedId = null;
    if (this.v.editingId === id) {
      this.v.editingId = null;
      this.gesture = 'idle';
      this.editPrev = null;
      this.editOrigA = null;
      this.editOrigB = null;
    }
    this.hooks.onDelete?.(entry);
  }

  /** Limpia interacción pendiente (cambio de modo, estación o congelado). */
  reset(): void {
    this.v.pending = null;
    this.v.hoverId = null;
    this.v.hoverEnd = null;
    this.v.selectedId = null;
    this.v.editingId = null;
    this.v.snapPx = null;
    this.gesture = 'idle';
    this.dragging = false;
    this.editPrev = null;
    this.editOrigA = null;
    this.editOrigB = null;
  }

  // ── Internos ────────────────────────────────────────────────────────────

  private px(p: ImagePoint): [number, number] {
    return imagePointToCanvas(p, this.s, this.canvas.width, this.canvas.height);
  }

  private imagePt(x: number, y: number): ImagePoint {
    return canvasToImagePoint(x, y, this.s, this.canvas.width, this.canvas.height);
  }

  private segments(): { entry: CaliperEntry; seg: Segment2 }[] {
    return this.s.caliperEntries
      .filter((e) => entryVisible(e, this.s))
      .map((entry) => {
        const [ax, ay] = this.px(entry.a);
        const [bx, by] = this.px(entry.b);
        return { entry, seg: { a: { x: ax, y: ay }, b: { x: bx, y: by } } };
      });
  }

  private dvnoRef() {
    if (this.s.caliperMode !== 'dvno' || this.s.station !== 'ojo' || !this.s.currentFrame) return null;
    return dvnoReference(this.sim, this.s);
  }

  private refLinePx(ref: NonNullable<ReturnType<CaliperTool['dvnoRef']>>): Segment2 {
    const [ax, ay] = this.px(ref.a);
    const [bx, by] = this.px(ref.b);
    return { a: { x: ax, y: ay }, b: { x: bx, y: by } };
  }

  /** Punto A: imán a la línea de referencia DVNO si cae dentro de la tolerancia. */
  private placedAnchor(x: number, y: number): ImagePoint {
    this.v.snapPx = null;
    const ref = this.dvnoRef();
    if (ref) {
      const snap = snapToReference({ x, y }, this.refLinePx(ref), CALIPER_SNAP_TOL_PX);
      if (snap.snapped) {
        this.v.snapPx = [snap.point.x, snap.point.y];
        return this.imagePt(snap.point.x, snap.point.y);
      }
    }
    return this.imagePt(x, y);
  }

  /**
   * Extremo libre con `fixed` fijo: en modo DVNO se restringe perpendicular
   * al eje del nervio (en mm del plano, isótropo) y luego se aplica el imán
   * a la línea de referencia (en px de canvas).
   */
  private constrainedEnd(fixed: ImagePoint, x: number, y: number): ImagePoint {
    this.v.snapPx = null;
    const ref = this.dvnoRef();
    if (!ref) return this.imagePt(x, y);
    const kind = this.s.settings.transducer;
    const aMm = imagePointToPlaneMm(fixed, kind);
    const bMm = constrainPerpendicular(aMm, imagePointToPlaneMm(this.imagePt(x, y), kind), ref.axisDir);
    const bImg = planeMmToImagePoint(bMm, kind);
    const [bx, by] = this.px(bImg);
    const snap = snapToReference({ x: bx, y: by }, this.refLinePx(ref), CALIPER_SNAP_TOL_PX);
    if (snap.snapped) {
      this.v.snapPx = [snap.point.x, snap.point.y];
      return this.imagePt(snap.point.x, snap.point.y);
    }
    return bImg;
  }

  private updateHover(x: number, y: number): void {
    const segs = this.segments();
    const endHit = nearestEndpoint(
      segs.map((e) => e.seg),
      { x, y },
      CALIPER_ENDPOINT_TOL_PX,
    );
    if (endHit) {
      this.v.hoverId = segs[endHit.index]!.entry.id;
      this.v.hoverEnd = endHit.end;
      return;
    }
    const segHit = nearestSegment(
      segs.map((e) => e.seg),
      { x, y },
      CALIPER_SEGMENT_TOL_PX,
    );
    this.v.hoverId = segHit ? segs[segHit.index]!.entry.id : null;
    this.v.hoverEnd = null;
  }

  private commit(a: ImagePoint, b: ImagePoint): void {
    const rotBefore = this.s.rotDeg;
    const entry = commitMeasurement(this.sim, this.s, a, b);
    this.v.snapPx = null;
    if (entry) this.hooks.onCommit?.(entry, rotBefore);
  }
}
