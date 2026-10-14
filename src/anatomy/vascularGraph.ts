/** Contrato vascular independiente de acústica y hemodinámica (DEC-74). */
import { dist, scale, type Vec3 } from '../core/vec3';
import type { Side } from '../domain/contracts';
import { ANATOMIA_CABEZA } from './params';
import type { Vessel } from './head';

type Vec4 = readonly [number, number, number, number];
/** Matriz por filas; actúa sobre vectores columna. */
export type Affine4 = readonly [Vec4, Vec4, Vec4, Vec4];
export const IDENTITY_AFFINE: Affine4 = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];
export const PATIENT_FRAME = 'x-left-y-superior-z-anterior';
const UNIT_TO_MM = { mm: 1, cm: 10, voxel: 1 } as const;

export interface VascularProvenance {
  readonly id: string;
  readonly revision: string;
  readonly license: string;
  readonly kind: 'synthetic' | 'derived';
  readonly derivation: string;
  readonly validation: {
    readonly status: 'unvalidated' | 'reference-compared' | 'expert-reviewed';
    readonly note: string;
  };
  readonly url?: string;
  readonly sha256?: string;
}

export interface VascularNodeSource {
  readonly id: string;
  readonly position: Vec3;
}

export interface VascularSegmentSource {
  readonly id: string;
  readonly label: string;
  readonly side: Side | 'media';
  readonly from: string;
  readonly to: string;
  /** Puntos intermedios en coordenadas de origen; from→to no impone flujo. */
  readonly via?: readonly Vec3[];
  /** Radio en mm del PACIENTE: escalar o uno por punto (extremos + via). */
  readonly radiusMm: number | readonly number[];
}

export interface VascularGraphSource {
  readonly schemaVersion: 1;
  readonly units: keyof typeof UNIT_TO_MM;
  readonly sourceFrame: string;
  readonly patientFrame: typeof PATIENT_FRAME;
  /** mm/cm se convierten a mm ANTES de la afín; voxel exige espaciado en ella. */
  readonly affine: Affine4;
  readonly provenance: VascularProvenance;
  readonly nodes: readonly VascularNodeSource[];
  readonly segments: readonly VascularSegmentSource[];
}

export interface VascularSegment {
  readonly id: string;
  readonly label: string;
  readonly side: Side | 'media';
  readonly from: string;
  readonly to: string;
  readonly points: readonly Vec3[];
  readonly radiiMm: readonly number[];
  readonly lengthMm: number;
}

