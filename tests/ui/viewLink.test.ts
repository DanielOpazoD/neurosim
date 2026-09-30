import { describe, expect, it } from 'vitest';
import { normalize, sub, type Vec3 } from '../../src/core/vec3';
import {
  linkedCameraPosition,
  sameView,
  viewFromCamera,
  viewPreset,
  ViewLink,
  yawPitchOf,
  type ViewOrientation,
} from '../../src/ui/viewLink';
import { cameraViewDir, navigatorCameraPreset, navigatorFrame } from '../../src/ui/navigator3d';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import type { Side, Station } from '../../src/domain/contracts';

const STATIONS: readonly Station[] = ['ojo', 'temporal', 'submandibular'];
const SIDES: readonly Side[] = ['der', 'izq'];

/** Extremo de cámara puro: objetivo y distancia propios, orientación enlazada. */
class Endpoint {
  position: Vec3;
  constructor(
    readonly target: Vec3,
    readonly distance: number,
    view: ViewOrientation,
  ) {
    this.position = linkedCameraPosition(target, view, distance);
  }
  apply(view: ViewOrientation): void {
    this.position = linkedCameraPosition(this.target, view, this.distance);
  }
  dir(): Vec3 {
    return normalize(sub(this.position, this.target));
  }
}

const close = (a: Vec3, b: Vec3, tol: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe('cámaras enlazadas Exploración ↔ Anatomía (DEC-59)', () => {
  const sim = buildReferenceCase();

  it('dada una dirección de la vista de cabeza, el navegador mira en la misma (1e-9)', () => {
    const link = new ViewLink();
    const frame = navigatorFrame(sim, 'ojo', 'der', 320);
    const head = new Endpoint(sim.head.skullCenter, 480, viewPreset('ojo', 'der'));
    const nav = new Endpoint(frame.target, 110, viewPreset('temporal', 'izq'));
    link.subscribe('anatomia', (v) => nav.apply(v));
    link.subscribe('cabeza', (v) => head.apply(v));
    // La cabeza orbita a varias direcciones arbitrarias.
    for (const d of [
      [0.3, 0.5, 0.8],
      [-0.9, 0.1, 0.2],
      [0.05, -0.4, -0.9],
    ] as Vec3[]) {
      head.position = linkedCameraPosition(head.target, { dir: normalize(d), up: [0, 1, 0] }, 480);
      link.publish('cabeza', viewFromCamera(head.position, head.target, [0, 1, 0]));
      expect(close(nav.dir(), head.dir(), 1e-9)).toBe(true);
    }
    // Y al revés: orbitar el navegador arrastra la cabeza.
    nav.position = linkedCameraPosition(nav.target, { dir: normalize([-0.2, 0.7, 0.6]), up: [0, 1, 0] }, 110);
    link.publish('anatomia', viewFromCamera(nav.position, nav.target, [0, 1, 0]));
    expect(close(head.dir(), nav.dir(), 1e-9)).toBe(true);
  });

  it('el eco de la vista que aplicó la orientación no se republica (sin bucles)', () => {
    const link = new ViewLink();
    let navCalls = 0;
    let headCalls = 0;
    let nav: ViewOrientation | null = null;
    link.subscribe('anatomia', (v) => {
      navCalls += 1;
      nav = v;
      // El navegador reacciona publicando su nueva orientación (su «change»).
      link.publish('anatomia', v);
    });
    link.subscribe('cabeza', () => (headCalls += 1));
    expect(link.publish('cabeza', viewPreset('ojo', 'der'))).toBe(true);
    expect(navCalls).toBe(1);
    expect(headCalls).toBe(0);
    // Eco posterior del navegador (mismo valor): ignorado.
    expect(link.publish('anatomia', nav!)).toBe(false);
    expect(headCalls).toBe(0);
  });

  it('un único preset por estación/lado: el navegador usa exactamente el de la cabeza', () => {
    for (const station of STATIONS) {
      for (const side of SIDES) {
        const view = viewPreset(station, side);
        const { yawDeg, pitchDeg } = navigatorCameraPreset(station, side);
        expect(close(cameraViewDir(yawDeg, pitchDeg), view.dir, 1e-12)).toBe(true);
        expect(sameView(view, viewPreset(station, side), 0)).toBe(true);
        expect(Math.hypot(...view.dir)).toBeCloseTo(1, 12);
        // Espejo izquierda/derecha exacto.
        const other = viewPreset(station, side === 'der' ? 'izq' : 'der');
        expect(other.dir[0]).toBeCloseTo(-view.dir[0], 12);
        expect(other.dir[2]).toBeCloseTo(view.dir[2], 12);
      }
    }
  });

  it('ojo: la cámara mira la cara desde delante, del lado del ojo y desde arriba', () => {
    for (const side of SIDES) {
      const { dir } = viewPreset('ojo', side);
      expect(dir[2]).toBeGreaterThan(0.5); // anterior
      expect(dir[1]).toBeGreaterThan(0.2); // superior
      expect(Math.sign(dir[0])).toBe(Math.sign(sim.eyes[side].center[0])); // lateral del ojo
    }
  });

  it('yawPitchOf invierte cameraViewDir', () => {
    for (const [yaw, pitch] of [
      [30, 10],
      [-70, -4],
      [120, 40],
    ]) {
      const r = yawPitchOf(cameraViewDir(yaw!, pitch!));
      expect(r.yawDeg).toBeCloseTo(yaw!, 9);
      expect(r.pitchDeg).toBeCloseTo(pitch!, 9);
    }
  });
});
