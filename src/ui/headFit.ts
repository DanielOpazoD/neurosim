/**
 * Ajuste de la cabeza escaneada (Lee Perry-Smith, CC BY 3.0; DEC-59) a la
 * geometría del caso. Módulo puro: la tabla de referencias del asset y la
 * transformación de semejanza se prueban sin WebGL.
 *
 * Marco del asset (glTF, unidades arbitrarias): +y arriba, +z hacia la cara
 * (anterior), −x = derecha del paciente — el mismo marco del caso, así que no
 * hace falta rotar. Los ojos del escaneo están cerrados y forman parte de la
 * malla: se ajusta el vértice anterior del párpado (centro de la hendidura
 * palpebral) al punto de contacto de la sonda ocular del caso
 * (`eyePose(...).origin` = centro del globo + radio + 3,2 mm), lo que hace
 * coincidir los centros oculares del asset con `sim.eyes.*.center`.
 */
import type { Vec3 } from '../core/vec3';
import type { ReferenceCase } from '../domain/referenceCase';
import type { Side } from '../domain/contracts';
import { EYE_PROBE_STANDOFF_MM, eyePose } from '../app/poses';

/**
 * Referencias medidas en `LeePerrySmith.glb` (three.js r186). Se eligieron a
 * mano sobre renders frontales con textura (centro de cada hendidura
 * palpebral) y se confirmó la z con un raycast frontal sobre la malla (máximo
 * local del párpado cerrado): Ojo D x = −0,71, Ojo I x = +0,50, y = 1,66,
 * z = 1,946 (la línea media de la nariz está en x ≈ −0,105). `halfWidthAtCenter`
 * es la semianchura del cráneo escaneado ~30 mm por encima de los ojos (nivel
 * de `skullCenter`): x ∈ [−1,63, 1,49] en y = 2,23.
 */
export const LEE_PERRY_SMITH_FIT = {
  lidDer: [-0.71, 1.66, 1.946] as Vec3,
  lidIzq: [0.5, 1.66, 1.946] as Vec3,
  widthAtCenter: 3.12,
} as const;

/** Límite de anisotropía permitido (|s_eje / s − 1| ≤ 10 %). */
export const MAX_ANISOTROPY = 0.1;

/** Transformación p' = scale ⊙ p + offset (marco del caso, mm). */
export interface HeadFit {
  readonly scale: Vec3;
  readonly offset: Vec3;
}

/** Punto de contacto de la sonda ocular sobre el párpado del caso. */
export function lidTarget(sim: ReferenceCase, side: Side): Vec3 {
  return eyePose(sim, { side, station: 'ojo', tiltDeg: 0, offsetMm: 0 }, side).origin;
}

/**
 * Semejanza (escala uniforme + traslación) que lleva los centros oculares
 * del asset a `sim.eyes.*.center`. La escala sale de la distancia
 * interpupilar (x); el centro ocular del asset se sitúa detrás del párpado a
 * la profundidad media radio + 3,2 mm del caso, de modo que la sonda ocular
 * apoya en el párpado (residuo ≤ ½·|r_D − r_I| ≈ 0,09 mm). `anisotropyYZ`
 * (≤ 10 %) permite escalar y/z respecto de x; por defecto 0: la anchura del
 * cráneo escaneado queda como resulte (ver `fitReport`), porque los ojos
 * mandan.
 */
export function fitHeadScan(
  sim: ReferenceCase,
  fit: typeof LEE_PERRY_SMITH_FIT = LEE_PERRY_SMITH_FIT,
  anisotropyYZ = 0,
): HeadFit {
  const cDer = sim.eyes.der.center;
  const cIzq = sim.eyes.izq.center;
  const sx = (cIzq[0] - cDer[0]) / (fit.lidIzq[0] - fit.lidDer[0]);
  const k = 1 + Math.max(-MAX_ANISOTROPY, Math.min(MAX_ANISOTROPY, anisotropyYZ));
  const scale: Vec3 = [sx, sx * k, sx * k];
  const lidDepthMm = (sim.eyes.der.globeRadiusMm + sim.eyes.izq.globeRadiusMm) / 2 + EYE_PROBE_STANDOFF_MM;
  const centers = scanEyeCenters(fit, lidDepthMm / scale[2]);
  const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const src = mid(centers.der, centers.izq);
  const dst = mid(cDer, cIzq);
  return {
    scale,
    offset: [dst[0] - scale[0] * src[0], dst[1] - scale[1] * src[1], dst[2] - scale[2] * src[2]],
  };
}

/** Centros oculares del asset: párpado − profundidad (unidades del asset) hacia −z. */
export function scanEyeCenters(fit: typeof LEE_PERRY_SMITH_FIT, depth: number): { der: Vec3; izq: Vec3 } {
  const back = (p: Vec3): Vec3 => [p[0], p[1], p[2] - depth];
  return { der: back(fit.lidDer), izq: back(fit.lidIzq) };
}

export function applyFit(fit: HeadFit, p: Vec3): Vec3 {
  return [
    fit.scale[0] * p[0] + fit.offset[0],
    fit.scale[1] * p[1] + fit.offset[1],
    fit.scale[2] * p[2] + fit.offset[2],
  ];
}

/** Anchura del cráneo escaneado frente a la del caso (`skullRadii.x·2 + 14`). */
export function fitReport(
  sim: ReferenceCase,
  fit: HeadFit,
  ref: typeof LEE_PERRY_SMITH_FIT = LEE_PERRY_SMITH_FIT,
): { scanWidthMm: number; caseWidthMm: number; ratio: number } {
  const scanWidthMm = ref.widthAtCenter * fit.scale[0];
  const caseWidthMm = sim.head.skullRadii[0] * 2 + 14;
  return { scanWidthMm, caseWidthMm, ratio: scanWidthMm / caseWidthMm };
}
