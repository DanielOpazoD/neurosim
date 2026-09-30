import { describe, expect, it } from 'vitest';
import { SpectralCaliper } from '../../src/ui/spectralCaliper';
import { createInitialState, type AppState, type SpectralMark } from '../../src/app/state';
import { nyquistVelocityCms } from '../../src/core/units';
import {
  spectralGeometry,
  spectralPointToPixel,
  type SpectralGeometry,
} from '../../src/ui/spectrogramRaster';
import type { SpectralColumn } from '../../src/doppler/spectral';

const W = 640;
const H = 360;
const surface = { width: W, height: H };
const PRF = 5000;

function makeColumns(n: number, t1: number, dt: number): SpectralColumn[] {
  return Array.from({ length: n }, (_, i) => ({
    t: t1 - (n - 1 - i) * dt,
    prfHz: PRF,
    powerDb: new Float32Array(128),
  }));
}

function pwState(): { s: AppState; columns: SpectralColumn[]; g: SpectralGeometry } {
  const s = createInitialState();
  s.caliperMode = 'dist';
  s.pwOn = true;
  const columns = makeColumns(200, 12, 0.02); // 4 s de traza hasta t=12
  const g = spectralGeometry(
    columns,
    s.sweepSeconds,
    s.settings.baseline,
    s.settings.invertColor,
    s.settings.frequencyMhz,
    s.settings.angleCorrectionDeg,
  );
  if (!g) throw new Error('geom nula');
  return { s, columns, g };
}

const nyq = (s: AppState) =>
  nyquistVelocityCms(PRF, s.settings.frequencyMhz * 1e6, (s.settings.angleCorrectionDeg * Math.PI) / 180);

