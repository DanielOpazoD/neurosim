import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { add, scale } from '../../src/core/vec3';
import type { AppState } from '../../src/app/state';
import { clampOffsets, hitToOffsets, hotspotAt, stationBase } from '../../src/ui/headView3d';
import { buildProbeGroup } from '../../src/ui/probeMesh';

const sim = buildReferenceCase();
const sBase = {
  side: 'der',
  station: 'temporal',
  tiltDeg: 0,
  offsetMm: 0,
  offsetVMm: 0,
  tiltVDeg: 0,
  rotDeg: 0,
  press: 0.3,
} as unknown as AppState;

describe('vista de cabeza interactiva', () => {
  it('hitToOffsets proyecta el punto de contacto sobre lateral/elevación', () => {
    const base = stationBase(sim, sBase);
    const hit = add(base.origin, scale(base.lateral, 8));
    const o = hitToOffsets(hit, base);
    expect(o.offsetMm).toBeCloseTo(8, 9);
    expect(Math.abs(o.offsetVMm)).toBeLessThan(1e-9);
    const hitV = add(base.origin, scale(base.elevation, 6));
    const oV = hitToOffsets(hitV, base);
    expect(oV.offsetVMm).toBeCloseTo(6, 9);
    expect(Math.abs(oV.offsetMm)).toBeLessThan(1e-9);
  });

  it('clampOffsets respeta los rangos de los deslizadores', () => {
    expect(clampOffsets({ offsetMm: 40, offsetVMm: -60 })).toEqual({
      offsetMm: 18,
      offsetVMm: -20,
    });
    expect(clampOffsets({ offsetMm: -3.4, offsetVMm: 7.2 })).toEqual({
      offsetMm: -3.4,
      offsetVMm: 7.2,
    });
  });

  it('hotspotAt distingue ventana temporal, globo ocular y vacío', () => {
    const wc = sim.head.windowCenter.izq;
    expect(hotspotAt(wc, sim)).toEqual({ station: 'temporal', side: 'izq' });
    const eye = sim.eyes.der.center;
    expect(hotspotAt(eye, sim)).toEqual({ station: 'ojo', side: 'der' });
    expect(hotspotAt([0, 28, -120], sim)).toBeNull();
  });

  it('buildProbeGroup crea body/top/marker/cable con nombre', () => {
    const g = buildProbeGroup();
    for (const name of ['body', 'top', 'marker', 'cable']) {
      expect(g.children.some((o) => o.name === name)).toBe(true);
    }
    expect(g.userData.body).toBeDefined();
    expect(g.userData.marker).toBeDefined();
  });
});
