/**
 * Anatomía implícita de la cabeza para la exploración transtemporal.
 *
 * Marco del paciente (mm, levógiro): +x = izquierda, +y = superior,
 * +z = anterior. Cráneo como elipsoide con tabla ósea (hueso) cuya ventana
 * temporal tiene espesor y transmisión propios por paciente; dentro,
 * tejido cerebral, mesencéfalo (pedúnculos en «corazón»), cisternas basales
 * ecogénicas, ala esfenoidal y el polígono de Willis como tubos con línea
 * central, radio y orientación.
 *
 * Profundidades y direcciones de referencia (Siemens TCD job aid, guía AIUM):
 * M1 hacia la sonda a 45–65 mm, A1 alejándose a 60–85, bifurcación ACI a
 * 55–65 bidireccional, P1/P2 a 60–70, OA 40–60 por ventana orbital.
 */
import { MATERIALS, type MaterialId } from './materials';
import { clamp, dist, normalize, scale, sub, type Vec3 } from '../core/vec3';
import { hash3, hashString, type SeededRandom } from '../core/random';
import type { Side, WillisVariant } from '../domain/contracts';
import { ANATOMIA_CABEZA } from './params';
import { buildWillisVessels } from './willis';

const HEAD = ANATOMIA_CABEZA.params;

/** Un vaso tubular: línea central por segmentos + radio local. */
export interface Vessel {
  readonly id: string;
  readonly side: Side | 'media';
  /** Polilínea suave (Catmull-Rom remuestreada ~1 mm) usada en clasificación. */
  readonly points: readonly Vec3[];
  /** Puntos de control anatómicos que definen el vaso. */
  readonly controlPoints: readonly Vec3[];
  readonly radiusMm: number;
  /** Caja envolvente de `points` ± radio, para rechazo rápido por muestra. */
  readonly aabb: { readonly min: Vec3; readonly max: Vec3 };
  /** +1 orienta el flujo de points[0] hacia el último; −1 invierte esa dirección. */
  readonly flowSign: 1 | -1;
  /** Flujo medio del segmento, ml/min, positivo en la orientación anatómica. */
  readonly flowMlMin: number;
  /** Velocidad media derivada de Q/(πr²·0,6), cm/s. */
  readonly meanCms: number;
  /** Velocidad sistólica pico de referencia, cm/s. */
  readonly psvCms: number;
  /** Velocidad telediastólica de referencia, cm/s. */
  readonly edvCms: number;
}

/** Cabeza del adulto de referencia con ventanas temporales. */
export interface HeadGeometry {
  /** Centro del elipsoide craneal. */
  readonly skullCenter: Vec3;
  /** Semiejes del cráneo exterior, mm. */
  readonly skullRadii: Vec3;
  /** Espesor óseo fuera de la ventana, mm. */
  readonly skullThicknessMm: number;
  /** Espesor óseo dentro de la ventana temporal, mm. */
  readonly windowThicknessMm: number;
  /** Factor de transmisión de la ventana [0,1] (1 = ideal). */
  readonly windowQuality: number;
  /** Centro de cada ventana temporal sobre la superficie, por lado. */
  readonly windowCenter: Record<Side, Vec3>;
  /** Radio útil de la ventana, mm. */
  readonly windowRadiusMm: number;
  readonly vessels: readonly Vessel[];
  /** Centro del mesencéfalo. */
  readonly midbrainCenter: Vec3;
  readonly midbrainRadii: Vec3;
  /** Centro del III ventrículo en el plano diencefálico. */
  readonly thirdVentricleCenter: Vec3;
}

export type LandmarkId =
  | 'mesencefalo'
  | 'sustanciaNegra'
  | 'nucleoRojo'
  | 'rafe'
  | 'cisternaInterpeduncular'
  | 'tercerVentriculo'
  | 'talamo'
  | 'pineal'
  | 'cuernoFrontal'
  | 'alaEsfenoidal'
  | 'penasco'
  | 'craneoContralateral';

/** Distancia al segmento ab. */
function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const t = clamp(
    ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) /
      Math.max(1e-9, abx * abx + aby * aby + abz * abz),
    0,
    1,
  );
  const qx = a[0] + abx * t;
  const qy = a[1] + aby * t;
  const qz = a[2] + abz * t;
  return Math.hypot(p[0] - qx, p[1] - qy, p[2] - qz);
}

