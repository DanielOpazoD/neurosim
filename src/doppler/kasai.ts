/**
 * Estimación de frecuencia Doppler por autocorrelación de Kasai.
 * R(1) usa la convención z*ₖ·zₖ₊₁; una fase negativa representa movimiento
 * hacia la sonda y por ello la velocidad devuelta es positiva.
 */
export interface KasaiEstimate {
  r0: number;
  r1Re: number;
  r1Im: number;
}

export function kasaiEstimate(re: Float32Array, im: Float32Array, n: number): KasaiEstimate {
  const count = Math.min(n, re.length, im.length);
  let r0 = 0;
  let r1Re = 0;
  let r1Im = 0;
  for (let k = 0; k < count; k += 1) {
    const rek = re[k]!;
    const imk = im[k]!;
    r0 += rek * rek + imk * imk;
    if (k + 1 < count) {
      const ren = re[k + 1]!;
      const imn = im[k + 1]!;
      r1Re += rek * ren + imk * imn;
      r1Im += rek * imn - imk * ren;
    }
  }
  return { r0, r1Re, r1Im };
}

export function kasaiVelocityCms(
  r1Re: number,
  r1Im: number,
  prfHz: number,
  f0Hz: number,
  cMs = 1540,
): number {
  return -(cMs / (4 * Math.PI * f0Hz)) * prfHz * Math.atan2(r1Im, r1Re) * 100;
}

export function kasaiVariance(r0: number, r1Re: number, r1Im: number): number {
  if (r0 <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - Math.hypot(r1Re, r1Im) / r0));
}

/** Filtro de pared de orden cero: resta la media compleja del ensemble. */
export function ensembleWallFilter(re: Float32Array, im: Float32Array, n: number): void {
  const count = Math.min(n, re.length, im.length);
  if (count === 0) return;
  let meanRe = 0;
  let meanIm = 0;
  for (let k = 0; k < count; k += 1) {
    meanRe += re[k]!;
    meanIm += im[k]!;
  }
  meanRe /= count;
  meanIm /= count;
  for (let k = 0; k < count; k += 1) {
    re[k] = re[k]! - meanRe;
    im[k] = im[k]! - meanIm;
  }
}
