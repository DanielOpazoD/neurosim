import { normalize, sub, type Vec3 } from '../core/vec3';

/** Cámara ortográfica del navegador, en grados y marco del paciente. */
export interface ProjectionCamera {
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly target?: Vec3;
  readonly scale?: number;
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

/**
 * Proyección ortográfica levógira:
 * +x del paciente → derecha de pantalla, +y → arriba, +z → profundidad.
 * Un yaw positivo gira la cámara alrededor de +y: +z pasa a +x de pantalla.
 */
export function project(p: Vec3, cam: ProjectionCamera): ProjectedPoint {
  const target = cam.target ?? [0, 0, 0];
  const q = sub(p, target);
  const yaw = (cam.yawDeg * Math.PI) / 180;
  const pitch = (cam.pitchDeg * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const x = cy * q[0] + sy * q[2];
  const depth = -sy * q[0] + cy * q[2];
  const y = cp * q[1] - sp * depth;
  const depthAfterPitch = sp * q[1] + cp * depth;
  const scale = cam.scale ?? 1;
  return { x: x * scale, y: -y * scale, depth: depthAfterPitch };
}

export function cameraBasis(cam: ProjectionCamera): { right: Vec3; up: Vec3; view: Vec3 } {
  const right = normalize([
    Math.cos((cam.yawDeg * Math.PI) / 180),
    0,
    Math.sin((cam.yawDeg * Math.PI) / 180),
  ]);
  const view = normalize([
    -Math.sin((cam.yawDeg * Math.PI) / 180),
    Math.sin((cam.pitchDeg * Math.PI) / 180),
    Math.cos((cam.yawDeg * Math.PI) / 180) * Math.cos((cam.pitchDeg * Math.PI) / 180),
  ]);
  const up = normalize([
    -right[1] * view[2] + right[2] * view[1],
    -right[2] * view[0] + right[0] * view[2],
    -right[0] * view[1] + right[1] * view[0],
  ]);
  return { right, up, view };
}