/** Distancia al tubo (polilínea) de un vaso. */
export function vesselDistance(v: Vessel, p: Vec3): number {
  const { min, max } = v.aabb;
  if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1] || p[2] < min[2] || p[2] > max[2]) {
    return Infinity;
  }
  let d = Infinity;
  for (let i = 0; i + 1 < v.points.length; i++) {
    d = Math.min(d, segDist(p, v.points[i]!, v.points[i + 1]!));
  }
  return d - v.radiusMm;
}

/** Punto más cercano sobre la línea central y tangente local. */
export function vesselClosest(v: Vessel, p: Vec3): { point: Vec3; tangent: Vec3; sMm: number } {
  const { min, max } = v.aabb;
  if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1] || p[2] < min[2] || p[2] > max[2]) {
    return { point: [...v.points[0]!] as Vec3, tangent: [1, 0, 0], sMm: 0 };
  }
  let bestX = v.points[0]![0];
  let bestY = v.points[0]![1];
  let bestZ = v.points[0]![2];
  let bestTx = 0;
  let bestTy = 0;
  let bestTz = 0;
  let bestS = 0;
  {
    const abx = v.points[1]![0] - bestX;
    const aby = v.points[1]![1] - bestY;
    const abz = v.points[1]![2] - bestZ;
    const l = Math.hypot(abx, aby, abz);
    if (l > 0) {
      bestTx = abx / l;
      bestTy = aby / l;
      bestTz = abz / l;
    }
  }
  let bestD = Infinity;
  let sAcc = 0;
  for (let i = 0; i + 1 < v.points.length; i++) {
    const a = v.points[i]!;
    const b = v.points[i + 1]!;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const len = Math.hypot(abx, aby, abz);
    const t = clamp(
      ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / Math.max(1e-9, len * len),
      0,
      1,
    );
    const qx = a[0] + abx * t;
    const qy = a[1] + aby * t;
    const qz = a[2] + abz * t;
    const d = Math.hypot(p[0] - qx, p[1] - qy, p[2] - qz);
    if (d < bestD) {
      bestD = d;
      bestX = qx;
      bestY = qy;
      bestZ = qz;
      if (len > 0) {
        bestTx = abx / len;
        bestTy = aby / len;
        bestTz = abz / len;
      } else {
        bestTx = 0;
        bestTy = 0;
        bestTz = 0;
      }
      bestS = sAcc + t * len;
    }
    sAcc += len;
  }
  return { point: [bestX, bestY, bestZ], tangent: [bestTx, bestTy, bestTz], sMm: bestS };
}

/** Dirección del flujo en el punto (vector de la línea central orientada). */
export function vesselFlowDir(v: Vessel, p: Vec3): Vec3 {
  return scale(vesselClosest(v, p).tangent, v.flowSign);
}

/**
 * Cabeza del adulto de referencia N1.
 * Ventana temporal: sobre el arco cigomático, anterior a la oreja; centros
 * calculados sobre el elipsoide. `windowQuality` estable por paciente.
 */
