/**
 * Atenuación acumulada a lo largo de una trayectoria (ida y vuelta, dB).
 * La marcha clasifica cada milímetro; el hueso y la ventana temporal mandan.
 */
import { attenuationDbCm, MATERIALS, type MaterialId } from '../anatomy/materials';
import type { HeadGeometry } from '../anatomy/head';
import { classifyHead, inTemporalWindow } from '../anatomy/head';
import { ANATOMIA_CABEZA } from '../anatomy/params';
import { dist, type Vec3 } from '../core/vec3';

/**
 * dB de atenuación ida y vuelta entre el origen de la sonda y el punto,
 * a `f0Mhz`: A = 2·Σ attenDbCmMhz·f0·ds.
 */
/**
 * Atenuación ida y vuelta (dB) sonda→punto integrando la clasificación de
 * material cada ~1 mm: A = 2·Σ attenDbCmMhz·f0·ds. Escenas no craneales
 * (órbita) la usan sin penalización de ventana.
 */
export function pathAttenuationDb(
  classify: (p: Vec3) => MaterialId,
  from: Vec3,
  to: Vec3,
  f0Mhz: number,
): number {
  const total = dist(from, to);
  const steps = Math.max(2, Math.ceil(total / 1));
  const ds = total / steps / 10; // cm
  let acc = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const p: Vec3 = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ];
    acc += attenuationDbCm(MATERIALS[classify(p)], f0Mhz) * ds;
  }
  return 2 * acc;
}

export function skullAttenuationDb(head: HeadGeometry, from: Vec3, to: Vec3, f0Mhz: number): number {
  const total = dist(from, to);
  const steps = Math.max(2, Math.ceil(total / 1));
  const ds = total / steps / 10; // cm
  let acc = 0;
  let windowHit = false;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const p: Vec3 = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ];
    const id = classifyHead(head, p);
    acc += attenuationDbCm(MATERIALS[id], f0Mhz) * ds;
    if (id === 'hueso' && inTemporalWindow(head, 'der', p)) windowHit = true;
  }
  // Ventana de mala calidad: pérdida de transmisión respecto a la de referencia
  // (dispersión/difrasión ósea adicional, no absorbida por el espesor).
  if (windowHit) {
    const ref = ANATOMIA_CABEZA.params.windowQuality.value;
    acc += Math.max(0, -10 * Math.log10(head.windowQuality / ref));
  }
  return 2 * acc;
}

/** Transmisión de amplitud ida y vuelta (0–1) hasta un punto. */
export function transmissionTo(head: HeadGeometry, from: Vec3, to: Vec3, f0Mhz: number): number {
  return Math.pow(10, -skullAttenuationDb(head, from, to, f0Mhz) / 20);
}