export interface VascularGraph {
  readonly schemaVersion: 1;
  readonly patientFrame: typeof PATIENT_FRAME;
  readonly sourceFrame: string;
  readonly sourceUnits: VascularGraphSource['units'];
  readonly provenance: VascularProvenance;
  readonly nodes: ReadonlyMap<string, Vec3>;
  readonly segments: readonly VascularSegment[];
  readonly degree: ReadonlyMap<string, number>;
  readonly components: number;
  /** Ciclos independientes no dirigidos (E − V + C), no capacidad colateral. */
  readonly cycles: number;
  readonly affine: Affine4;
  readonly inverse: Affine4;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const finiteVector = (p: unknown, size: number): p is number[] =>
  Array.isArray(p) && p.length === size && Array.from(p).every(Number.isFinite);
const positive = (r: unknown): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0;

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Grafo vascular no utilizable: ${message}`);
}

export function applyAffine(m: Affine4, p: Vec3): Vec3 {
  const row = (r: Vec4) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + r[3];
  return [row(m[0]), row(m[1]), row(m[2])];
}

/** Rechaza también matrices proyectivas, mal formadas o numéricamente singulares. */
export function invertAffine(value: unknown): Affine4 | null {
  if (!Array.isArray(value) || value.length !== 4 || !Array.from(value).every((r) => finiteVector(r, 4)))
    return null;
  const m = value as unknown as Affine4;
  if (m[3][0] !== 0 || m[3][1] !== 0 || m[3][2] !== 0 || m[3][3] !== 1) return null;
  const max = Math.max(...m.slice(0, 3).flatMap((r) => r.slice(0, 3).map(Math.abs)));
  if (max === 0) return null;
  const [a, b, c] = m.slice(0, 3).map((r) => r.map((v) => v / max)) as [number[], number[], number[]];
  const cofactors = [
    [b[1]! * c[2]! - b[2]! * c[1]!, a[2]! * c[1]! - a[1]! * c[2]!, a[1]! * b[2]! - a[2]! * b[1]!],
    [b[2]! * c[0]! - b[0]! * c[2]!, a[0]! * c[2]! - a[2]! * c[0]!, a[2]! * b[0]! - a[0]! * b[2]!],
    [b[0]! * c[1]! - b[1]! * c[0]!, a[1]! * c[0]! - a[0]! * c[1]!, a[0]! * b[1]! - a[1]! * b[0]!],
  ];
  const d = a[0]! * cofactors[0]![0]! + a[1]! * cofactors[1]![0]! + a[2]! * cofactors[2]![0]!;
  // Umbral relativo de estabilidad numérica, no parámetro anatómico.
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const rows = cofactors.map((cofactor): Vec4 => {
    const [x, y, z] = cofactor.map((v) => v / d / max) as Vec3;
    return [x, y, z, -(x * m[0][3] + y * m[1][3] + z * m[2][3])];
  });
  if (!rows.flat().every(Number.isFinite)) return null;
  return [rows[0]!, rows[1]!, rows[2]!, [0, 0, 0, 1]];
}

function checkSource(src: unknown): asserts src is VascularGraphSource {
  requireValid(isRecord(src), 'se esperaba un objeto');
  requireValid(src.schemaVersion === 1, 'versión de esquema no soportada');
  requireValid(
    typeof src.units === 'string' && Object.hasOwn(UNIT_TO_MM, src.units),
    'unidades desconocidas',
  );
  requireValid(
    nonempty(src.sourceFrame) && src.patientFrame === PATIENT_FRAME,
    'marcos no declarados o incompatibles',
  );
  const p = src.provenance;
  requireValid(isRecord(p), 'procedencia ausente');
  for (const k of ['id', 'revision', 'license', 'derivation'])
    requireValid(nonempty(p[k]), `procedencia sin ${k}`);
  requireValid(p.kind === 'synthetic' || p.kind === 'derived', 'tipo de procedencia desconocido');
  requireValid(isRecord(p.validation), 'validación no declarada');
  requireValid(
    typeof p.validation.status === 'string' &&
      ['unvalidated', 'reference-compared', 'expert-reviewed'].includes(p.validation.status) &&
      nonempty(p.validation.note),
    'estado o nota de validación ausente',
  );
  if (p.url !== undefined)
    requireValid(typeof p.url === 'string' && /^https?:\/\/\S+$/.test(p.url), 'URL no utilizable');
  if (p.sha256 !== undefined)
    requireValid(typeof p.sha256 === 'string' && /^[0-9a-f]{64}$/.test(p.sha256), 'SHA-256 mal formado');
  requireValid(Array.isArray(src.nodes) && src.nodes.length > 0, 'nodos ausentes');
  const nodes = new Set<string>();
  for (const n of src.nodes) {
    requireValid(isRecord(n) && nonempty(n.id), 'nodo sin id');
    requireValid(!nodes.has(n.id), `nodo duplicado «${n.id}»`);
    requireValid(finiteVector(n.position, 3), `nodo «${n.id}» con posición no finita`);
    nodes.add(n.id);
  }
  requireValid(Array.isArray(src.segments) && src.segments.length > 0, 'segmentos ausentes');
  const ids = new Set<string>();
  for (const s of src.segments) {
    requireValid(isRecord(s) && nonempty(s.id), 'segmento sin id');
    requireValid(!ids.has(s.id), `segmento duplicado «${s.id}»`);
    ids.add(s.id);
    requireValid(nonempty(s.label), `segmento «${s.id}» sin etiqueta`);
    requireValid(
      s.side === 'izq' || s.side === 'der' || s.side === 'media',
      `segmento «${s.id}» sin lateralidad`,
    );
    requireValid(
      typeof s.from === 'string' && nodes.has(s.from) && typeof s.to === 'string' && nodes.has(s.to),
      `segmento «${s.id}» referencia un nodo inexistente`,
    );
    requireValid(s.from !== s.to, `segmento «${s.id}» une un nodo consigo mismo`);
    const via = s.via === undefined ? [] : s.via;
    requireValid(
      Array.isArray(via) && Array.from(via).every((q) => finiteVector(q, 3)),
      `segmento «${s.id}» con puntos intermedios no finitos`,
    );
    requireValid(
      positive(s.radiusMm) ||
        (Array.isArray(s.radiusMm) &&
          s.radiusMm.length === via.length + 2 &&
          Array.from(s.radiusMm).every(positive)),
      `segmento «${s.id}»: radios no positivos o cantidad incompatible`,
    );
  }
}

function polylineLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const step = dist(points[i - 1]!, points[i]!);
    if (!Number.isFinite(step) || step <= 0) return NaN;
    total += step;
  }
  return total;
}

function validSide(side: Side | 'media', points: readonly Vec3[]): boolean {
  const tol = ANATOMIA_CABEZA.params.lateralityToleranceMm.value;
  return points.every(
    (p) => side === 'media' || (side === 'izq' ? p[0] >= -tol : side === 'der' && p[0] <= tol),
  );
}

/** Acepta JSON no confiable y copia la fuente: modificarla después no reescribe el grafo. */
export function buildVascularGraph(input: unknown): VascularGraph {
  checkSource(input);
  const src = structuredClone(input);
  const inverse = invertAffine(src.affine);
  requireValid(inverse, 'afín singular, no finita o mal formada');
  const toPatient = (p: Vec3): Vec3 => {
    const q = applyAffine(src.affine, scale(p, UNIT_TO_MM[src.units]));
    requireValid(finiteVector(q, 3), 'transformación produce coordenadas no finitas');
    return q;
  };
  const nodes = new Map(src.nodes.map((n) => [n.id, toPatient(n.position)] as const));
  const degree = new Map(src.nodes.map((n) => [n.id, 0]));
  const parent = new Map(src.nodes.map((n) => [n.id, n.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const segments = src.segments.map((s): VascularSegment => {
    const points = [nodes.get(s.from)!, ...(s.via ?? []).map(toPatient), nodes.get(s.to)!];
    const lengthMm = polylineLength(points);
    requireValid(positive(lengthMm), `segmento «${s.id}» degenerado o de longitud no finita`);
    requireValid(validSide(s.side, points), `segmento «${s.id}» con lateralidad incompatible`);
    const radius = s.radiusMm;
    const radiiMm = typeof radius === 'number' ? points.map(() => radius) : [...radius];
    for (const ref of [s.from, s.to]) degree.set(ref, degree.get(ref)! + 1);
    parent.set(find(s.from), find(s.to));
    return { id: s.id, label: s.label, side: s.side, from: s.from, to: s.to, points, radiiMm, lengthMm };
  });
  const components = new Set(src.nodes.map((n) => find(n.id))).size;
  return {
    schemaVersion: 1,
    patientFrame: PATIENT_FRAME,
    sourceFrame: src.sourceFrame,
    sourceUnits: src.units,
    provenance: src.provenance,
    nodes,
    segments,
    degree,
    components,
    cycles: segments.length - nodes.size + components,
    affine: src.affine,
    inverse,
  };
}

/** Paciente (mm) → coordenadas de origen, deshaciendo afín y conversión de unidades. */
export function toSourceCoordinates(graph: VascularGraph, p: Vec3): Vec3 {
  return scale(applyAffine(graph.inverse, p), 1 / UNIT_TO_MM[graph.sourceUnits]);
}

/** Invariantes geométricas de los tubos actuales; no infiere sus conexiones. */
export function vesselProblems(vessels: readonly Vessel[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of vessels) {
    if (!nonempty(v.id) || seen.has(v.id)) out.push(`vaso con id vacío o duplicado «${v.id}»`);
    seen.add(v.id);
    if (!positive(v.radiusMm)) out.push(`vaso «${v.id}» con radio no positivo`);
    if (
      v.points.length < 2 ||
      !v.points.every((p) => finiteVector(p, 3)) ||
      !positive(polylineLength(v.points))
    )
      out.push(`vaso «${v.id}» sin línea central utilizable`);
    if (!validSide(v.side, v.points)) out.push(`vaso «${v.id}» con lateralidad incompatible`);
    if (
      !finiteVector(v.aabb.min, 3) ||
      !finiteVector(v.aabb.max, 3) ||
      v.points.some((p) =>
        p.some((x, i) => x - v.radiusMm < v.aabb.min[i]! - 1e-9 || x + v.radiusMm > v.aabb.max[i]! + 1e-9),
      )
    )
      out.push(`vaso «${v.id}» con caja envolvente no utilizable`);
  }
  return out;
}