export function buildReferenceHead(
  rng: SeededRandom,
  variant: WillisVariant = 'normal',
  vesselRadiusScale: Readonly<Record<string, number>> = {},
  windowOverride: { thicknessMm?: number; quality?: number } = {},
): HeadGeometry {
  const skullCenter: Vec3 = [HEAD.skullCenterXmm.value, HEAD.skullCenterYmm.value, HEAD.skullCenterZmm.value];
  const skullRadii: Vec3 = [HEAD.skullRadiusXmm.value, HEAD.skullRadiusYmm.value, HEAD.skullRadiusZmm.value];
  const r = rng.fork('head');
  const windowThicknessMm = windowOverride.thicknessMm ?? HEAD.windowThicknessMm.value + r.range(0, 0.4);
  const windowQuality = windowOverride.quality ?? HEAD.windowQuality.value; // adulto de referencia: ventana utilizable

  // Ventana: punto del elipsoide a azimut lateral y algo anterior (pterion).
  const mkWindow = (side: Side): Vec3 => {
    const s = side === 'izq' ? 1 : -1;
    const az = s * Math.PI * HEAD.windowAzimuthTurns.value; // hacia ±x, algo anterior
    const el = HEAD.windowElevationRad.value; // algo por debajo del ecuador
    const dir: Vec3 = [
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el) * HEAD.windowAnteriorFactor.value,
    ];
    const nd = normalize(dir);
    return [
      skullCenter[0] + nd[0] * skullRadii[0],
      skullCenter[1] + nd[1] * skullRadii[1],
      skullCenter[2] + nd[2] * skullRadii[2],
    ];
  };

  return {
    skullCenter,
    skullRadii,
    skullThicknessMm: HEAD.skullThicknessMm.value,
    windowThicknessMm,
    windowQuality,
    windowCenter: { der: mkWindow('der'), izq: mkWindow('izq') },
    windowRadiusMm: HEAD.windowRadiusMm.value,
    vessels: buildWillisVessels(variant, vesselRadiusScale),
    midbrainCenter: [
      HEAD.midbrainCenterXmm.value,
      HEAD.midbrainCenterYmm.value,
      HEAD.midbrainCenterZmm.value,
    ],
    midbrainRadii: [HEAD.midbrainRadiusXmm.value, HEAD.midbrainRadiusYmm.value, HEAD.midbrainRadiusZmm.value],
    thirdVentricleCenter: [
      HEAD.midbrainCenterXmm.value,
      HEAD.midbrainCenterYmm.value + 12,
      HEAD.midbrainCenterZmm.value - 9,
    ],
  };
}

/** Posición radial normalizada dentro del elipsoide craneal (≤1 dentro). */
function ellipsoidLevel(c: Vec3, radii: Vec3, p: Vec3): number {
  const d = sub(p, c);
  return Math.hypot(d[0] / radii[0], d[1] / radii[1], d[2] / radii[2]);
}

/**
 * Ruido de retícula trilineal en [-1,1] con paso configurable (idéntico al
 * de speckle.ts; duplicado aquí porque anatomy no puede importar ultrasound).
 */
function latticeNoise(seed: string, p: Vec3, pitchMm: number): number {
  const fx = p[0] / pitchMm;
  const fy = p[1] / pitchMm;
  const fz = p[2] / pitchMm;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const sz = tz * tz * (3 - 2 * tz);
  const nodeSeed = hashString(seed);
  let acc = 0;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
        const node = ((x0 + dx) * 73856093) ^ ((y0 + dy) * 19349663) ^ ((z0 + dz) * 83492791);
        acc += w * (2 * hash3(node, 0, 0, nodeSeed) - 1);
      }
    }
  }
  return acc;
}

/** Distancia al centro de ventana más cercano (cualquier lado). */
function windowDistance(h: HeadGeometry, p: Vec3): number {
  return Math.min(dist(p, h.windowCenter.izq), dist(p, h.windowCenter.der));
}

/** ¿Está el punto dentro de la ventana temporal del lado indicado? */
export function inTemporalWindow(h: HeadGeometry, side: Side, p: Vec3): boolean {
  return skullThicknessAt(h, p) < (h.skullThicknessMm + h.windowThicknessMm) / 2;
}

/**
 * Espesor óseo efectivo en un punto de la tabla craneal: campo suave que
 * adelgaza hacia la ventana temporal más cercana (escamosa) más un jitter
 * determinista de ±0,3 mm que rompe la tabla interna perfecta.
 */
export function skullThicknessAt(h: HeadGeometry, p: Vec3): number {
  const d = windowDistance(h, p);
  const w = Math.exp(-((d / h.windowRadiusMm) ** 2));
  return h.skullThicknessMm - (h.skullThicknessMm - h.windowThicknessMm) * w;
}

/**
 * Espesor con jitter determinista de ±0,3 mm (ruido de 6 mm) que rompe la
 * tabla interna perfecta; nulo en el centro de la ventana.
 */
export function skullThicknessJittered(h: HeadGeometry, p: Vec3): number {
  const d = windowDistance(h, p);
  const w = Math.exp(-((d / h.windowRadiusMm) ** 2));
  return skullThicknessAt(h, p) + 0.3 * latticeNoise('craneo:tabla', p, 6) * (1 - w);
}

