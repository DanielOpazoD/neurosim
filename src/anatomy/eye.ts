/**
 * Anatomía implícita de la órbita (campos de distancia), bilateral.
 *
 * Marco del paciente (mm, levógiro): +x = izquierda del paciente,
 * +y = superior, +z = anterior. Cada ojo tiene un marco local:
 * origen en el centro del globo, ez anterior (hacia el párpado),
 * ex temporal (alejándose de la línea media), ey superior.
 *
 * Escena N1: párpado/gel, córnea, cámara anterior, iris, cristalino, vítreo,
 * complejo retina-coroides-esclera, papila, nervio óptico con línea central
 * curva y secciones elípticas (nervio / espacio de LCR / dura separados),
 * grasa retrobulbar, músculos rectos y paredes orbitarias óseas.
 *
 * Dimensiones: adulto de referencia; el nervio NO es un cilindro perfecto —
 * excentricidad de la vaina ~0,5 según estudio 3D [silverman-3d-onsd-2026].
 */
import { MATERIALS, type Material, type MaterialId } from './materials';
import { add, dist, dot, normalize, scale, smoothstep, sub, v3, type Vec3 } from '../core/vec3';
import type { SeededRandom } from '../core/random';
import type { Side } from '../domain/contracts';
import { MANIFEST } from '../domain/manifest';
import { ANATOMIA_OJO } from './params';

const EYE = ANATOMIA_OJO.params;
export const DURA_MM = EYE.duraMm.value;

/** Parámetros geométricos de un ojo individual (mm). */
export interface EyeGeometry {
  readonly side: Side;
  /** Centro del globo en coordenadas del paciente. */
  readonly center: Vec3;
  /** ez: anterior; ex: temporal; ey: superior (ortonormal). */
  readonly anterior: Vec3;
  readonly temporal: Vec3;
  readonly superior: Vec3;
  readonly globeRadiusMm: number;
  /** Semieje del cristalino (axial/lateral), mm. */
  readonly lensAxialMm: number;
  readonly lensRadialMm: number;
  /** Radio de la abertura del iris, mm. */
  readonly irisApertureMm: number;
  /** Radios de la vaina a 3 mm retroglobo (convención externa, mm). */
  readonly sheathRadiusExtMm: number;
  /** Radio del nervio (ONND), mm. */
  readonly nerveRadiusMm: number;
  /** Grosor dural, mm. */
  readonly duraMm: number;
  /** Excentricidad de la vaina (razón de ejes menor/mayor). */
  readonly sheathEcc: number;
  /** Desviación de la mirada (ángulo del eje ocular), rad — fase posterior; 0 en N1. */
  readonly gazeAngleRad: number;
}

/** Adulto de referencia N1: dos ojos con asimetría pequeña documentada. */
export function buildReferenceEyes(rng: SeededRandom): { der: EyeGeometry; izq: EyeGeometry } {
  const mk = (side: Side): EyeGeometry => {
    const sign = side === 'izq' ? 1 : -1; // ojo izquierdo en +x
    const center: Vec3 = [sign * EYE.centerAbsXmm.value, EYE.centerYmm.value, EYE.centerZmm.value];
    const anterior = normalize(v3(0, 0, 1));
    const temporal = normalize(v3(-sign, 0, 0)); // temporal = hacia afuera
    const superior = v3(0, 1, 0);
    // Asimetrías documentadas del fixture (pequeñas, deterministas).
    const r = rng.fork(`eye-${side}`);
    return {
      side,
      center,
      anterior,
      temporal,
      superior,
      globeRadiusMm:
        EYE.globeRadiusMm.value + r.range(-EYE.globeRadiusJitterMm.value, EYE.globeRadiusJitterMm.value),
      lensAxialMm: EYE.lensAxialMm.value,
      lensRadialMm: EYE.lensRadialMm.value,
      irisApertureMm: EYE.irisApertureMm.value,
      sheathRadiusExtMm: (MANIFEST.case.dvnoIntMm[side] + 2 * DURA_MM) / 2,
      nerveRadiusMm: EYE.nerveRadiusMm.value,
      duraMm: DURA_MM,
      sheathEcc: EYE.sheathEcc.value + r.range(-EYE.sheathEccJitter.value, EYE.sheathEccJitter.value),
      gazeAngleRad: 0,
    };
  };
  return { der: mk('der'), izq: mk('izq') };
}

