// Portado de DanielOpazoD/vexus-sim @ 59fb7b18e9c1 — src/core/units.ts (MIT).
// Adaptación local: neurosono-sim. Ver docs/PROVENANCE.md.

/** Constantes y conversiones. Las unidades del motor: mm, s, mmHg, mL. */
export const MMHG_PER_CMH2O = 0.73556;
export const CMH2O_PER_MMHG = 1 / MMHG_PER_CMH2O;
/** Velocidad del sonido que asume el equipo para reconstruir (hoja consolidada). */
export const C_RECONSTRUCTION_M_S = 1540;
export const C_RECONSTRUCTION_MM_S = C_RECONSTRUCTION_M_S * 1000;

export const cmH2OToMmHg = (p: number): number => p * MMHG_PER_CMH2O;
export const mmHgToCmH2O = (p: number): number => p * CMH2O_PER_MMHG;
export const mmToCm = (x: number): number => x / 10;
export const cmToMm = (x: number): number => x * 10;
/** cm/s → mm/s */
export const cmsToMms = (v: number): number => v * 10;
export const mmsToCms = (v: number): number => v / 10;

/**
 * Desplazamiento Doppler físico (invariante 10.1): fD = 2 f0 (v_rel · b̂) / c,
 * con b̂ unitario dirigido desde el dispersor hacia el transductor. Flujo que se
 * acerca → positivo. `vAlongBeam` es v_rel·b̂ en mm/s; `f0` en Hz; `c` en mm/s.
 */
export function dopplerShiftHz(vAlongBeamMmS: number, f0Hz: number, cMmS = C_RECONSTRUCTION_MM_S): number {
  return (2 * f0Hz * vAlongBeamMmS) / cMmS;
}

/** Velocidad rotulada a partir de una frecuencia Doppler con corrección angular del usuario. */
export function velocityFromShiftMmS(
  fdHz: number,
  f0Hz: number,
  angleCorrectionRad: number,
  cMmS = C_RECONSTRUCTION_MM_S,
): number {
  const cosA = Math.cos(angleCorrectionRad);
  if (Math.abs(cosA) < 1e-6) return Number.NaN;
  return (fdHz * cMmS) / (2 * f0Hz * cosA);
}

/** Frecuencia plegada al intervalo centrado de Nyquist: ((f + PRF/2) mod PRF) − PRF/2. */
export function wrapToNyquist(fHz: number, prfHz: number): number {
  const half = prfHz / 2;
  let x = (fHz + half) % prfHz;
  if (x < 0) x += prfHz;
  return x - half;
}

/**
 * Velocidad de Nyquist rotulada (cm/s) para una PRF: v = (PRF/2)·c / (2·f0·cos α).
 * Con `angleCorrectionRad` 0 es la escala sin corrección que muestra la barra.
 */
export function nyquistVelocityCms(
  prfHz: number,
  f0Hz: number,
  angleCorrectionRad = 0,
  cMmS = C_RECONSTRUCTION_MM_S,
): number {
  const cosA = Math.max(0.05, Math.abs(Math.cos(angleCorrectionRad)));
  return mmsToCms(((prfHz / 2) * cMmS) / (2 * f0Hz * cosA));
}

/** PRF (Hz) que da una velocidad de Nyquist rotulada `cms` (inversa de `nyquistVelocityCms` con α = 0). */
export function prfFromNyquistCms(cms: number, f0Hz: number, cMmS = C_RECONSTRUCTION_MM_S): number {
  return (cmsToMms(cms) * 2 * 2 * f0Hz) / cMmS;
}
