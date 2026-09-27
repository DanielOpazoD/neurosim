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
import { add, clamp, dist, dot, length, normalize, scale, sub, type Vec3 } from '../core/vec3';
import type { SeededRandom } from '../core/random';
import type { Side, WillisVariant } from '../domain/contracts';
import { ANATOMIA_CABEZA } from './params';
import { buildWillisVessels } from './willis';

const HEAD = ANATOMIA_CABEZA.params;

/** Un vaso tubular: línea central por segmentos + radio local. */
export interface Vessel {
  readonly id: string;
  readonly side: Side | 'media';
  readonly points: readonly Vec3[];
  readonly radiusMm: number;
  /** +1 orienta el flujo de points[0] hacia el último; −1 invierte esa dirección. */
  readonly flowSign: 1 | -1;
  /** Flujo medio del segmento, ml/min, positivo en la orientación anatómica. */
  readonly flowMlMin: number;
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
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab)), 0, 1);
  return dist(p, add(a, scale(ab, t)));
}

/** Distancia al tubo (polilínea) de un vaso. */
export function vesselDistance(v: Vessel, p: Vec3): number {
  let d = Infinity;
  for (let i = 0; i + 1 < v.points.length; i++) {
    d = Math.min(d, segDist(p, v.points[i]!, v.points[i + 1]!));
  }
  return d - v.radiusMm;
}

/** Punto más cercano sobre la línea central y tangente local. */
export function vesselClosest(v: Vessel, p: Vec3): { point: Vec3; tangent: Vec3; sMm: number } {
  let best: { point: Vec3; tangent: Vec3; sMm: number } = {
    point: v.points[0]!,
    tangent: normalize(sub(v.points[1]!, v.points[0]!)),
    sMm: 0,
  };
  let bestD = Infinity;
  let sAcc = 0;
  for (let i = 0; i + 1 < v.points.length; i++) {
    const a = v.points[i]!;
    const b = v.points[i + 1]!;
    const ab = sub(b, a);
    const len = length(ab);
    const t = clamp(dot(sub(p, a), ab) / Math.max(1e-9, len * len), 0, 1);
    const q = add(a, scale(ab, t));
    const d = dist(p, q);
    if (d < bestD) {
      bestD = d;
      best = { point: q, tangent: normalize(ab), sMm: sAcc + t * len };
    }
    sAcc += len;
  }
  return best;
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
export function buildReferenceHead(rng: SeededRandom, variant: WillisVariant = 'normal'): HeadGeometry {
  const skullCenter: Vec3 = [HEAD.skullCenterXmm.value, HEAD.skullCenterYmm.value, HEAD.skullCenterZmm.value];
  const skullRadii: Vec3 = [HEAD.skullRadiusXmm.value, HEAD.skullRadiusYmm.value, HEAD.skullRadiusZmm.value];
  const r = rng.fork('head');
  const windowThicknessMm = HEAD.windowThicknessMm.value + r.range(0, 0.4);
  const windowQuality = HEAD.windowQuality.value; // adulto de referencia: ventana utilizable

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
    vessels: buildWillisVessels(variant),
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

/** ¿Está el punto dentro de la ventana temporal del lado indicado? */
export function inTemporalWindow(h: HeadGeometry, side: Side, p: Vec3): boolean {
  return dist(p, h.windowCenter[side]) < h.windowRadiusMm;
}

/** Espesor óseo efectivo en un punto de la tabla craneal. */
export function skullThicknessAt(h: HeadGeometry, p: Vec3): number {
  for (const side of ['izq', 'der'] as const) {
    if (inTemporalWindow(h, side, p)) return h.windowThicknessMm;
  }
  return h.skullThicknessMm;
}

/**
 * Clasifica un punto del paciente para la escena transcraneal.
 * Orden: fuera de la cabeza → piel/cuero cabelludo → hueso → vasos →
 * mesencéfalo → cisternas → tejido cerebral.
 */
export function classifyHead(h: HeadGeometry, p: Vec3): MaterialId {
  const level = ellipsoidLevel(h.skullCenter, h.skullRadii, p);
  if (level > 1.0) {
    // cuero cabelludo/músculo: capa de ~6 mm fuera del hueso
    if (level < 1.0 + 6 / Math.min(...h.skullRadii)) return 'piel';
    return 'aire';
  }
  const innerLevel = ellipsoidLevel(
    h.skullCenter,
    [
      h.skullRadii[0] - skullThicknessAt(h, p),
      h.skullRadii[1] - skullThicknessAt(h, p),
      h.skullRadii[2] - skullThicknessAt(h, p),
    ],
    p,
  );
  if (innerLevel > 1.0) return 'hueso';

  // Vasos intracraneales (antes que el tejido cerebral de fondo).
  for (const v of h.vessels) {
    if (vesselDistance(v, p) < 0) return 'vaso';
  }

  const md = sub(p, h.midbrainCenter);
  const diencephalon = classifyDiencephalon(h, p);
  if (diencephalon) return diencephalon;

  const special = classifyMidbrainSpecial(h, p);
  if (special) return special;

  // Mesencéfalo en mariposa: dos pedúnculos y un tegmento posterior.
  const mb = butterflyLevel(h, p);
  if (mb <= 1.0) return 'tejidoCerebral';

  // Cisternas basales: corona ecogénica alrededor del mesencéfalo,
  // extendida hacia la fisura silviana lateral.
  if (mb < 1.45) return 'cisterna';
  const sylvian = Math.abs(md[2] - 2) < 5 && Math.abs(md[0]) > 14 && Math.abs(md[0]) < 32;
  if (sylvian && Math.abs(md[1]) < 6) return 'cisterna';

  if (isPetrous(h, p)) return 'hueso';

  // Ala esfenoidal: cresta ecogénica anterior-lateral (referencia M1/ACA).
  if (isSphenoid(h, p)) return 'hueso';

  return 'tejidoCerebral';
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

function butterflyLevel(h: HeadGeometry, p: Vec3): number {
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
  return Math.min(
    ellipsoidLevel(peduncleCenter(h, -1), pedRadii, p),
    ellipsoidLevel(peduncleCenter(h, 1), pedRadii, p),
    ellipsoidLevel(tegmentum, tegmentumRadii, p),
  );
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
  return Math.abs(md[1] + 2) < 3 && md[2] > -2 && Math.abs(md[0]) > 12 && Math.abs(md[0]) < 30;
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