/** Convierte un punto del paciente al marco local del ojo (anterior=+z, temporal=+x, superior=+y). */
export function toEyeLocal(g: EyeGeometry, p: Vec3): Vec3 {
  const d = sub(p, g.center);
  return [dot(d, g.temporal), dot(d, g.superior), dot(d, g.anterior)];
}

export function fromEyeLocal(g: EyeGeometry, p: Vec3): Vec3 {
  return add(g.center, add(add(scale(g.temporal, p[0]), scale(g.superior, p[1])), scale(g.anterior, p[2])));
}

/**
 * Línea central del nervio óptico en el MARCO LOCAL del ojo: parte de la
 * papila (polo posterior, ~1.2 mm nasal = −x local) y se dirige posterior y
 * nasalmente con una curva suave. `sMm` = mm por detrás del globo.
 */
export function nerveCenterline(g: EyeGeometry, sMm: number): Vec3 {
  const bend = 1 - Math.exp(-sMm / 18); // 0→1
  return [
    -(1.2 + 6.0 * bend), // x local: nasal (−x porque +x local = temporal)
    -0.4 * bend, // y local: leve descenso
    -(g.globeRadiusMm + sMm), // z local: posterior
  ];
}

/**
 * Distancia con signo a la envoltura de la vaina en el corte transversal local
 * al nervio, evaluada en el punto `pLocal` (marco del ojo). Devuelve también
 * la coordenada axial s (mm retroglobo) del centro más cercano.
 *
 * Aproximación: para un punto cuya z cae por detrás del globo, se busca el s
 * que minimiza la distancia al centro del nervio (marcha corta) y se evalúan
 * las secciones elípticas en el plano perpendicular al trayecto.
 */
export function nerveSection(
  g: EyeGeometry,
  pLocal: Vec3,
): { sMm: number; distToCenterMm: number; inPlane: Vec3 } {
  // Búsqueda de s que minimiza distancia a la línea central (s ∈ [0, 40]).
  let bestS = 0;
  let bestD = Infinity;
  for (let s = 0; s <= 40; s += 1) {
    const c = nerveCenterline(g, s);
    const d = dist(pLocal, c);
    if (d < bestD) {
      bestD = d;
      bestS = s;
    }
  }
  // Refinado parabólico ±1 mm.
  for (const s of [bestS - 1, bestS + 1]) {
    if (s < 0) continue;
    const c = nerveCenterline(g, s);
    const d = dist(pLocal, c);
    if (d < bestD) {
      bestD = d;
      bestS = s;
    }
  }
  const c = nerveCenterline(g, bestS);
  const off = sub(pLocal, c);
  // El plano local del nervio: la sección elíptica rota suavemente con s
  // (las vainas no son circulares; eje mayor aproximadamente horizontal).
  return { sMm: bestS, distToCenterMm: bestD, inPlane: off };
}

/** Radios efectivos de la vaina a distancia s retroglobo (mm). */
export function sheathRadiiAt(g: EyeGeometry, sMm: number): { minor: number; major: number; nerve: number } {
  // La vaina se adelgaza ligeramente hacia el ápex; el nervio es ~constante.
  const taper = 1 - EYE.sheathTaper.value * smoothstep(0, 40, sMm);
  const ext = g.sheathRadiusExtMm * taper;
  return {
    minor: ext * g.sheathEcc,
    major: ext,
    nerve: g.nerveRadiusMm * (1 - EYE.nerveTaper.value * smoothstep(0, 40, sMm)),
  };
}

/**
 * Clasifica un punto del marco local del ojo en un material.
 * El orden importa: estructuras internas primero, tejido de fondo después.
 */
