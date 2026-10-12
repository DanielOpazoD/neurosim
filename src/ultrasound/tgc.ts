/** Compensación de ganancia receptora en dB, a la profundidad física de cada muestra. */
export function tgcProfile(
  bandsDb: readonly number[],
  depthMm: number,
  height: number,
  dzMm: number,
): Float32Array {
  const profile = new Float32Array(height);
  if (bandsDb.length === 0) return profile;
  for (let row = 0; row < height; row++) {
    const f = Math.min(1, Math.max(0, (row * dzMm) / Math.max(1, depthMm))) * (bandsDb.length - 1);
    const lo = Math.floor(f);
    const hi = Math.min(bandsDb.length - 1, lo + 1);
    const weight = f - lo;
    profile[row] = bandsDb[lo]! * (1 - weight) + bandsDb[hi]! * weight;
  }
  return profile;
}