/**
 * ¿El punto cae dentro de la tabla interna del cráneo? Versión barata sin
 * jitter: basta para decidir si la pulsación cerebral aplica.
 */
export function insideInnerTable(h: HeadGeometry, p: Vec3): boolean {
  const t = skullThicknessAt(h, p);
  return (
    ellipsoidLevel(h.skullCenter, [h.skullRadii[0] - t, h.skullRadii[1] - t, h.skullRadii[2] - t], p) <= 1.0
  );
}

/**
 * Clasifica un punto del paciente para la escena transcraneal.
 * Orden: fuera de la cabeza → piel/cuero cabelludo → hueso → vasos →
 * mesencéfalo → cisternas → tejido cerebral.
 */
export function classifyHead(h: HeadGeometry, p: Vec3): MaterialId {
  const level = ellipsoidLevel(h.skullCenter, h.skullRadii, p);
  if (level > 1.0) {
    // Cuero cabelludo: 2,5 mm de piel y, en la fosa temporal, ~5 mm de
    // músculo temporal hipoecoico debajo; fuera de ella, solo piel.
    const scalpMm = Math.min(...h.skullRadii.map((r) => r)) * (level - 1.0);
    const inFossa = windowDistance(h, p) < 1.6 * h.windowRadiusMm;
    const totalMm = inFossa ? 7.5 : 2.5;
    if (scalpMm > totalMm) return 'aire';
    // Piel en los 2,5 mm más externos; debajo, temporalis solo en la fosa.
    if (scalpMm > totalMm - 2.5 || !inFossa) return 'piel';
    return 'musculoTemporal';
  }
  // El jitter de la tabla solo decide píxeles a <~1 mm de la superficie
  // interna; en el parénquima profundo basta el espesor suave (sin ruido).
  const rMin = Math.min(h.skullRadii[0], h.skullRadii[1], h.skullRadii[2]);
  let innerLevel = ellipsoidLevel(
    h.skullCenter,
    [
      h.skullRadii[0] - skullThicknessAt(h, p),
      h.skullRadii[1] - skullThicknessAt(h, p),
      h.skullRadii[2] - skullThicknessAt(h, p),
    ],
    p,
  );
  if (Math.abs(innerLevel - 1.0) < 1.2 / rMin) {
    const boneMm = skullThicknessJittered(h, p);
    innerLevel = ellipsoidLevel(
      h.skullCenter,
      [h.skullRadii[0] - boneMm, h.skullRadii[1] - boneMm, h.skullRadii[2] - boneMm],
      p,
    );
  }
  if (innerLevel > 1.0) return 'hueso';

  // Vasos intracraneales (antes que el tejido cerebral de fondo).
  for (const v of h.vessels) {
    if (vesselDistance(v, p) < 0) return 'vaso';
  }

  const diencephalon = classifyDiencephalon(h, p);
  if (diencephalon) return diencephalon;

  const special = classifyMidbrainSpecial(h, p);
  if (special) return special;

  // Mesencéfalo en mariposa: dos pedúnculos y un tegmento posterior.
  const mb = butterflyLevel(h, p);
  if (mb <= 1.0) return 'mesencefalo';

  // Cisternas basales: borde ecogénico fino (~3 mm) alrededor del mesencéfalo.
  if (mb < 1.22) return 'cisterna';

  // Fisura silviana/ínsula: banda ecogénica (LCR+pía) a lo largo del M1.
  const sylvian = sylvianDist(p);
  if (sylvian < 1.2) return 'cisterna';

  if (isPetrous(h, p)) return 'hueso';

  // Ala esfenoidal: cresta ecogénica anterior-lateral (referencia M1/ACA).
  if (isSphenoid(h, p)) return 'hueso';

  // Hoz: lámina dural de línea media por encima del cuerpo calloso.
  if (Math.abs(p[0]) < 0.6 && p[1] > h.midbrainCenter[1] + 8) return 'hoz';

  // Corteza: banda de ~3 mm pegada a la tabla interna; dentro, sustancia blanca.
  if (innerLevel > 1.0 - 3 / Math.min(...h.skullRadii)) return 'tejidoCerebral';
  return 'sustanciaBlanca';
}

