/**
 * Anatomía implícita de la órbita (campos de distancia), bilateral.
 *
 * Marco del paciente (mm, levógiro): +x = izquierda del paciente,
 * +y = superior, +z = anterior. Cada ojo tiene un marco local:
 * origen en el centro del globo, ez anterior (hacia el párpado),
 * ex temporal (alejándose de la línea media), ey superior.
 *
 * Escena N2: párpado/gel, córnea como esfera propia que sobresale del globo,
 * cámara anterior anecoica, plano del iris con pupila, cuerpo ciliar en la
 * raíz, cristalino biconvexo anecoico con cápsula ecogénica, vítreo anecoico,
 * pared posterior trilaminar (retina/coroides/esclera con esclera brillante),
 * papila con lámina cribosa, nervio óptico hipoecoico con vaina (nervio /
 * LCR / dura) y vasos retinianos centrales, grasa retrobulbar hiperecoica
 * con septos, cuatro rectos convergiendo al ápex y cono orbitario óseo.
 *
 * Dimensiones: adulto de referencia; el nervio NO es un cilindro perfecto —
 * excentricidad de la vaina ~0,5 según estudio 3D [silverman-3d-onsd-2026].
 */
import { MATERIALS, type Material, type MaterialId } from './materials';
import { add, cross, dist, dot, normalize, scale, smoothstep, sub, v3, type Vec3 } from '../core/vec3';
import type { SeededRandom } from '../core/random';
import type { Side } from '../domain/contracts';
import { ANATOMIA_OJO } from './params';
import type { Vessel } from './head';
import { vesselContains } from './head';
import { buildOcularVessels } from './ocularVessels';

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
  /** Fase determinista de la tortuosidad del nervio, rad. */
  readonly tortuosityPhaseRad: number;
  /**
   * Vasos retrobulbares (ACR, VCR, AO, VOS, 2 ACP) en coordenadas del
   * paciente — misma interfaz `Vessel` que Willis (ver `ocularVessels.ts`).
   */
  readonly vessels: readonly Vessel[];
}

/** Adulto de referencia N1: dos ojos con asimetría pequeña documentada. */
export function buildReferenceEyes(
  rng: SeededRandom,
  dvnoIntMm: Readonly<Record<Side, number>> = {
    der: EYE.dvnoIntDerMm.value,
    izq: EYE.dvnoIntIzqMm.value,
  },
): { der: EyeGeometry; izq: EyeGeometry } {
  const mk = (side: Side): EyeGeometry => {
    const sign = side === 'izq' ? 1 : -1; // ojo izquierdo en +x
    const center: Vec3 = [sign * EYE.centerAbsXmm.value, EYE.centerYmm.value, EYE.centerZmm.value];
    const anterior = normalize(v3(0, 0, 1));
    const temporal = normalize(v3(-sign, 0, 0)); // temporal = hacia afuera
    const superior = v3(0, 1, 0);
    // Asimetrías documentadas del fixture (pequeñas, deterministas).
    const r = rng.fork(`eye-${side}`);
    const base = {
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
      sheathRadiusExtMm: (dvnoIntMm[side] + 2 * DURA_MM) / 2,
      nerveRadiusMm: EYE.nerveRadiusMm.value,
      duraMm: DURA_MM,
      sheathEcc: EYE.sheathEcc.value + r.range(-EYE.sheathEccJitter.value, EYE.sheathEccJitter.value),
      gazeAngleRad: EYE.gazeAngleRad.value,
      tortuosityPhaseRad: r.range(0, 2 * Math.PI),
    };
    // Los vasos se construyen tras el marco: `fromEyeLocal` necesita la base.
    return { ...base, vessels: buildOcularVessels(base) };
  };
  return { der: mk('der'), izq: mk('izq') };
}

/** Convierte un punto del paciente al marco local del ojo (anterior=+z, temporal=+x, superior=+y). */
export function toEyeLocal(
  g: Pick<EyeGeometry, 'center' | 'temporal' | 'superior' | 'anterior'>,
  p: Vec3,
): Vec3 {
  const d = sub(p, g.center);
  return [dot(d, g.temporal), dot(d, g.superior), dot(d, g.anterior)];
}

