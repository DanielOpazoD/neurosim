/**
 * Cámaras enlazadas de la columna izquierda (DEC-59): la vista «Exploración»
 * (cabeza) y la «Anatomía» (navegador) comparten una única dirección de
 * vista y un único vector «arriba». Cada vista conserva su objetivo y su
 * distancia (encuadre propio); solo la orientación viaja por el enlace.
 * Módulo puro (sin Three.js): los presets por estación y la colocación de
 * la cámara se prueban sin WebGL.
 */
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../core/vec3';
import type { Side, Station } from '../domain/contracts';

/** Orientación de vista: `dir` = unitario objetivo → cámara; `up` = arriba. */
export interface ViewOrientation {
  readonly dir: Vec3;
  readonly up: Vec3;
}

/**
 * Azimut (desde +z hacia el lado explorado) y elevación de cada preset, en
 * grados. Ojo: frontal-lateral-superior, para que la sonda sobre el párpado
 * y el globo/nervio se lean igual en las dos vistas (antes el navegador
 * miraba el globo desde abajo y medial, y la cabeza desde delante-derecha).
 */
const PRESET_DEG: Readonly<Record<Station, { readonly az: number; readonly el: number }>> = {
  ojo: { az: 48, el: 22 },
  // Temporal: 3/4 desde arriba y delante. La M1 corre hacia la sonda (en una
  // vista lateral pura se ve de punta) y el plano mesencefálico es axial.
  temporal: { az: 45, el: 55 },
  submandibular: { az: 58, el: -14 },
};

const WORLD_UP: Vec3 = [0, 1, 0];

/**
 * Preset de vista único por estación y lado, compartido por la vista de
 * cabeza y el navegador anatómico. El lado derecho del paciente es −x.
 */
export function viewPreset(station: Station, side: Side): ViewOrientation {
  const { az, el } = PRESET_DEG[station];
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  const sign = side === 'der' ? -1 : 1;
  const dir = normalize([sign * Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]);
  return { dir, up: orthoUp(dir, WORLD_UP) };
}

/** `up` ortogonalizado respecto de `dir` (Gram-Schmidt); cae a +z si es paralelo. */
export function orthoUp(dir: Vec3, up: Vec3): Vec3 {
  const d = normalize(dir);
  const u = sub(up, scale(d, dot(up, d)));
  const n = Math.hypot(u[0], u[1], u[2]);
  if (n < 1e-9) return normalize(cross(d, [1, 0, 0]));
  return scale(u, 1 / n);
}

/** Posición de cámara a `distance` del objetivo a lo largo de la vista. */
export function linkedCameraPosition(target: Vec3, view: ViewOrientation, distance: number): Vec3 {
  return add(target, scale(normalize(view.dir), distance));
}

/** Orientación de una cámara (posición, objetivo, arriba). */
export function viewFromCamera(position: Vec3, target: Vec3, up: Vec3): ViewOrientation {
  const dir = normalize(sub(position, target));
  return { dir, up: orthoUp(dir, up) };
}

/** ¿Misma orientación dentro de `tol` (componente a componente)? */
export function sameView(a: ViewOrientation, b: ViewOrientation, tol = 1e-9): boolean {
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.dir[i]! - b.dir[i]!) > tol || Math.abs(a.up[i]! - b.up[i]!) > tol) return false;
  }
  return true;
}

/** Yaw/pitch (convención de `cameraViewDir` del navegador) de una dirección. */
export function yawPitchOf(dir: Vec3): { yawDeg: number; pitchDeg: number } {
  const d = normalize(dir);
  return {
    yawDeg: (Math.atan2(-d[0], d[2]) * 180) / Math.PI,
    pitchDeg: (Math.asin(Math.max(-1, Math.min(1, d[1]))) * 180) / Math.PI,
  };
}

export type ViewSource = 'cabeza' | 'anatomia';

/**
 * Bus bidireccional de orientación. La vista de cabeza es la maestra al
 * reiniciar (preset por estación), pero orbitar en cualquiera de las dos
 * arrastra a la otra. Guardas contra bucles: se ignora una orientación igual
 * a la vigente (el eco de la vista que la acaba de aplicar) y no se reenvía
 * mientras se despacha.
 */
export class ViewLink {
  private current: ViewOrientation | null = null;
  private dispatching = false;
  private readonly listeners = new Map<ViewSource, (view: ViewOrientation) => void>();

  /** Tolerancia del eco: por debajo, la orientación se considera la misma. */
  static readonly ECHO_TOL = 1e-7;

  get view(): ViewOrientation | null {
    return this.current;
  }

  subscribe(source: ViewSource, apply: (view: ViewOrientation) => void): void {
    this.listeners.set(source, apply);
  }

  /** Publica la orientación de `source`; devuelve false si fue un eco o reentrada. */
  publish(source: ViewSource, view: ViewOrientation): boolean {
    if (this.dispatching) return false;
    const next: ViewOrientation = { dir: normalize(view.dir), up: orthoUp(view.dir, view.up) };
    if (this.current && sameView(this.current, next, ViewLink.ECHO_TOL)) return false;
    this.current = next;
    this.dispatching = true;
    try {
      for (const [id, apply] of this.listeners) if (id !== source) apply(next);
    } finally {
      this.dispatching = false;
    }
    return true;
  }
}