/** Polilínea de la fisura silviana lateral por lado (mm, marco paciente). */
function sylvianDist(p: Vec3): number {
  const s = p[0] >= 0 ? 1 : -1;
  const pts: Vec3[] = [
    [s * 30, 12, 5],
    [s * 42, 22, 4],
    [s * 50, 34, 0],
  ];
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    d = Math.min(d, segDist(p, pts[i]!, pts[i + 1]!));
  }
  return d;
}

function diencephalonCenter(h: HeadGeometry): Vec3 {
  return h.thirdVentricleCenter;
}

function classifyDiencephalon(h: HeadGeometry, p: Vec3): MaterialId | null {
  const c = diencephalonCenter(h);
  const d = sub(p, c);
  const width = HEAD.thirdVentricleWidthMm.value / 2;
  const height = HEAD.thirdVentricleHeightMm.value / 2;
  const depth = HEAD.thirdVentricleDepthMm.value / 2;
  const insideLong = Math.abs(d[1]) <= height && Math.abs(d[2]) <= depth;
  const pineal = [c[0], c[1], c[2] - 7] as Vec3;
  if (dist(p, pineal) <= HEAD.pinealRadiusMm.value) return 'pineal';
  for (const s of [-1, 1] as const) {
    const horn = [
      c[0] + s * HEAD.frontalHornCenterXmm.value,
      c[1],
      c[2] + HEAD.frontalHornCenterZmm.value,
    ] as Vec3;
    if (
      ellipsoidLevel(
        horn,
        [HEAD.frontalHornRadiusXmm.value, HEAD.frontalHornRadiusYmm.value, HEAD.frontalHornRadiusZmm.value],
        p,
      ) <= 1
    ) {
      return 'lcrVaina';
    }
  }
  if (insideLong && Math.abs(d[0]) <= width) return 'lcrVaina';
  if (
    insideLong &&
    Math.abs(d[0]) <= width + HEAD.ependimoThicknessMm.value &&
    Math.abs(d[0]) >= width - HEAD.ependimoThicknessMm.value
  ) {
    return 'ependimo';
  }
  for (const s of [-1, 1] as const) {
    const center: Vec3 = [c[0] + s * HEAD.thalamusCenterXmm.value, c[1], c[2]];
    if (
      ellipsoidLevel(
        center,
        [HEAD.thalamusRadiusXmm.value, HEAD.thalamusRadiusYmm.value, HEAD.thalamusRadiusZmm.value],
        p,
      ) <= 1
    ) {
      return 'talamo';
    }
  }
  return null;
}

function peduncleCenter(h: HeadGeometry, side: -1 | 1): Vec3 {
  return [
    h.midbrainCenter[0] + side * HEAD.peduncleOffsetXmm.value,
    h.midbrainCenter[1],
    h.midbrainCenter[2],
  ];
}

function substantiaNigraCenter(h: HeadGeometry, side: -1 | 1): Vec3 {
  return [
    h.midbrainCenter[0] + side * HEAD.peduncleOffsetXmm.value,
    h.midbrainCenter[1] + HEAD.snCenterYmm.value,
    h.midbrainCenter[2] + HEAD.snCenterZOffsetMm.value,
  ];
}

function redNucleusCenter(h: HeadGeometry, side: -1 | 1): Vec3 {
  return [h.midbrainCenter[0] + side * 3, h.midbrainCenter[1] + 1, h.midbrainCenter[2] - 4];
}

/** Mínimo suave polinómico (k en unidades de nivel normalizado). */
function smin(a: number, b: number, k: number): number {
  const h0 = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h0 * h0 * k * 0.25;
}