export function fromEyeLocal(
  g: Pick<EyeGeometry, 'center' | 'temporal' | 'superior' | 'anterior'>,
  p: Vec3,
): Vec3 {
  return add(g.center, add(add(scale(g.temporal, p[0]), scale(g.superior, p[1])), scale(g.anterior, p[2])));
}

/**
 * Línea central del nervio óptico en el MARCO LOCAL del ojo: parte de la
 * papila (polo posterior, ~1.2 mm nasal = −x local) y se dirige posterior y
 * nasalmente con una curva suave. `sMm` = mm por detrás del globo.
 */
export function nerveCenterline(
  g: Pick<EyeGeometry, 'gazeAngleRad' | 'tortuosityPhaseRad' | 'globeRadiusMm'>,
  sMm: number,
): Vec3 {
  const bend = 1 - Math.exp(-sMm / 18); // 0→1
  const gaze = g.gazeAngleRad;
  const tortuosity =
    EYE.tortuosityAmpMm.value *
    Math.sin((2 * Math.PI * sMm) / EYE.tortuosityPeriodMm.value + g.tortuosityPhaseRad);
  return [
    -(1.2 + EYE.nerveNasalBendMm.value * bend) + sMm * Math.sin(gaze) + tortuosity,
    -0.4 * bend, // y local: leve descenso
    -(g.globeRadiusMm + sMm * Math.cos(gaze)), // z local: posterior
  ];
}

/**
 * Tangente unitaria de `nerveCenterline` en `sMm` (derivada analítica,
 * sentido posterior = s creciente), marco local del ojo.
 */
export function nerveTangent(g: Pick<EyeGeometry, 'gazeAngleRad' | 'tortuosityPhaseRad'>, sMm: number): Vec3 {
  return normalize(nerveDerivative(g, sMm));
}

/** dc/ds de `nerveCenterline` (sin normalizar; |dc/ds| ≥ cos(mirada)). */
function nerveDerivative(g: Pick<EyeGeometry, 'gazeAngleRad' | 'tortuosityPhaseRad'>, sMm: number): Vec3 {
  const dBend = Math.exp(-sMm / 18) / 18;
  const gaze = g.gazeAngleRad;
  const k = (2 * Math.PI) / EYE.tortuosityPeriodMm.value;
  const dTort = EYE.tortuosityAmpMm.value * k * Math.cos(k * sMm + g.tortuosityPhaseRad);
  return [-EYE.nerveNasalBendMm.value * dBend + Math.sin(gaze) + dTort, -0.4 * dBend, -Math.cos(gaze)];
}

/** Marco ortonormal de la sección del nervio (marco local del ojo). */
export interface NerveFrame {
  /** Centro de la sección (punto de la línea central). */
  readonly c: Vec3;
  /** Tangente unitaria (posterior, s creciente). */
  readonly t: Vec3;
  /** Eje mayor de la vaina: +x local (temporal) proyectado ⟂ t. */
  readonly u: Vec3;
  /** Eje menor: v = u × t (≈ superior, +y local). */
  readonly v: Vec3;
}

/**
 * Marco de la sección perpendicular del nervio en `sMm` (DEC-57), compartido
 * por la clasificación de la vaina, los vasos intraneurales/ciliares y el
 * navegador 3D: u = normaliza(eₓ − (eₓ·t)t), v = u × t. Con t posterior
 * (≈ −z local) este producto da v ≈ +y (superior); t × u daría −y.
 */
export function nerveFrame(
  g: Pick<EyeGeometry, 'gazeAngleRad' | 'tortuosityPhaseRad' | 'globeRadiusMm'>,
  sMm: number,
): NerveFrame {
  const c = nerveCenterline(g, sMm);
  const t = nerveTangent(g, sMm);
  const u = normalize([1 - t[0] * t[0], -t[0] * t[1], -t[0] * t[2]]);
  const v = cross(u, t);
  return { c, t, u, v };
}

