/**
 * Calibre de velocidad sobre la traza espectral (DEC-62): el modo «Caliper»
 * mide distancia en el B-mode y velocidad en el espectro, como en un
 * ecógrafo real. Sin DOM: trabaja en píxeles de canvas para ser probada.
 *
 * Gestos (activo solo con `caliperMode === 'dist'`, PW encendido y columnas):
 *
 * - Clic: coloca una marca (t, v) en el punto; la marca barre con la traza.
 *   Un arrastre desde el vacío coloca y afina en el mismo gesto.
 * - Edición: bajar sobre una marca (≤ 8 px) la arrastra midiendo en vivo.
 * - Selección por clic en la marca o en la lista; Supr/Retroceso borra;
 *   Escape cancela lo pendiente y revierte la edición a su punto original.
 *
 * La velocidad guardada es física (cm/s con signo, + hacia la sonda): un
 * cambio de `invert`, `baseline` o PRF reposiciona la marca en el canvas sin
 * alterar la medida, y una marca puede salir del barrido al hacer scroll.
 */
import type { SpectralColumn } from '../doppler/spectral';
import { addSpectralMark, deleteSpectralMark, editSpectralMark } from '../app/measurements';
import type { AppState, SpectralMark } from '../app/state';
import {
  spectralGeometry,
  spectralPixelToPoint,
  spectralPointToPixel,
  type SpectralGeometry,
} from './spectrogramRaster';
import type { SpectralMarksView } from './overlays';

export const SPECTRAL_MARK_TOL_PX = 8;

export interface SpectralCaliperHooks {
  onCommit?(mark: SpectralMark): void;
  /** Edición terminada (`prev` = medición anterior al gesto). */
  onEdit?(mark: SpectralMark, prev: number): void;
  onDelete?(mark: SpectralMark): void;
}

interface MutableSpectralView {
  /** Marca en colocación (sigue al cursor hasta confirmar). */
  pending: { t: number; vCms: number } | null;
  hoverId: number | null;
  selectedId: number | null;
  editingId: number | null;
  cursorPx: readonly [number, number] | null;
}

export interface SpectralCanvasSurface {
  readonly width: number;
  readonly height: number;
}

type SpectralGesture = 'idle' | 'placing' | 'editing';

export class SpectralCaliper {
  readonly view: SpectralMarksView;
  private readonly v: MutableSpectralView = {
    pending: null,
    hoverId: null,
    selectedId: null,
    editingId: null,
    cursorPx: null,
  };
  private gesture: SpectralGesture = 'idle';
  private dragging = false;
  private editOrig: { t: number; vCms: number } | null = null;

  constructor(
    private readonly s: AppState,
    private readonly canvas: SpectralCanvasSurface,
    private readonly columns: () => readonly SpectralColumn[],
    private readonly hooks: SpectralCaliperHooks = {},
  ) {
    this.view = this.v;
  }

  /** Geometría de presentación vigente (null sin traza dibujable). */
  get geom(): SpectralGeometry | null {
    return spectralGeometry(
      this.columns(),
      this.s.sweepSeconds,
      this.s.settings.baseline,
      this.s.settings.invertColor,
      this.s.settings.frequencyMhz,
      this.s.settings.angleCorrectionDeg,
    );
  }

  get active(): boolean {
    return this.s.caliperMode === 'dist' && this.s.pwOn && this.geom !== null;
  }

  get domCursor(): string {
    if (!this.active) return '';
    if (this.gesture !== 'idle' || this.v.hoverId !== null) return 'pointer';
    return 'crosshair';
  }

  // ── Gestos de puntero (píxeles de canvas del espectrograma) ────────────

  down(x: number, y: number): boolean {
    const g = this.geom;
    if (!this.active || !g) return false;
    this.dragging = false;
    const hit = this.nearestMark(x, y, g);
    if (hit) {
      this.gesture = 'editing';
      this.editOrig = { t: hit.tSeconds, vCms: hit.velocityCms };
      this.v.editingId = hit.id;
      this.v.selectedId = hit.id;
      this.v.pending = null;
      return true;
    }
    this.v.selectedId = null;
    this.v.pending = this.pointAt(x, y, g);
    this.gesture = 'placing';
    return true;
  }