/** Nivel del mesencéfalo en «mariposa» (≤1 dentro); exportado para headScene. */
export function butterflyLevel(h: HeadGeometry, p: Vec3): number {
  const pedRadii: Vec3 = [
    HEAD.peduncleRadiusXmm.value,
    HEAD.peduncleRadiusYmm.value,
    HEAD.peduncleRadiusZmm.value,
  ];
  const tegmentum: Vec3 = [h.midbrainCenter[0], h.midbrainCenter[1], h.midbrainCenter[2] - 4];
  const tegmentumRadii: Vec3 = [
    HEAD.tegmentumRadiusXmm.value,
    HEAD.tegmentumRadiusYmm.value,
    HEAD.tegmentumRadiusZmm.value,
  ];
  return smin(
    smin(
      ellipsoidLevel(peduncleCenter(h, -1), pedRadii, p),
      ellipsoidLevel(peduncleCenter(h, 1), pedRadii, p),
      0.25,
    ),
    ellipsoidLevel(tegmentum, tegmentumRadii, p),
    0.25,
  );
}

/**
 * Formas del mesencéfalo compartidas entre clasificador y navegador 3D:
 * dos pedúnculos laterales + tegmento posterior (marco paciente, mm).
 */
export function midbrainShapes(h: HeadGeometry): { center: Vec3; radii: Vec3 }[] {
  const pedRadii: Vec3 = [
    HEAD.peduncleRadiusXmm.value,
    HEAD.peduncleRadiusYmm.value,
    HEAD.peduncleRadiusZmm.value,
  ];
  const tegRadii: Vec3 = [
    HEAD.tegmentumRadiusXmm.value,
    HEAD.tegmentumRadiusYmm.value,
    HEAD.tegmentumRadiusZmm.value,
  ];
  return [
    { center: peduncleCenter(h, -1), radii: pedRadii },
    { center: peduncleCenter(h, 1), radii: pedRadii },
    {
      center: [h.midbrainCenter[0], h.midbrainCenter[1], h.midbrainCenter[2] - 4],
      radii: tegRadii,
    },
  ];
}

/** Formas del diencéfalo (tálamos + tercer ventrículo) para el navegador 3D. */
export function diencephalonShapes(h: HeadGeometry): {
  thalami: { center: Vec3; radii: Vec3 }[];
  ventricle: { center: Vec3; half: Vec3 };
} {
  const c = diencephalonCenter(h);
  return {
    thalami: ([-1, 1] as const).map((s) => ({
      center: [c[0] + s * HEAD.thalamusCenterXmm.value, c[1], c[2]] as Vec3,
      radii: [
        HEAD.thalamusRadiusXmm.value,
        HEAD.thalamusRadiusYmm.value,
        HEAD.thalamusRadiusZmm.value,
      ] as Vec3,
    })),
    ventricle: {
      center: c,
      half: [
        HEAD.thirdVentricleWidthMm.value / 2,
        HEAD.thirdVentricleHeightMm.value / 2,
        HEAD.thirdVentricleDepthMm.value / 2,
      ],
    },
  };
}

function classifyMidbrainSpecial(h: HeadGeometry, p: Vec3): MaterialId | null {
  const md = sub(p, h.midbrainCenter);
  const snHeightMm = (HEAD.snAreaCm2.value * 100) / (Math.PI * HEAD.snHalfWidthMm.value);
  for (const s of [-1, 1] as const) {
    if (
      ellipsoidLevel(
        substantiaNigraCenter(h, s),
        [HEAD.snHalfWidthMm.value, snHeightMm, HEAD.snHalfDepthMm.value],
        p,
      ) <= 1
    ) {
      return 'sustanciaNegra';
    }
    if (dist(p, redNucleusCenter(h, s)) <= HEAD.redNucleusRadiusMm.value) return 'sustanciaNegra';
  }
  if (Math.abs(md[0]) <= 0.5 && Math.abs(md[1]) <= 1 && md[2] < -1 && md[2] > -9) {
    return 'cisterna';
  }
  if (
    Math.abs(md[0]) <= HEAD.peduncleOffsetXmm.value - 1 &&
    Math.abs(md[1]) <= HEAD.peduncleRadiusYmm.value * 0.8 &&
    md[2] > 1 &&
    md[2] < HEAD.peduncleRadiusZmm.value
  ) {
    return 'cisterna';
  }
  return null;
}

function isPetrous(h: HeadGeometry, p: Vec3): boolean {
  const md = sub(p, h.midbrainCenter);
  return md[2] < -25 && Math.abs(md[0]) >= 15 && Math.abs(md[0]) <= 35 && Math.abs(md[1] + 4) < 4;
}