/** Dirección del marco local del ojo expresada en el marco del paciente. */
export function eyeLocalDir(g: Pick<EyeGeometry, 'temporal' | 'superior' | 'anterior'>, d: Vec3): Vec3 {
  return add(add(scale(g.temporal, d[0]), scale(g.superior, d[1])), scale(g.anterior, d[2]));
}

/**
 * Tolerancia axial de la sección (mm): un punto sólo pertenece a la vaina si
 * su componente a lo largo de la tangente del centro más cercano cumple
 * −NERVE_AXIAL_ANT_MM ≤ off·t ≤ NERVE_AXIAL_POST_MM. En el interior del
 * trayecto el mínimo de distancia da off·t ≈ 0; solo actúa en los extremos y
 * acota la caja de rechazo de `nerveSection`. En s = 0 la cuña entre la
 * esfera del globo y el plano de la sección (inclinado ~25° por la curva
 * nasal) llega a off·t ≈ −1,5 mm en N1 y ≈ −2,8 mm con la vaina máxima de
 * los casos (parada circulatoria); 5 mm no recorta la unión vaina–esclera
 * (test en anatomy.test.ts). En s = 40 el nervio acaba 1 mm tras el ápex
 * (hueso) en vez de prolongarse indefinidamente.
 */
const NERVE_AXIAL_ANT_MM = 5;
const NERVE_AXIAL_POST_MM = 1;
const NERVE_AXIAL_TOL_MM = Math.max(NERVE_AXIAL_ANT_MM, NERVE_AXIAL_POST_MM);

/**
 * Caché por geometría: línea central del nervio tabulada cada 0,25 mm
 * (s ∈ [0,40], 161 puntos) y caja envolvente de todas las secciones de la
 * vaina. La tabla almacena los valores exactos de `nerveCenterline`, así que
 * la marcha gruesa a paso 1 mm produce los mismos candidatos que antes.
 *
 * Caja (DEC-57): un punto dentro de la elipse de la sección s cumple
 * p = c + a·ξ·u + b·η·v + τ·t con ξ² + η² ≤ 1 y |τ| ≤ NERVE_AXIAL_TOL_MM,
 * luego |pₓ − cₓ| ≤ √(a²uₓ² + b²vₓ²) + tol·|tₓ| (función soporte de la
 * elipse rotada) y lo mismo en y. La caja acumula esa cota en las 161
 * muestras y añade 0,5 mm por la variación de c, a, b y el marco entre
 * muestras (|dc/ds| ≤ 1,2, |da/ds| < 0,1 → < 0,2 mm en medio paso).
 */
const nerveCurveCache = new WeakMap<
  EyeGeometry,
  { pts: Float32Array; minX: number; maxX: number; minY: number; maxY: number }
>();
function nerveCurve(g: EyeGeometry): {
  pts: Float32Array;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let t = nerveCurveCache.get(g);
  if (!t) {
    const pts = new Float32Array(161 * 3);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k <= 160; k += 1) {
      const s = k * 0.25;
      const { c, t: tan, u, v } = nerveFrame(g, s);
      pts[3 * k] = c[0];
      pts[3 * k + 1] = c[1];
      pts[3 * k + 2] = c[2];
      const { major: a, minor: b } = sheathRadiiAt(g, s);
      const hx = Math.hypot(a * u[0], b * v[0]) + NERVE_AXIAL_TOL_MM * Math.abs(tan[0]);
      const hy = Math.hypot(a * u[1], b * v[1]) + NERVE_AXIAL_TOL_MM * Math.abs(tan[1]);
      minX = Math.min(minX, c[0] - hx);
      maxX = Math.max(maxX, c[0] + hx);
      minY = Math.min(minY, c[1] - hy);
      maxY = Math.max(maxY, c[1] + hy);
    }
    // Margen por el movimiento del centro entre muestras de la tabla.
    const m = 0.5;
    t = { pts, minX: minX - m, maxX: maxX + m, minY: minY - m, maxY: maxY + m };
    nerveCurveCache.set(g, t);
  }
  return t;
}