export function classifyEyeLocal(g: EyeGeometry, p: Vec3): MaterialId {
  const [x, y, z] = p;
  const r = g.globeRadiusMm;

  // Fuera de toda región orbitaria → aire muy anterior o tejido facial.
  // Anterior al globo: párpado+gel hasta z = r+4; más allá, aire.
  const anteriorSurface = r + EYE.eyelidAnteriorMm.value; // frente del párpado sobre el globo
  if (z > anteriorSurface + EYE.eyelidAirGapMm.value) return 'aire';
  if (z > anteriorSurface) return 'gel';

  // Párpado: capa de 1.2 mm sobre la córnea/polo anterior.
  const dGlobe = Math.hypot(x, y, Math.min(z, r));
  if (z > r - EYE.irisPlaneHalfMm.value && z <= anteriorSurface && dGlobe < r + EYE.eyelidLayerMm.value) {
    // párpado solo cubre la abertura palpebral (|y| < 9)
    if (Math.abs(y) < EYE.eyelidHalfHeightMm.value) return 'piel';
    return 'aire';
  }
  // Gel entre párpado y córnea.
  if (z > r - EYE.irisPlaneHalfMm.value && dGlobe >= r + EYE.eyelidLayerMm.value) return 'aire';

  // Cristalino: elipsoide biconvexo centrado en z = r − 3.4 (≈8.6 tras polo anterior).
  const lensC = r - EYE.lensCenterOffsetMm.value;
  const lensR = Math.hypot(x, y);
  const lensSdf =
    (lensR * lensR) / (g.lensRadialMm * g.lensRadialMm) +
    ((z - lensC) * (z - lensC)) / (g.lensAxialMm * g.lensAxialMm);
  if (lensSdf <= 1) return 'cristalino';

  // Cámara anterior + iris: capa entre córnea y cristalino.
  if (z > r - EYE.anteriorChamberDepthMm.value && z <= r - EYE.irisPlaneHalfMm.value && dGlobe <= r) {
    // córnea: capa anterior 0.55 mm
    if (z > r - EYE.corneaLayerMm.value) return 'cornea';
    // iris: anillo en el plano del cristalino anterior
    if (
      Math.abs(z - (r - EYE.irisPlaneOffsetMm.value)) < EYE.irisPlaneHalfMm.value &&
      lensR > g.irisApertureMm
    )
      return 'iris';
    return 'humorAcuoso';
  }

  // Dentro del globo.
  const dg = Math.hypot(x, y, z);
  if (dg <= r) {
    // pared posterior: capa de ~0.7 mm; la papila (zona de inserción) queda
    // dentro de la pared con respuesta parecida.
    if (dg > r - EYE.globeWallMm.value) return 'paredGlobo';
    return 'vitrio';
  }

  // Detrás del globo: nervio + vaina, grasa retrobulbar, músculos, hueso.
  if (z < 0) {
    const sec = nerveSection(g, p);
    const radii = sheathRadiiAt(g, sec.sMm);
    // Sección elíptica: coordenadas en el plano local del nervio.
    // Aproximación: ejes delipse alineados a (x local inclinado, y).
    const a = radii.major;
    const b = radii.minor;
    // Distancia elíptica normalizada.
    const en = Math.hypot(sec.inPlane[0] / a, sec.inPlane[1] / b);
    if (en <= 1) {
      const eNerve = sec.distToCenterMm / radii.nerve;
      if (eNerve <= 1) return 'nervioOptico';
      if (en <= (a - g.duraMm) / a) return 'lcrVaina';
      return 'duraVaina';
    }
    // Músculos rectos: bandas superior/inferior/medial/lateral a 9-13 mm del nervio.
    const dNerve = sec.distToCenterMm;
    const muscleMask =
      sec.sMm > 4 &&
      dNerve > a + 1 &&
      dNerve < a + 4.5 &&
      (Math.abs(Math.abs(sec.inPlane[1]) - 8) < 1.6 || Math.abs(Math.abs(sec.inPlane[0]) - 8) < 1.6);
    if (muscleMask) return 'musculoRecto';
    // Paredes orbitarias: cono óseo — a >30 mm tras el globo o fuera del cono.
    const coneR = 14 - 8 * smoothstep(0, 45, -z);
    if (Math.hypot(x, y) > coneR + 2 || z < -48) return 'hueso';
    return 'grasaOrbitaria';
  }

  // Lateral del globo fuera: grasa/tejido orbitario anterior o hueso.
  const coneRAnt = 16;
  if (Math.hypot(x - 0, y) > coneRAnt || Math.abs(x) > 18) return 'hueso';
  return 'grasaOrbitaria';
}

/** Clasifica un punto del paciente en un ojo concreto. */
export function classifyEye(g: EyeGeometry, p: Vec3): MaterialId {
  return classifyEyeLocal(g, toEyeLocal(g, p));
}

/** Material con propiedades del punto (atajo). */
export function materialAtEye(g: EyeGeometry, p: Vec3): Material {
  return MATERIALS[classifyEye(g, p)];
}

/**
 * DVNO verdadero del modelo a `sMm` mm retroglobo (convención externa = dura a
 * dura; interna = excluye la dura). Sirve de verdad para evaluar el caliper.
 */
export function trueOnsdMm(g: EyeGeometry, sMm: number, convention: 'interno' | 'externo'): number {
  const r = sheathRadiiAt(g, sMm);
  const ext = 2 * r.major;
  return convention === 'externo' ? ext : ext - 2 * g.duraMm;
}