  move(x: number, y: number): void {
    const g = this.geom;
    if (!this.active || !g) {
      this.v.cursorPx = null;
      this.v.hoverId = null;
      return;
    }
    this.v.cursorPx = [x, y];
    if (this.gesture === 'editing' && this.v.editingId !== null) {
      const mark = this.s.spectralMarks.find((m) => m.id === this.v.editingId);
      if (mark) {
        const p = this.pointAt(x, y, g);
        editSpectralMark(this.s, mark, p.t, p.vCms);
        this.dragging = true;
      }
      return;
    }
    if (this.v.pending) {
      this.v.pending = this.pointAt(x, y, g);
      return;
    }
    const hit = this.nearestMark(x, y, g);
    this.v.hoverId = hit?.id ?? null;
  }

  up(x: number, y: number): boolean {
    if (!this.active) return false;
    if (this.gesture === 'editing') {
      const mark = this.s.spectralMarks.find((m) => m.id === this.v.editingId);
      const orig = this.editOrig;
      const moved = this.dragging;
      this.gesture = 'idle';
      this.v.editingId = null;
      this.editOrig = null;
      this.dragging = false;
      if (mark && orig && moved) this.hooks.onEdit?.(mark, orig.vCms);
      return true;
    }
    if (this.gesture === 'placing' && this.v.pending) {
      // Un clic coloca la marca (el arrastre la afinó en el mismo gesto).
      this.v.pending = null;
      this.gesture = 'idle';
      this.commit(x, y);
      return true;
    }
    return true;
  }

  /** Puntero fuera del canvas: oculta cursor y hover (el pendiente queda). */
  leave(): void {
    this.v.cursorPx = null;
    this.v.hoverId = null;
  }

  /** Supr/Retroceso borra la seleccionada; Escape cancela/revierte. */
  key(key: string): boolean {
    if (key === 'Escape') {
      if (this.v.editingId !== null) {
        const mark = this.s.spectralMarks.find((m) => m.id === this.v.editingId);
        if (mark && this.editOrig) {
          editSpectralMark(this.s, mark, this.editOrig.t, this.editOrig.vCms);
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

  /** Selecciona una marca (clic sobre ella ya lo hace; esto es para la lista). */
  select(id: number | null): void {
    this.v.selectedId = id;
    if (id !== null) {
      this.v.pending = null;
      this.gesture = 'idle';
    }
  }

  /** Borra una marca por id (lista del panel o tecla Supr). */
  remove(id: number): void {
    const mark = this.s.spectralMarks.find((m) => m.id === id);
    if (!mark) return;
    deleteSpectralMark(this.s, mark);
    if (this.v.selectedId === id) this.v.selectedId = null;
    if (this.v.editingId === id) {
      this.v.editingId = null;
      this.gesture = 'idle';
      this.editOrig = null;
    }
    this.hooks.onDelete?.(mark);
  }

  /** Limpia interacción pendiente (cambio de modo, estación o PW apagado). */
  reset(): void {
    this.v.pending = null;
    this.v.hoverId = null;
    this.v.selectedId = null;
    this.v.editingId = null;
    this.v.cursorPx = null;
    this.gesture = 'idle';
    this.dragging = false;
    this.editOrig = null;
  }

  // ── Internos ──────────────────────────────────────────────────────────

  private pointAt(x: number, y: number, g?: SpectralGeometry): { t: number; vCms: number } {
    const geom = g ?? this.geom;
    if (!geom) return { t: 0, vCms: 0 };
    return spectralPixelToPoint(x, y, this.canvas.width, this.canvas.height, geom);
  }

  private commit(x: number, y: number): void {
    const p = this.pointAt(x, y);
    const mark = addSpectralMark(this.s, p.t, p.vCms);
    this.hooks.onCommit?.(mark);
  }

  private nearestMark(x: number, y: number, g: SpectralGeometry): SpectralMark | null {
    let best: SpectralMark | null = null;
    let bestD = SPECTRAL_MARK_TOL_PX;
    for (const mark of this.s.spectralMarks) {
      const p = spectralPointToPixel(
        mark.tSeconds,
        mark.velocityCms,
        this.canvas.width,
        this.canvas.height,
        g,
      );
      if (!p) continue;
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d <= bestD) {
        best = mark;
        bestD = d;
      }
    }
    return best;
  }
}