/**
 * Caja de rechazo de `nerveSection` (marco local del ojo, x/y) y límites
 * axiales de la sección; expuesta para que los tests verifiquen la cota.
 */
export function nerveSectionBounds(g: EyeGeometry): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  axialAntMm: number;
  axialPostMm: number;
} {
  const { minX, maxX, minY, maxY } = nerveCurve(g);
  return { minX, maxX, minY, maxY, axialAntMm: NERVE_AXIAL_ANT_MM, axialPostMm: NERVE_AXIAL_POST_MM };
}

/**
 * Sección del nervio que contiene al punto `pLocal` (marco del ojo): s (mm
 * retroglobo) del centro más cercano (marcha gruesa + refinado), distancia 3D
 * a ese centro e `inPlane` = (off·u, off·v, off·t) en el marco de la sección
 * perpendicular (`nerveFrame`). La elipse de la vaina se evalúa en (u, v).
 */
export function nerveSection(
  g: EyeGeometry,
  pLocal: Vec3,
): { sMm: number; distToCenterMm: number; inPlane: Vec3 } {
  const table = nerveCurve(g);
  // Rechazo exacto: un punto de la vaina (elipse de la sección s en el marco
  // u/v, |τ| ≤ NERVE_AXIAL_TOL_MM) cae dentro de la caja de `nerveCurve`;
  // fuera de ella `classifyEyeLocal` no puede dar nervio/LCR/dura para ningún
  // s, así que se devuelve una sección sintética con inPlane fuera de la elipse.
  if (pLocal[0] < table.minX || pLocal[0] > table.maxX || pLocal[1] < table.minY || pLocal[1] > table.maxY) {
    return { sMm: 0, distToCenterMm: Infinity, inPlane: [1e6, 0, 0] };
  }
  // Búsqueda de s que minimiza distancia a la línea central (s ∈ [0, 40]).
  const pts = table.pts;
  let bestS = 0;
  let bestD = Infinity;
  for (let s = 0; s <= 40; s += 1) {
    const k = 4 * s;
    const dx = pLocal[0] - pts[3 * k]!;
    const dy = pLocal[1] - pts[3 * k + 1]!;
    const dzz = pLocal[2] - pts[3 * k + 2]!;
    const d = Math.hypot(dx, dy, dzz);
    if (d < bestD) {
      bestD = d;
      bestS = s;
    }
  }
  // Refinado ternario en [bestS−1, bestS+1]: quita la escalera de 1 mm.
  let lo = Math.max(0, bestS - 1);
  let hi = Math.min(40, bestS + 1);
  for (let i = 0; i < 4; i += 1) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (dist(pLocal, nerveCenterline(g, m1)) < dist(pLocal, nerveCenterline(g, m2))) hi = m2;
    else lo = m1;
  }
  // Pulido parabólico sobre el bracket final (vértice limitado a [lo, hi]).
  const fLo = dist(pLocal, nerveCenterline(g, lo));
  const fHi = dist(pLocal, nerveCenterline(g, hi));
  const mid = (lo + hi) / 2;
  const fMid = dist(pLocal, nerveCenterline(g, mid));
  const num = (mid - lo) ** 2 * (fMid - fHi) - (hi - mid) ** 2 * (fMid - fLo);
  const den = (mid - lo) * (fMid - fHi) - (hi - mid) * (fMid - fLo);
  bestS = Math.abs(den) < 1e-12 ? mid : Math.min(hi, Math.max(lo, mid - (0.5 * num) / den));
  // Paso de Gauss-Newton sobre (p − c(s))·c'(s) = 0: el pulido parabólico
  // deja residuos axiales de hasta ~0,25 mm (y s = 0,05 en vez de 0 en el
  // extremo del globo); un paso los reduce por debajo de ~0,01 mm.
  const c0 = nerveCenterline(g, bestS);
  const d0 = nerveDerivative(g, bestS);
  const step = dot(sub(pLocal, c0), d0) / dot(d0, d0);
  bestS = Math.min(40, Math.max(0, bestS + Math.max(-0.5, Math.min(0.5, step))));
  // Coordenadas en el marco de la sección perpendicular (DEC-57): u (eje
  // mayor, ≈ temporal), v (eje menor, ≈ superior) y t (axial, ≈ 0 salvo en
  // los extremos). Proyectar sobre u, v hace la sección insensible a errores
  // pequeños de s (un error δ sólo desplaza el punto a lo largo de t).
  const { c, t, u, v } = nerveFrame(g, bestS);
  const off = sub(pLocal, c);
  return {
    sMm: bestS,
    distToCenterMm: Math.hypot(off[0], off[1], off[2]),
    inPlane: [dot(off, u), dot(off, v), dot(off, t)],
  };
}