function isSphenoid(h: HeadGeometry, p: Vec3): boolean {
  const md = sub(p, h.midbrainCenter);
  return Math.abs(md[1] + 2) < 1.5 && md[2] > 6 && Math.abs(md[0]) > 20 && Math.abs(md[0]) < 28;
}

export function landmarkAt(h: HeadGeometry, p: Vec3): LandmarkId | null {
  const md = sub(p, h.midbrainCenter);
  const d = sub(p, h.thirdVentricleCenter);
  const snHeightMm = (HEAD.snAreaCm2.value * 100) / (Math.PI * HEAD.snHalfWidthMm.value);
  const width = HEAD.thirdVentricleWidthMm.value / 2;
  if (
    dist(p, [h.thirdVentricleCenter[0], h.thirdVentricleCenter[1], h.thirdVentricleCenter[2] - 7]) <=
    HEAD.pinealRadiusMm.value
  ) {
    return 'pineal';
  }
  if (
    Math.abs(d[1]) <= HEAD.thirdVentricleHeightMm.value / 2 &&
    Math.abs(d[2]) <= HEAD.thirdVentricleDepthMm.value / 2 &&
    Math.abs(d[0]) <= width
  )
    return 'tercerVentriculo';
  for (const s of [-1, 1] as const) {
    if (
      ellipsoidLevel(
        substantiaNigraCenter(h, s),
        [HEAD.snHalfWidthMm.value, snHeightMm, HEAD.snHalfDepthMm.value],
        p,
      ) <= 1
    )
      return 'sustanciaNegra';
    if (dist(p, redNucleusCenter(h, s)) <= HEAD.redNucleusRadiusMm.value) return 'nucleoRojo';
  }
  if (Math.abs(md[0]) <= 0.5 && Math.abs(md[1]) <= 1 && md[2] < -1 && md[2] > -9) return 'rafe';
  if (
    Math.abs(md[0]) <= HEAD.peduncleOffsetXmm.value - 1 &&
    Math.abs(md[1]) <= HEAD.peduncleRadiusYmm.value * 0.8 &&
    md[2] > 1 &&
    md[2] < HEAD.peduncleRadiusZmm.value
  )
    return 'cisternaInterpeduncular';
  if (butterflyLevel(h, p) <= 1) return 'mesencefalo';
  for (const s of [-1, 1] as const) {
    const horn: Vec3 = [
      h.thirdVentricleCenter[0] + s * HEAD.frontalHornCenterXmm.value,
      h.thirdVentricleCenter[1],
      h.thirdVentricleCenter[2] + HEAD.frontalHornCenterZmm.value,
    ];
    if (
      ellipsoidLevel(
        horn,
        [HEAD.frontalHornRadiusXmm.value, HEAD.frontalHornRadiusYmm.value, HEAD.frontalHornRadiusZmm.value],
        p,
      ) <= 1
    )
      return 'cuernoFrontal';
    const thalamus: Vec3 = [
      h.thirdVentricleCenter[0] + s * HEAD.thalamusCenterXmm.value,
      h.thirdVentricleCenter[1],
      h.thirdVentricleCenter[2],
    ];
    if (
      ellipsoidLevel(
        thalamus,
        [HEAD.thalamusRadiusXmm.value, HEAD.thalamusRadiusYmm.value, HEAD.thalamusRadiusZmm.value],
        p,
      ) <= 1
    )
      return 'talamo';
  }
  if (isSphenoid(h, p)) return 'alaEsfenoidal';
  if (isPetrous(h, p)) return 'penasco';
  if (classifyHead(h, p) === 'hueso') return 'craneoContralateral';
  return null;
}

export function materialAtHead(h: HeadGeometry, p: Vec3) {
  return MATERIALS[classifyHead(h, p)];
}

/** Vaso dominante en un punto (el más cercano cuyo tubo lo contiene). */
export function vesselAt(h: HeadGeometry, p: Vec3): Vessel | null {
  for (const v of h.vessels) {
    if (vesselDistance(v, p) < 0) return v;
  }
  return null;
}
