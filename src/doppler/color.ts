/**
 * Doppler color (TCCD): emulación analítica por celda. Para cada píxel del
 * barrido proyecta la velocidad real del vaso sobre el haz local y estima la
 * potencia devuelta (sangre dentro del tubo, transmisión por la trayectoria
 * ósea). Comparte con el PW el campo de velocidades y la convención de signo:
 * + (rojo) = flujo hacia la sonda; − (azul) = alejándose.
 *
 * Nyquist de color y aliasing emergen de `prfHz`/escala elegidos.
 */
import { nyquistVelocityCms, mmsToCms } from '../core/units';
import type { AcquisitionSettings, ProbePose } from '../domain/contracts';
import type { HeadGeometry } from '../anatomy/head';
import { vesselClosest, vesselDistance } from '../anatomy/head';
import type { CerebralFlow } from '../physiology/flow';
import { beamDirAt, imageToPatient, type ScanGeometry } from '../ultrasound/probe';
import { skullAttenuationDb } from '../ultrasound/attenuation';

/**
 * Semiespesor elevacional del corte (mm): el haz tiene varios mm de espesor
 * fuera del plano imagen a profundidades transtemporales — los vasos se ven
 * aunque crucen el plano con un pequeño desvío.
 */
export const SLICE_HALF_MM = 3.5;

export interface ColorCell {
  /** Velocidad proyectada con signo hacia la sonda, cm/s. NaN = sin flujo. */
  vCms: number;
  /** Potencia relativa del retorno de sangre [0,1]. */
  power: number;
}

/**
 * Mapa de color por muestra del barrido. `rows`/`cols` sobre la geometría
 * (`z` profundidad, `u` lateral).
 */
export function renderColorDoppler(
  head: HeadGeometry,
  flow: CerebralFlow,
  scan: ScanGeometry,
  pose: ProbePose,
  settings: AcquisitionSettings,
  cardiacPhase: number,
  rows: number,
  cols: number,
): Float32Array[] {
  const vel = new Float32Array(rows * cols).fill(Number.NaN);
  const pow = new Float32Array(rows * cols);
  const f0Hz = settings.frequencyMhz * 1e6;
  const nyqCms = nyquistVelocityCms(settings.prfHz, f0Hz, 0);
  for (let zi = 0; zi < rows; zi++) {
    const zMm = ((zi + 0.5) / rows) * settings.depthMm;
    for (let ci = 0; ci < cols; ci++) {
      const u = ((ci + 0.5) / cols - 0.5) * scan.widthMmOrRad;
      const p = imageToPatient(pose, scan.kind, u, zMm);
      // El vaso contribuye si el corte (plano ± SLICE_HALF_MM) lo alcanza.
      let best: { v: (typeof head.vessels)[number]; extra: number } | null = null;
      for (const v of head.vessels) {
        const extra = vesselDistance(v, p); // <0 dentro del tubo
        if (extra < SLICE_HALF_MM && (!best || extra < best.extra)) best = { v, extra };
      }
      if (!best) continue;
      const v = best.v;
      const dir = beamDirAt(pose, scan.kind, u);
      // La velocidad se evalúa en el punto del vaso más cercano (el corte
      // puede estar ligeramente fuera del plano imagen).
      const w = flow.velocityAt(vesselClosest(v, p).point, cardiacPhase);
      // proyección sobre el haz (hacia la sonda = −dir)
      const vAlong = -(w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2]);
      let vCms = mmsToCms(vAlong);
      // aliasing por Nyquist: plegar a ±nyq
      const span = 2 * nyqCms;
      vCms = (((vCms % span) + span + nyqCms) % span) - nyqCms;
      const attDb = skullAttenuationDb(head, pose.origin, p, settings.frequencyMhz);
      const sliceW = 1 - Math.max(0, best.extra) / SLICE_HALF_MM;
      // La ganancia de color del equipo (dopplerGainDb) eleva la potencia pintada.
      const power = Math.pow(10, (settings.dopplerGainDb - attDb) / 10) * sliceW;
      const idx = zi * cols + ci;
      vel[idx] = vCms;
      pow[idx] = Math.min(1, power * 0.5);
    }
  }
  return [vel, pow];
}