/** Radios efectivos de la vaina a distancia s retroglobo (mm). */
export function sheathRadiiAt(
  g: Pick<EyeGeometry, 'sheathRadiusExtMm' | 'sheathEcc' | 'nerveRadiusMm'>,
  sMm: number,
): { minor: number; major: number; nerve: number } {
  // La vaina se adelgaza ligeramente hacia el ápex; el nervio es ~constante.
  const taperAt = (s: number) => 1 - EYE.sheathTaper.value * smoothstep(0, 40, s);
  const taper = taperAt(sMm) / taperAt(3);
  const gaussian = Math.exp(-Math.pow((sMm - EYE.sheathBulbCenterMm.value) / EYE.sheathBulbSigmaMm.value, 2));
  const anchor = Math.exp(-Math.pow((3 - EYE.sheathBulbCenterMm.value) / EYE.sheathBulbSigmaMm.value, 2));
  const distalFade = Math.exp(-Math.pow(Math.max(0, sMm - 3) / EYE.sheathBulbSigmaMm.value, 2));
  const bulb = (anchor - gaussian) * distalFade;
  const ext = g.sheathRadiusExtMm * taper * (1 + EYE.sheathBulbFrac.value * bulb);
  return {
    minor: ext * g.sheathEcc,
    major: ext,
    nerve: g.nerveRadiusMm * (1 - EYE.nerveTaper.value * smoothstep(0, 40, sMm)),
  };
}

/**
 * Banda muscular recta inserción → ápex: sección elíptica 9 × 3,5 mm
 * (tangente × radial), adelgazando al 60 % hacia el ápex.
 */
/** Inserciones y ápex de los rectos en el marco local del ojo (mm). */
function rectusGeometry(g: EyeGeometry): { apex: Vec3; insertions: Vec3[] } {
  const r = g.globeRadiusMm;
  return {
    apex: [-1.5, -0.5, -(r + 42)],
    insertions: [
      [0, 11.5, r - 7], // superior
      [0, -11.5, r - 7], // inferior
      [-11.5, 0, r - 7], // medial (nasal, −x local)
      [11.5, 0, r - 7], // lateral (temporal, +x local)
    ],
  };
}

/** Trayectos inserción→ápex de los rectos en marco paciente (navegador 3D). */
export function rectusPaths(g: EyeGeometry): { insertion: Vec3; apex: Vec3 }[] {
  const { apex, insertions } = rectusGeometry(g);
  return insertions.map((ins) => ({
    insertion: fromEyeLocal(g, ins),
    apex: fromEyeLocal(g, apex),
  }));
}

function rectusAt(g: EyeGeometry, p: Vec3): boolean {
  const r = g.globeRadiusMm;
  const { apex, insertions } = rectusGeometry(g);
  for (const ins of insertions) {
    const axis = sub(apex, ins);
    const axisLen2 = dot(axis, axis);
    const t = dot(sub(p, ins), axis) / axisLen2;
    if (t < 0 || t > 1) continue;
    const q = add(ins, scale(axis, t));
    const d = sub(p, q);
    const len = Math.hypot(d[0], d[1], d[2]);
    // Eje radial de la elipse = dirección desde la línea del nervio.
    const sN = Math.min(40, Math.max(0, -q[2] - r));
    const nc = nerveCenterline(g, sN);
    const axisN = normalize(axis);
    const rel = sub(p, nc);
    const er = sub(rel, scale(axisN, dot(rel, axisN)));
    const erLen = Math.hypot(er[0], er[1], er[2]);
    if (erLen < 1e-6) continue;
    const compR = dot(d, [er[0] / erLen, er[1] / erLen, er[2] / erLen]);
    const compT = Math.sqrt(Math.max(0, len * len - compR * compR));
    const thin = 1 - 0.4 * t;
    if (Math.hypot(compT / (4.5 * thin), compR / (1.75 * thin)) <= 1) return true;
  }
  return false;
}

