/**
 * Atenuación acumulada a lo largo de una trayectoria (ida y vuelta, dB).
 * La marcha clasifica cada milímetro; el hueso y la ventana temporal mandan.
 */
import { MATERIALS } from '../anatomy/materials';
import type { HeadGeometry } from '../anatomy/head';
import { classifyHead } from '../anatomy/head';
import { dist, type Vec3 } from '../core/vec3';

/**
 * dB de atenuación ida y vuelta entre el origen de la sonda y el punto,
 * a `f0Mhz`: A = 2·Σ attenDbCmMhz·f0·ds.
 */
export function skullAttenuationDb(head: HeadGeometry, from: Vec3, to: Vec3, f0Mhz: number): number {
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
    const m = MATERIALS[classifyHead(head, p)];
    acc += m.attenuationDbCmMhz * f0Mhz * ds;
  }
  return 2 * acc;
}

/** Transmisión de amplitud ida y vuelta (0–1) hasta un punto. */
export function transmissionTo(head: HeadGeometry, from: Vec3, to: Vec3, f0Mhz: number): number {
  return Math.pow(10, -skullAttenuationDb(head, from, to, f0Mhz) / 20);
}
