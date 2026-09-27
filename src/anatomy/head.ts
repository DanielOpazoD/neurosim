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
import type { Side } from '../domain/contracts';

/** Un vaso tubular: línea central por segmentos + radio local. */
export interface Vessel {
  readonly id: string;
  readonly side: Side | 'media';
  readonly points: readonly Vec3[];
  readonly radiusMm: number;
  /** Flujo basal medio hacia la sonda ipsilateral (+) o alejándose (−). */
  readonly flowSign: 1 | -1;
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
}

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
export function buildReferenceHead(rng: SeededRandom): HeadGeometry {
  const skullCenter: Vec3 = [0, 28, -12];
  const skullRadii: Vec3 = [82, 100, 96];
  const r = rng.fork('head');
  const windowThicknessMm = 1.6 + r.range(0, 0.4);
  const windowQuality = 0.9; // adulto de referencia: ventana utilizable

  // Ventana: punto del elipsoide a azimut lateral y algo anterior (pterion).
  const mkWindow = (side: Side): Vec3 => {
    const s = side === 'izq' ? 1 : -1;
    const az = s * Math.PI * 0.42; // hacia ±x, algo anterior
    const el = -0.18; // algo por debajo del ecuador
    const dir: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el) * 0.35];
    const nd = normalize(dir);
    return [
      skullCenter[0] + nd[0] * skullRadii[0],
      skullCenter[1] + nd[1] * skullRadii[1],
      skullCenter[2] + nd[2] * skullRadii[2],
    ];
  };

  const vessels: Vessel[] = [];
  for (const s of [1, -1] as const) {
    const side: Side = s === 1 ? 'izq' : 'der';
    // ACI terminal → M1 lateral (hacia la sonda ipsilateral).
    vessels.push({
      id: `m1-${side}`,
      side,
      radiusMm: 1.5,
      flowSign: 1,
      psvCms: 90,
      edvCms: 35,
      points: [
        [s * 9, 8, -6],
        [s * 14, 9, -4],
        [s * 20, 9.5, -1],
        [s * 26, 10, 2],
        [s * 31, 11, 4],
      ],
    });
    // A1: medial y algo anterior, alejándose de la sonda ipsilateral.
    vessels.push({
      id: `a1-${side}`,
      side,
      radiusMm: 1.2,
      flowSign: -1,
      psvCms: 80,
      edvCms: 30,
      points: [
        [s * 9, 8, -6],
        [s * 5, 9, -1],
        [s * 1.5, 10, 2],
      ],
    });
    // P1/P2: del vértice basilar posterolateral, rodeando el mesencéfalo.
    vessels.push({
      id: `p1-${side}`,
      side,
      radiusMm: 1.1,
      flowSign: 1, // P1 hacia la sonda desde la línea media
      psvCms: 60,
      edvCms: 25,
      points: [
        [0, 6, -26],
        [s * 5, 7, -26],
        [s * 11, 8, -24],
      ],
    });
    vessels.push({
      id: `p2-${side}`,
      side,
      radiusMm: 1.1,
      flowSign: -1, // P2 rodea y se aleja
      psvCms: 60,
      edvCms: 25,
      points: [
        [s * 11, 8, -24],
        [s * 15, 9, -20],
        [s * 17, 10, -15],
      ],
    });
  }
  // Basilar: línea media posterior, alejándose de la sonda.
  vessels.push({
    id: 'basilar',
    side: 'media',
    radiusMm: 1.6,
    flowSign: -1,
    psvCms: 55,
    edvCms: 22,
    points: [
      [0, 0, -30],
      [0, 3, -28],
      [0, 6, -26],
    ],
  });

  return {
    skullCenter,
    skullRadii,
    skullThicknessMm: 5,
    windowThicknessMm,
    windowQuality,
    windowCenter: { der: mkWindow('der'), izq: mkWindow('izq') },
    windowRadiusMm: 18,
    vessels,
    midbrainCenter: [0, 14, -12],
    midbrainRadii: [17, 14, 24],
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

  // Mesencéfalo: «corazón» hipoe-cogénico — elipsoide con muesca posterior.
  const md = sub(p, h.midbrainCenter);
  let mb = ellipsoidLevel(h.midbrainCenter, h.midbrainRadii, p);
  // muesca posterior (acueducto/interpeduncular): ensanchar atrás
  if (md[2] < -8 && Math.abs(md[0]) < 6) mb *= 1.25;
  if (mb <= 1.0) return 'tejidoCerebral';

  // Cisternas basales: corona ecogénica alrededor del mesencéfalo,
  // extendida hacia la fisura silviana lateral.
  if (mb < 1.45) return 'cisterna';
  const sylvian = Math.abs(md[2] - 2) < 5 && Math.abs(md[0]) > 14 && Math.abs(md[0]) < 32;
  if (sylvian && Math.abs(md[1]) < 6) return 'cisterna';

  // Ala esfenoidal: cresta ecogénica anterior-lateral (referencia M1/ACA).
  const sph = Math.abs(md[1] + 2) < 3 && md[2] > -2 && Math.abs(md[0]) > 12 && Math.abs(md[0]) < 30;
  if (sph) return 'hueso';

  return 'tejidoCerebral';
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