describe('calibre espectral (DEC-62)', () => {
  it('inactivo sin PW o sin modo dist: no consume gestos', () => {
    const { s, columns } = pwState();
    const tool = new SpectralCaliper(s, surface, () => columns);
    s.caliperMode = 'none';
    expect(tool.down(100, 100)).toBe(false);
    s.caliperMode = 'dist';
    s.pwOn = false;
    expect(tool.down(100, 100)).toBe(false);
    s.pwOn = true;
    expect(tool.down(100, 100)).toBe(true);
  });

  it('clic coloca una marca con (t, v) del punto', () => {
    const { s, columns, g } = pwState();
    const tool = new SpectralCaliper(s, surface, () => columns);
    const x = W * 0.75;
    const y = H * 0.25; // fracción +0,5 con baseline 0,5
    tool.down(x, y);
    tool.up(x, y);
    expect(s.spectralMarks).toHaveLength(1);
    const m = s.spectralMarks[0]!;
    // x=0,75·W → t = 12 − 4·(1−0,75) = 11
    expect(m.tSeconds).toBeCloseTo(11, 3);
    // y=0,25·H → +0,5 de Nyquist
    expect(m.velocityCms).toBeCloseTo(0.5 * nyq(s), 6);
    // La Measurement espectral va en la lista común con unidad cm/s.
    expect(s.measurements).toHaveLength(1);
    expect(s.measurements[0]!.kind).toBe('trazado-espectral');
    expect(s.measurements[0]!.unit).toBe('cm/s');
    expect(m.id).toBe(1); // numeración compartida con caliperSeq
    void g;
  });

  it('arrastre: coloca y afina en el mismo gesto', () => {
    const { s, columns } = pwState();
    const tool = new SpectralCaliper(s, surface, () => columns);
    tool.down(W * 0.5, H * 0.5);
    tool.move(W * 0.5, H * 0.25);
    tool.up(W * 0.5, H * 0.25);
    expect(s.spectralMarks).toHaveLength(1);
    expect(s.spectralMarks[0]!.velocityCms).toBeCloseTo(0.5 * nyq(s), 6);
  });

  it('cada clic coloca una marca (t del punto bajo el cursor)', () => {
    const { s, columns } = pwState();
    const tool = new SpectralCaliper(s, surface, () => columns);
    tool.down(W * 0.4, H * 0.3);
    tool.up(W * 0.4, H * 0.3);
    tool.down(W * 0.6, H * 0.2);
    tool.up(W * 0.6, H * 0.2);
    expect(s.spectralMarks).toHaveLength(2);
    // t = 12 − 4·(1 − x/W): x=0,4·W → 9,6 s; x=0,6·W → 10,4 s
    expect(s.spectralMarks[0]!.tSeconds).toBeCloseTo(9.6, 3);
    expect(s.spectralMarks[1]!.tSeconds).toBeCloseTo(10.4, 3);
    expect(s.spectralMarks[1]!.id).toBe(2);
  });

  it('arrastrar una marca la reedita en vivo y notifica onEdit', () => {
    const { s, columns } = pwState();
    const edits: number[] = [];
    const tool = new SpectralCaliper(s, surface, () => columns, {
      onEdit: (_m, prev) => edits.push(prev),
    });
    tool.down(W * 0.5, H * 0.25);
    tool.up(W * 0.5, H * 0.25);
    const mark = s.spectralMarks[0]!;
    const v0 = mark.velocityCms;
    // Bajar sobre la marca (≤8 px) → edición; arrastrar a la mitad inferior.
    tool.down(W * 0.5 + 2, H * 0.25 + 2);
    tool.move(W * 0.5, H * 0.75);
    tool.up(W * 0.5, H * 0.75);
    expect(mark.velocityCms).toBeCloseTo(-0.5 * nyq(s), 6);
    expect(edits).toEqual([v0]);
    expect(s.measurements[0]!.value).toBeCloseTo(Math.abs(-0.5 * nyq(s)), 6);
  });

  it('Escape durante la edición restaura el punto original', () => {
    const { s, columns } = pwState();
    const tool = new SpectralCaliper(s, surface, () => columns);
    tool.down(W * 0.5, H * 0.25);
    tool.up(W * 0.5, H * 0.25);
    const mark = s.spectralMarks[0]!;
    const v0 = mark.velocityCms;
    const t0 = mark.tSeconds;
    tool.down(W * 0.5, H * 0.25);
    tool.move(W * 0.5, H * 0.9);
    expect(tool.key('Escape')).toBe(true);
    tool.up(W * 0.5, H * 0.9);
    expect(mark.velocityCms).toBeCloseTo(v0, 9);
    expect(mark.tSeconds).toBeCloseTo(t0, 9);
  });

  it('clic sobre la marca selecciona; Supr la borra de ambas listas', () => {
    const { s, columns } = pwState();
    const deleted: SpectralMark[] = [];
    const tool = new SpectralCaliper(s, surface, () => columns, {
      onDelete: (m) => deleted.push(m),
    });
    tool.down(W * 0.5, H * 0.25);
    tool.up(W * 0.5, H * 0.25);
    const mark = s.spectralMarks[0]!;
    tool.down(W * 0.5 + 3, H * 0.25);
    tool.up(W * 0.5 + 3, H * 0.25);
    expect(tool.view.selectedId).toBe(mark.id);
    expect(s.spectralMarks).toHaveLength(1); // sin arrastre: no edita
    expect(tool.key('Delete')).toBe(true);
    expect(deleted).toEqual([mark]);
    expect(s.spectralMarks).toHaveLength(0);
    expect(s.measurements).toHaveLength(0);
  });

  it('la marca se proyecta en píxeles y sale del barrido al avanzar t1', () => {
    const { s, columns, g } = pwState();
    const tool = new SpectralCaliper(s, surface, () => columns);
    tool.down(W * 0.5, H * 0.25);
    tool.up(W * 0.5, H * 0.25);
    const mark = s.spectralMarks[0]!;
    const [px, py] = spectralPointToPixel(mark.tSeconds, mark.velocityCms, W, H, g)!;
    expect(px).toBeCloseTo(W * 0.5, 3);
    expect(py).toBeCloseTo(H * 0.25, 3);
    // Si la traza avanza 5 s (más que el barrido de 4 s), la marca sale por la izda.
    const g2 = { ...g, t1: g.t1 + 5 };
    expect(spectralPointToPixel(mark.tSeconds, mark.velocityCms, W, H, g2)).toBeNull();
  });

  it('un cambio de PRF conserva la velocidad física de la marca', () => {
    const { s, columns, g } = pwState();
    const tool = new SpectralCaliper(s, surface, () => columns);
    tool.down(W * 0.5, H * 0.25);
    tool.up(W * 0.5, H * 0.25);
    const mark = s.spectralMarks[0]!;
    const nyq2 = nyq(s) / 2; // PRF reducida a la mitad
    const g2 = { ...g, nyquistCms: nyq2 };
    // La misma velocidad física se dibuja en el tope del nuevo rango.
    const p = spectralPointToPixel(mark.tSeconds, mark.velocityCms, W, H, g2)!;
    expect(p[1]).toBeCloseTo(0, 0); // |v|/nyq2 = 1 → borde superior
    void s;
  });
});