/**
 * Clasifica un punto del marco local del ojo en un material.
 * El orden importa: estructuras internas primero, tejido de fondo después.
 */
export function classifyEyeLocal(g: EyeGeometry, p: Vec3): MaterialId {
  const [x, y, z] = p;
  const r = g.globeRadiusMm;
  const dg = Math.hypot(x, y, z);
  const rxy = Math.hypot(x, y);

  // Vasos retrobulbares (grafo `g.vessels`, espacio del paciente): el tubo
  // del vaso manda sobre nervio, vaina, grasa o pared — sustituye el antiguo
  // tubo ACR cableado en la sección del nervio.
  const pp = fromEyeLocal(g, p);
  for (const v of g.vessels) {
    if (vesselContains(v, pp)) return 'vaso';
  }

  // Fuera de toda región orbitaria → aire muy anterior o tejido facial.
  const anteriorSurface = r + EYE.eyelidAnteriorMm.value; // frente del párpado sobre el globo
  if (z > anteriorSurface + EYE.eyelidAirGapMm.value) return 'aire';

  // Córnea: esfera propia de radio 7,8 mm que sobresale 2,6 mm del globo;
  // la capa de 0,55 mm solo existe en el casquete fuera del globo (limbo).
  const corneaR = 7.8;
  const corneaCz = r - corneaR + 2.6;
  const zLimb = (r * r + corneaCz * corneaCz - corneaR * corneaR) / (2 * corneaCz);
  const dCornea = Math.hypot(x, y, z - corneaCz);
  if (dCornea >= corneaR - EYE.corneaLayerMm.value && dCornea <= corneaR && z > zLimb - 0.05) {
    return 'cornea';
  }

  // Tejido blando anterior: la piel cubre toda la región palpebral
  // lateralmente hasta el reborde orbitario (rxy ≤ 18 mm); más allá, el
  // reborde óseo (sombra acústica). El aire solo queda anterior al
  // margen `anteriorSurface + eyelidAirGapMm` (línea del principio).
  if (z > r - 0.4) {
    if (rxy > 18) return 'hueso';
    if (z <= anteriorSurface) return 'piel';
    // sobre la superficie palpebral cae al gel de más abajo
  }

  // Iris: plano a r − 3,6 mm (cámara anterior ≈ 3 mm tras el endotelio),
  // desde la pupila (apertura) hasta la raíz a 6 mm.
  const irisZ = r - EYE.irisPlaneOffsetMm.value;
  if (Math.abs(z - irisZ) <= EYE.irisPlaneHalfMm.value && rxy >= g.irisApertureMm && rxy <= 6) {
    return 'iris';
  }
  // Cuerpo ciliar: toroide en la raíz del iris (6,3 mm, 1,2 × 1,8 mm).
  const ccR = (rxy - 6.3) / 1.2;
  const ccZ = (z - (r - 4.6)) / 1.8;
  if (ccR * ccR + ccZ * ccZ <= 1) return 'cuerpoCiliar';

  // Cristalino biconvexo: intersección de dos esferas (anterior R 10,
  // posterior R 6; grosor 4 mm, ecuador Ø 9 mm). Antes que la cámara para
  // que la cápsula anterior no quede tapada por el humor acuoso.
  const zAp = r - EYE.irisPlaneOffsetMm.value - 2 * EYE.irisPlaneHalfMm.value; // r − 4,0
  const zPp = zAp - 2 * g.lensAxialMm;
  const dA = Math.hypot(x, y, z - (zAp - EYE.lensAnteriorRadiusMm.value));
  const dP = Math.hypot(x, y, z - (zPp + EYE.lensPosteriorRadiusMm.value));
  if (
    dA <= EYE.lensAnteriorRadiusMm.value &&
    dP <= EYE.lensPosteriorRadiusMm.value &&
    rxy <= EYE.lensEquatorMm.value
  ) {
    const capsula =
      dA > EYE.lensAnteriorRadiusMm.value - 0.2 ||
      dP > EYE.lensPosteriorRadiusMm.value - 0.2 ||
      rxy > EYE.lensEquatorMm.value - 0.2;
    return capsula ? 'capsulaCristalino' : 'cristalino';
  }

  // Cámara anterior + posterior: dentro de la esfera corneal hasta el
  // polo anterior del cristalino.
  if (dCornea < corneaR - EYE.corneaLayerMm.value && z > r - 4.2) return 'humorAcuoso';

  // Gel entre párpado y córnea.
  if (z > anteriorSurface) return 'gel';

  const papillaCenter = nerveCenterline(g, 0);
  const papillaDistance = dist(p, papillaCenter);
  const inPapilla = papillaDistance <= EYE.papillaRadiusMm.value;
  // La lámina cribosa sustituye retina+coroides dentro de la papila.
  if (inPapilla && dg > r - Math.max(EYE.laminaThicknessMm.value, 0.55)) return 'laminaCribosa';

  // Dentro del globo: pared trilaminar (retina/coroides/esclera) + vítreo.
  if (dg <= r) {
    if (dg > r - 0.25) return 'paredGlobo';
    if (dg > r - 0.55) return 'coroides';
    if (dg > r - EYE.globeWallMm.value) return 'esclera';
    return 'vitrio';
  }

  // Cono óseo orbitario: radio 17 mm a z = +2 → 3,5 mm al ápex; hueso detrás.
  const coneR = z <= 2 ? 17 + (3.5 - 17) * ((2 - z) / (2 + r + 42)) : 17;

  // Detrás del globo: nervio + vaina, grasa retrobulbar, músculos, hueso.
  if (z < 0) {
    const sec = nerveSection(g, p);
    const radii = sheathRadiiAt(g, sec.sMm);
    // Sección elíptica en el marco perpendicular al nervio (u mayor, v menor).
    const a = radii.major;
    const b = radii.minor;
    const [su, sv, st] = sec.inPlane;
    const axialOk = st >= -NERVE_AXIAL_ANT_MM && st <= NERVE_AXIAL_POST_MM;
    const en = axialOk ? Math.hypot(su / a, sv / b) : Infinity;
    if (en <= 1) {
      const eNerve = Math.hypot(su, sv) / radii.nerve;
      if (eNerve <= 1) return 'nervioOptico';
      if (en <= (a - g.duraMm) / a) return 'lcrVaina';
      return 'duraVaina';
    }
    // Esclera/Tenon: el borde exterior de la pared sale 0,15 mm del globo.
    if (dg <= r + 0.15) return 'esclera';
    if (rectusAt(g, p)) return 'musculoRecto';
    if (rxy > coneR || z < -(r + 44)) return 'hueso';
    return 'grasaOrbitaria';
  }

  // Lateral/anterior del globo fuera de él: esclera, músculos, grasa, hueso.
  if (dg <= r + 0.15) return 'esclera';
  if (rectusAt(g, p)) return 'musculoRecto';
  if (rxy > coneR) return 'hueso';
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

/**
 * DVNO verdadero a lo largo del eje MENOR de la sección perpendicular (plano
 * sagital). Externa = 2·minor; interna = frontera LCR/dura de
 * `classifyEyeLocal` (elipse escalada (a − dura)/a) = excentricidad × interna
 * mayor.
 */
export function trueOnsdMinorMm(g: EyeGeometry, sMm: number, convention: 'interno' | 'externo'): number {
  const r = sheathRadiiAt(g, sMm);
  const ext = 2 * r.minor;
  return convention === 'externo' ? ext : ext * ((r.major - g.duraMm) / r.major);
}
