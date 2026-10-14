/** Perfil tubular reducido; coeficiente registrado en fisiologia.laminarProfile. */
export const RADIAL_PROFILE_WEIGHT = 0.85;

/** Media sobre el disco de 1 − a·(r/R)² (no media sobre el radio). */
export function radialProfileMean(weight = RADIAL_PROFILE_WEIGHT): number {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1)
    throw new Error('Coeficiente de perfil fuera de [0,1]');
  return 1 - weight / 2;
}

/** Perfil relativo a la media ESPACIAL; su integral sobre el área dividida por A es 1. */
export function meanNormalizedProfile(radialFraction: number, weight = RADIAL_PROFILE_WEIGHT): number {
  const mean = radialProfileMean(weight);
  if (!Number.isFinite(radialFraction) || radialFraction < 0)
    throw new Error('Distancia radial no utilizable');
  if (radialFraction > 1) return 0;
  return (1 - weight * radialFraction ** 2) / mean;
}

/** cm/s · mm² → ml/min: 10 · 60 / 1000 = 0,6. Admite caudal firmado. */
export function flowForMeanVelocity(meanCms: number, radiusMm: number): number {
  return meanCms * Math.PI * radiusMm ** 2 * 0.6;
}

export function meanVelocityForFlow(flowMlMin: number, radiusMm: number): number {
  return flowMlMin / (Math.PI * radiusMm ** 2 * 0.6);
}
