import type { Vec3 } from '../core/vec3';
import type { Vessel } from './head';

/**
 * Atlas derivado de TopCoW (DEC-77): métricas por caso y segmento extraídas
 * offline por `scripts/atlas/topcow_extract.py`. Este módulo solo tipa el
 * JSON y calcula envolventes poblacionales; no carga archivos ni dibuja.
 * Las coordenadas están en el marco del simulador (mm) con origen en el punto
 * medio entre los terminales de ambas ACI.
 */
export interface AtlasSegment {
  readonly voxels: number;
  readonly lengthMm: number;
  readonly radiusMedianMm: number;
  readonly radiusP10Mm: number;
  readonly radiusP90Mm: number;
  readonly startMm: Vec3;
  readonly endMm: Vec3;
  readonly polylineMm: readonly Vec3[];
}

export interface AtlasCase {
  readonly id: string;
  readonly spacingMm: Vec3;
  readonly orientation: string;
  readonly interIcaTerminusMm: number | null;
  readonly edges: Readonly<Record<string, 0 | 1>> | null;
  readonly labelsPresent: readonly string[];
  readonly landmarkWarnings: readonly string[];
  readonly segments: Readonly<Record<string, AtlasSegment>>;
}

export interface AtlasDocument {
  readonly schemaVersion: 1;
  readonly source: {
    readonly dataset: string;
    readonly doi: string;
    readonly subset: string;
    readonly zipSha256: string | null;
    readonly modality: string;
    readonly population: string;
    readonly licence: string;
  };
  readonly frame: { readonly output: string; readonly origin: string };
  readonly cases: readonly AtlasCase[];
}

export interface Envelope {
  readonly n: number;
  readonly min: number;
  readonly median: number;
  readonly max: number;
}

export function envelope(values: readonly number[]): Envelope {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) throw new Error('Envolvente sin valores');
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
  return { n: v.length, min: v[0]!, median, max: v[v.length - 1]! };
}

export function inEnvelope(value: number, env: Envelope): boolean {
  return value >= env.min && value <= env.max;
}

/** Métricas comparables entre el atlas y el fixture sintético. */
export interface CowMetrics {
  readonly interIcaTerminusMm: number;
  readonly radiusMm: Readonly<Record<string, number>>;
  /** Punta basilar relativa al punto medio de los terminales de ACI. */
  readonly basilarTipMm: Vec3;
  /** Extremo distal de ACA (A2) y de PCA (P2), lado derecho, mismo origen. */
  readonly acaEndMm: Vec3;
  readonly pcaEndMm: Vec3;
  readonly mcaEndMm: Vec3;
}

/** Segmentos del fixture agrupados bajo las etiquetas TopCoW. */
export const FIXTURE_TO_TOPCOW: Readonly<Record<string, readonly string[]>> = {
  ica: ['R-ICA', 'L-ICA'],
  m1: ['R-MCA', 'L-MCA'],
  a1: ['R-ACA', 'L-ACA'],
  p1: ['R-PCA', 'L-PCA'],
  basilar: ['BA'],
  acoa: ['Acom'],
  pcoa: ['R-Pcom', 'L-Pcom'],
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const last = (p: readonly Vec3[]): Vec3 => p[p.length - 1]!;

export function fixtureMetrics(vessels: readonly Vessel[]): CowMetrics {
  const byId = new Map(vessels.map((v) => [v.id, v]));
  const need = (id: string): Vessel => {
    const v = byId.get(id);
    if (!v) throw new Error(`Falta el vaso ${id}`);
    return v;
  };
  const icaDer = need('ica-der');
  const icaIzq = need('ica-izq');
  const origin = mid(last(icaDer.controlPoints), last(icaIzq.controlPoints));
  const rel = (p: Vec3): Vec3 => sub(p, origin);
  return {
    interIcaTerminusMm: Math.hypot(...sub(last(icaDer.controlPoints), last(icaIzq.controlPoints))),
    radiusMm: {
      ica: icaDer.radiusMm,
      m1: need('m1-der').radiusMm,
      a1: need('a1-der').radiusMm,
      p1: need('p1-der').radiusMm,
      basilar: need('basilar').radiusMm,
      acoa: need('acoa').radiusMm,
      pcoa: need('pcoa-der').radiusMm,
    },
    basilarTipMm: rel(last(need('basilar').controlPoints)),
    acaEndMm: rel(last(need('a2-der').controlPoints)),
    pcaEndMm: rel(last(need('p2-der').controlPoints)),
    mcaEndMm: rel(last(need('m1-der').controlPoints)),
  };
}

export interface MetricComparison {
  readonly metric: string;
  readonly fixture: number;
  readonly atlas: Envelope;
  readonly inside: boolean;
}

function segs(doc: AtlasDocument, labels: readonly string[]): AtlasSegment[] {
  return doc.cases.flatMap((c) =>
    labels.map((l) => c.segments[l]).filter((s): s is AtlasSegment => s !== undefined),
  );
}

/** Refleja a la derecha (x<0) los extremos izquierdos para agrupar lados. */
function mirrorToRight(label: string, p: Vec3): Vec3 {
  return label.startsWith('L-') ? [-p[0], p[1], p[2]] : p;
}

function endComponents(doc: AtlasDocument, labels: readonly string[], axis: 0 | 1 | 2): number[] {
  return doc.cases.flatMap((c) =>
    labels.flatMap((l) => {
      const s = c.segments[l];
      return s ? [mirrorToRight(l, s.endMm)[axis]] : [];
    }),
  );
}

/** Compara el fixture con la envolvente [min, max] del atlas, métrica a métrica. */
export function compareWithAtlas(doc: AtlasDocument, fx: CowMetrics): MetricComparison[] {
  const out: MetricComparison[] = [];
  const push = (metric: string, fixture: number, values: readonly number[]): void => {
    const atlas = envelope(values);
    out.push({ metric, fixture, atlas, inside: inEnvelope(fixture, atlas) });
  };
  push(
    'interIcaTerminusMm',
    fx.interIcaTerminusMm,
    doc.cases.map((c) => c.interIcaTerminusMm ?? NaN),
  );
  for (const [id, labels] of Object.entries(FIXTURE_TO_TOPCOW)) {
    push(
      `radius.${id}`,
      fx.radiusMm[id]!,
      segs(doc, labels).map((s) => s.radiusMedianMm),
    );
  }
  const ba = segs(doc, ['BA']);
  push(
    'basilarTip.y',
    fx.basilarTipMm[1],
    ba.map((s) => s.endMm[1]),
  );
  push(
    'basilarTip.z',
    fx.basilarTipMm[2],
    ba.map((s) => s.endMm[2]),
  );
  const aca = ['R-ACA', 'L-ACA'];
  push('acaEnd.y', fx.acaEndMm[1], endComponents(doc, aca, 1));
  push('acaEnd.z', fx.acaEndMm[2], endComponents(doc, aca, 2));
  const pca = ['R-PCA', 'L-PCA'];
  push('pcaEnd.x', fx.pcaEndMm[0], endComponents(doc, pca, 0));
  push('pcaEnd.z', fx.pcaEndMm[2], endComponents(doc, pca, 2));
  const mca = ['R-MCA', 'L-MCA'];
  push('mcaEnd.x', fx.mcaEndMm[0], endComponents(doc, mca, 0));
  return out;
}
