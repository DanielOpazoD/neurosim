import type { VascularGraph } from '../anatomy/vascularGraph';

export interface NodeFlowBalance {
  readonly nodeId: string;
  /** Aporte externo positivo = entrada a la red; negativo = salida. */
  readonly boundaryMlMin: number;
  /** Externo + entradas − salidas; no se compensa silenciosamente. */
  readonly residualMlMin: number;
  readonly relativeResidual: number;
}

/**
 * Balance estacionario de caudales prescritos; no resuelve presiones ni resistencias.
 * El caudal de cada segmento está firmado según from→to, incluidos los de valor cero.
 */
export function flowBalances(
  graph: VascularGraph,
  segmentFlowsMlMin: Readonly<Record<string, number>>,
  boundaryFlowsMlMin: Readonly<Record<string, number>>,
): NodeFlowBalance[] {
  const edgeIds = new Set(graph.segments.map((s) => s.id));
  for (const [id, q] of Object.entries(segmentFlowsMlMin))
    if (!edgeIds.has(id) || !Number.isFinite(q)) throw new Error(`Caudal de segmento no utilizable: ${id}`);
  for (const [id, q] of Object.entries(boundaryFlowsMlMin))
    if (!graph.nodes.has(id) || !Number.isFinite(q))
      throw new Error(`Caudal de contorno no utilizable: ${id}`);
  const residual = new Map<string, number>();
  const throughput = new Map<string, number>();
  for (const id of graph.nodes.keys()) {
    const boundary = Object.hasOwn(boundaryFlowsMlMin, id) ? boundaryFlowsMlMin[id]! : 0;
    residual.set(id, boundary);
    throughput.set(id, Math.abs(boundary));
  }
  for (const s of graph.segments) {
    if (!Object.hasOwn(segmentFlowsMlMin, s.id)) throw new Error(`Falta caudal de segmento: ${s.id}`);
    const q = segmentFlowsMlMin[s.id]!;
    residual.set(s.from, residual.get(s.from)! - q);
    residual.set(s.to, residual.get(s.to)! + q);
    for (const id of [s.from, s.to]) throughput.set(id, throughput.get(id)! + Math.abs(q));
  }
  return [...graph.nodes.keys()].map((nodeId) => {
    const r = residual.get(nodeId)!;
    const scale = throughput.get(nodeId)! / 2;
    if (!Number.isFinite(r) || !Number.isFinite(scale))
      throw new Error('Desbordamiento del balance de caudal');
    return {
      nodeId,
      boundaryMlMin: Object.hasOwn(boundaryFlowsMlMin, nodeId) ? boundaryFlowsMlMin[nodeId]! : 0,
      residualMlMin: r,
      relativeResidual: scale > 0 ? Math.abs(r) / scale : 0,
    };
  });
}
