import { describe, expect, it } from 'vitest';
import { CaliperTool } from '../../src/ui/caliperTool';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { createInitialState, type AppState, type CaliperEntry } from '../../src/app/state';
import { currentPose } from '../../src/app/poses';
import { buildScan } from '../../src/ultrasound/probe';
import { LINEAR_APERTURE_MM } from '../../src/ultrasound/probe';
import {
  canvasToImagePoint,
  dvnoReference,
  imagePointToCanvas,
  imagePointToPlaneMm,
} from '../../src/app/measurements';
import { sheathRadiiAt, trueOnsdMm } from '../../src/anatomy/eye';
import { frameFromScan } from '../validation/helpers';
import type { Measurement, Side } from '../../src/domain/contracts';
import type { ImagePoint } from '../../src/domain/measure';

const W = 640;
const H = 480;
const sim = buildReferenceCase();
const surface = { width: W, height: H };

function eyeState(side: Side): AppState {
  const s = createInitialState();
  s.side = side;
  const pose = currentPose(sim, s);
  const scan = buildScan(pose, 'linear', 64);
  s.currentFrame = frameFromScan(scan, s.settings, side, 'ojo');
  return s;
}

const toPx = (s: AppState, p: ImagePoint): [number, number] => imagePointToCanvas(p, s, W, H);
const toImg = (s: AppState, x: number, y: number): ImagePoint => canvasToImagePoint(x, y, s, W, H);

/** Punto sobre la línea de referencia DVNO a `mm` del centro (signo = lado b). */
function onRefLine(s: AppState, mm: number): [number, number] {
  const ref = dvnoReference(sim, s);
  const [ax, ay] = toPx(s, ref.a);
  const [bx, by] = toPx(s, ref.b);
  const [cx, cy] = toPx(s, ref.center);
  const len = Math.hypot(bx - ax, by - ay);
  const halfMm = sheathRadiiAt(sim.eyes[s.side], 3).major + 2.5;
  const pxPerMm = len / (2 * halfMm);
  return [cx + ((bx - ax) / len) * mm * pxPerMm, cy + ((by - ay) / len) * mm * pxPerMm];
}

describe('herramienta de calibre (DEC-61)', () => {
  it('sin modo activo no consume gestos', () => {
    const s = eyeState('der');
    const tool = new CaliperTool(sim, s, surface);
    expect(tool.down(100, 100)).toBe(false);
    tool.move(120, 120);
    expect(tool.view.cursorPx).toBeNull();
    expect(tool.up(120, 120)).toBe(false);
    expect(tool.consumeClick()).toBe(false);
  });

  it('arrastre: banda elástica en vivo y medición confirmada al soltar', () => {
    const s = eyeState('der');
    s.caliperMode = 'dist';
    const commits: CaliperEntry[] = [];
    const tool = new CaliperTool(sim, s, surface, { onCommit: (e) => commits.push(e) });
    expect(tool.down(100, 200)).toBe(true);
    expect(tool.view.pending?.a).toEqual(toImg(s, 100, 200));
    expect(tool.view.pending?.cursor).toBeNull();
    tool.move(160, 200);
    expect(tool.view.pending?.cursor).toEqual(toImg(s, 160, 200));
    expect(tool.up(160, 200)).toBe(true);
    expect(commits).toHaveLength(1);
    expect(s.caliperEntries).toHaveLength(1);
    expect(s.measurements).toHaveLength(1);
    // 60 px de 640 sobre 38 mm de apertura = 3,56 mm laterales.
    expect(s.measurements[0]!.value).toBeCloseTo((60 / W) * LINEAR_APERTURE_MM, 2);
    expect(commits[0]!.tag).toBe('Distancia');
    expect(tool.view.pending).toBeNull();
    // El click de cierre del arrastre queda suprimido una sola vez.
    expect(tool.consumeClick()).toBe(true);
    expect(tool.consumeClick()).toBe(false);
  });

  it('clic a clic: el primer clic ancla A y el segundo confirma', () => {
    const s = eyeState('der');
    s.caliperMode = 'dist';
    const tool = new CaliperTool(sim, s, surface);
    tool.down(120, 300);
    tool.up(120, 300);
    expect(tool.view.pending?.a).toEqual(toImg(s, 120, 300));
    expect(s.measurements).toHaveLength(0);
    tool.move(200, 300);
    expect(tool.view.pending?.cursor).toEqual(toImg(s, 200, 300));
    tool.down(200, 300);
    tool.up(200, 300);
    expect(s.measurements).toHaveLength(1);
    expect(s.measurements[0]!.value).toBeCloseTo((80 / W) * LINEAR_APERTURE_MM, 2);
  });

  it('Escape cancela el punto anclado y la selección', () => {
    const s = eyeState('der');
    s.caliperMode = 'dist';
    const tool = new CaliperTool(sim, s, surface);
    tool.down(120, 300);
    tool.up(120, 300);
    expect(tool.view.pending).not.toBeNull();
    expect(tool.key('Escape')).toBe(true);
    expect(tool.view.pending).toBeNull();
    expect(tool.key('Escape')).toBe(false);
  });

  it('clic en la línea selecciona; Supr la borra de todas las listas', () => {
    const s = eyeState('der');
    s.caliperMode = 'dist';
    const deleted: CaliperEntry[] = [];
    const tool = new CaliperTool(sim, s, surface, { onDelete: (e) => deleted.push(e) });
    tool.down(100, 200);
    tool.move(200, 200);
    tool.up(200, 200);
    const entry = s.caliperEntries[0]!;
    // Hover antes del clic: la entrada queda resaltada.
    tool.move(150, 201);
    expect(tool.view.hoverId).toBe(entry.id);
    tool.down(150, 200);
    expect(tool.view.selectedId).toBe(entry.id);
    expect(tool.view.pending).toBeNull();
    tool.up(150, 200);
    expect(tool.key('Delete')).toBe(true);
    expect(deleted).toEqual([entry]);
    expect(s.caliperEntries).toHaveLength(0);
    expect(s.measurements).toHaveLength(0);
    expect(tool.key('Delete')).toBe(false);
  });

  it('arrastrar un extremo edita la medición y notifica al gancho', () => {
    const s = eyeState('der');
    s.caliperMode = 'dist';
    const edits: { entry: CaliperEntry; prev: Measurement }[] = [];
    const tool = new CaliperTool(sim, s, surface, {
      onEdit: (entry, prev) => edits.push({ entry, prev }),
    });
    tool.down(100, 200);
    tool.move(200, 200);
    tool.up(200, 200);
    const entry = s.caliperEntries[0]!;
    const prev = entry.measurement;
    tool.down(202, 198);
    expect(tool.view.editingId).toBe(entry.id);
    tool.move(240, 240);
    expect(entry.b).toEqual(toImg(s, 240, 240));
    tool.up(240, 240);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.prev).toBe(prev);
    expect(entry.measurement).not.toBe(prev);
    const du = ((240 - 100) / W) * LINEAR_APERTURE_MM;
    const dz = ((240 - 200) / H) * s.settings.depthMm;
    expect(entry.measurement.value).toBeCloseTo(Math.hypot(du, dz), 1);
  });

  it('Escape durante la edición restaura los extremos originales', () => {
    const s = eyeState('der');
    s.caliperMode = 'dist';
    const edits: CaliperEntry[] = [];
    const tool = new CaliperTool(sim, s, surface, { onEdit: (e) => edits.push(e) });
    tool.down(100, 200);
    tool.move(200, 200);
    tool.up(200, 200);
    const entry = s.caliperEntries[0]!;
    const value = entry.measurement.value;
    const b0 = entry.b;
    tool.down(202, 198);
    tool.move(240, 240);
    expect(tool.key('Escape')).toBe(true);
    expect(entry.b).toEqual(b0);
    expect(entry.measurement.value).toBeCloseTo(value, 6);
    expect(tool.view.editingId).toBeNull();
    expect(edits).toHaveLength(0);
  });

  it('DVNO: restringe la medición perpendicular al nervio', () => {
    const s = eyeState('der');
    s.caliperMode = 'dvno';
    const tool = new CaliperTool(sim, s, surface);
    const ref = dvnoReference(sim, s);
    // A a 40 px de la referencia (fuera del imán): punto libre.
    const [ax, ay] = toPx(s, ref.a);
    tool.down(ax, ay + 40);
    expect(tool.view.snapPx).toBeNull();
    tool.move(ax + 90, ay + 40);
    tool.up(ax + 90, ay + 40);
    const entry = s.caliperEntries[0]!;
    const aMm = imagePointToPlaneMm(entry.a, 'linear');
    const bMm = imagePointToPlaneMm(entry.b, 'linear');
    const along = (bMm.x - aMm.x) * ref.axisDir.x + (bMm.y - aMm.y) * ref.axisDir.y;
    // La restricción anuló la componente del arrastre sobre el eje del nervio.
    expect(Math.abs(along)).toBeLessThan(1e-9);
    expect(entry.measurement.kind).toBe('dvno');
    expect(entry.measurement.convention).toBe('interno');
    expect(entry.measurement.referenceOffsetMm).toBe(3);
  });

  it('DVNO: el imán sobre la referencia de 3 mm reproduce la DVNO interna', () => {
    const s = eyeState('der');
    s.caliperMode = 'dvno';
    const tool = new CaliperTool(sim, s, surface);
    const innerMm = sheathRadiiAt(sim.eyes.der, 3).major - sim.eyes.der.duraMm;
    const [x1, y1] = onRefLine(s, -innerMm);
    const [x2, y2] = onRefLine(s, innerMm);
    tool.down(x1, y1);
    expect(tool.view.snapPx).not.toBeNull();
    tool.move(x2, y2);
    tool.up(x2, y2);
    const entry = s.caliperEntries[0]!;
    expect(entry.measurement.value).toBeCloseTo(trueOnsdMm(sim.eyes.der, 3, 'interno'), 1);
    expect(entry.tag).toContain('DVNO D');
  });

  it('protocolo DVNO: la medición llena el hueco y avanza al siguiente paso', () => {
    const s = eyeState('der');
    s.caliperMode = 'dvno';
    s.onsdActive = true;
    const tool = new CaliperTool(sim, s, surface);
    const innerMm = sheathRadiiAt(sim.eyes.der, 3).major - sim.eyes.der.duraMm;
    const [x1, y1] = onRefLine(s, -innerMm);
    const [x2, y2] = onRefLine(s, innerMm);
    tool.down(x1, y1);
    tool.move(x2, y2);
    tool.up(x2, y2);
    const entry = s.caliperEntries[0]!;
    expect(s.onsd.dvno['der-transversal']).toBe(entry.measurement);
    // Siguiente hueco: der-sagital → marcador a 90°.
    expect(s.rotDeg).toBe(90);
    expect(s.side).toBe('der');
  });

  it('borrar desde la lista (remove) limpia selección y huecos de protocolo', () => {
    const s = eyeState('der');
    s.caliperMode = 'dvno';
    s.onsdActive = true;
    const tool = new CaliperTool(sim, s, surface);
    const innerMm = sheathRadiiAt(sim.eyes.der, 3).major - sim.eyes.der.duraMm;
    const [x1, y1] = onRefLine(s, -innerMm);
    const [x2, y2] = onRefLine(s, innerMm);
    tool.down(x1, y1);
    tool.move(x2, y2);
    tool.up(x2, y2);
    const entry = s.caliperEntries[0]!;
    tool.select(entry.id);
    tool.remove(entry.id);
    expect(s.caliperEntries).toHaveLength(0);
    expect(s.measurements).toHaveLength(0);
    expect(s.onsd.dvno['der-transversal']).toBeUndefined();
    expect(tool.view.selectedId).toBeNull();
  });
});
