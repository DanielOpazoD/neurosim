import { describe, expect, it } from 'vitest';
import { buildVascularGraph, IDENTITY_AFFINE, PATIENT_FRAME } from '../src/anatomy/vascularGraph';
import { flowBalances } from '../src/physiology/flowBalance';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { vesselMeanVelocityCms } from '../src/physiology/flow';
import { flowForMeanVelocity } from '../src/core/flowProfile';
import { hemodynamics } from '../src/physiology/hemodynamics';
import type { WillisVariant } from '../src/domain/contracts';

type Edge = readonly [id: string, from: string, to: string];
/** Geometría arbitraria para contabilidad de flujo; NO registro anatómico de Willis. */
function graphOf(edges: readonly Edge[]) {
  const ids = [...new Set(edges.flatMap(([, from, to]) => [from, to]))];
  return buildVascularGraph({
    schemaVersion: 1,
    units: 'mm',
    sourceFrame: 'contabilidad-sintetica',
    patientFrame: PATIENT_FRAME,
    affine: IDENTITY_AFFINE,
    provenance: {
      id: 'fixture-balance',
      revision: '1',
      kind: 'synthetic',
      license: 'MIT',
      derivation: 'Conexiones declaradas para contabilidad; coordenadas arbitrarias.',
      validation: { status: 'unvalidated', note: 'Prueba de software, no atlas ni CFD.' },
    },
    nodes: ids.map((id, i) => ({ id, position: [0, 10 * i, 0] })),
    segments: edges.map(([id, from, to]) => ({ id, from, to, label: id, side: 'media', radiusMm: 1 })),
  });
}
const bifurcation = graphOf([
  ['in', 'entrada', 'union'],
  ['a', 'union', 'A'],
  ['b', 'union', 'B'],
]);
const bifurcationQ = { in: 100, a: 60, b: 40 };
const bifurcationBoundary = { entrada: 100, A: -60, B: -40 };

describe('balance firmado de caudales prescritos', () => {
  it('conserva una bifurcación con entradas/salidas externas explícitas', () => {
    for (const b of flowBalances(bifurcation, bifurcationQ, bifurcationBoundary)) {
      expect(b.residualMlMin).toBe(0);
      expect(b.relativeResidual).toBe(0);
    }
  });
  it('informa fuga local aunque la suma global de los residuos sea cero', () => {
    const balances = flowBalances(bifurcation, { ...bifurcationQ, a: 70 }, bifurcationBoundary);
    expect(balances.find((b) => b.nodeId === 'union')!.residualMlMin).toBe(-10);
    expect(balances.find((b) => b.nodeId === 'A')!.residualMlMin).toBe(10);
    expect(balances.reduce((sum, b) => sum + b.residualMlMin, 0)).toBe(0);
    expect(Math.max(...balances.map((b) => b.relativeResidual))).toBeGreaterThan(0.01);
  });
  it('no interpreta terminales sin condiciones de contorno como sumideros implícitos', () => {
    const balances = flowBalances(bifurcation, bifurcationQ, {});
    expect(balances.find((b) => b.nodeId === 'entrada')!.residualMlMin).toBe(-100);
    expect(balances.find((b) => b.nodeId === 'A')!.relativeResidual).toBe(2);
  });
  it.each([-15, 0, 15])('conserva una anastomosis bidireccional con puente %s ml/min', (bridge) => {
    const graph = graphOf([
      ['in', 'entrada', 'union'],
      ['a', 'union', 'A'],
      ['b', 'union', 'B'],
      ['bridge', 'A', 'B'],
    ]);
    const q = { in: 100, a: 60, b: 40, bridge };
    const boundary = { entrada: 100, A: -(60 - bridge), B: -(40 + bridge) };
    expect(graph.cycles).toBe(1);
    for (const b of flowBalances(graph, q, boundary)) expect(b.residualMlMin).toBe(0);
  });
  it('admite inversión de toda la red sin reordenar geometría', () => {
    const q = Object.fromEntries(Object.entries(bifurcationQ).map(([id, value]) => [id, -value]));
    const b = Object.fromEntries(Object.entries(bifurcationBoundary).map(([id, value]) => [id, -value]));
    expect(flowBalances(bifurcation, q, b).every((n) => n.residualMlMin === 0)).toBe(true);
  });
  it('distingue flujo nulo explícito de datos ausentes', () => {
    expect(flowBalances(bifurcation, { in: 0, a: 0, b: 0 }, {}).every((n) => n.relativeResidual === 0)).toBe(
      true,
    );
    expect(() => flowBalances(bifurcation, { in: 0, a: 0 }, {})).toThrow('Falta caudal');
  });
  it.each([NaN, Infinity, -Infinity])('rechaza caudales no finitos %s', (q) => {
    expect(() => flowBalances(bifurcation, { ...bifurcationQ, a: q }, bifurcationBoundary)).toThrow();
    expect(() => flowBalances(bifurcation, bifurcationQ, { ...bifurcationBoundary, A: q })).toThrow();
  });
  it('rechaza IDs desconocidos y desbordamiento en acumulación', () => {
    expect(() => flowBalances(bifurcation, { ...bifurcationQ, desconocido: 0 }, {})).toThrow();
    expect(() => flowBalances(bifurcation, bifurcationQ, { desconocido: 0 })).toThrow();
    expect(() =>
      flowBalances(bifurcation, { in: Number.MAX_VALUE, a: Number.MAX_VALUE, b: Number.MAX_VALUE }, {}),
    ).toThrow();
  });
});

const variants: WillisVariant[] = ['normal', 'aplasiaA1Der', 'aplasiaA1Izq', 'pcaFetalDer', 'pcaFetalIzq'];
describe('conservación de la contabilidad declarada de Willis', () => {
  it.each(variants)('no crea ni destruye caudal en los nodos de %s', (variant) => {
    const sim = buildReferenceCase(undefined, variant);
    const edges: Edge[] = [
      ['acoa', 'aca-izq', 'aca-der'],
      ['basilar', 'vb', 'punta-basilar'],
    ];
    const boundaries: Record<string, readonly [vesselId: string, sign: 1 | -1]> = {};
    for (const s of ['der', 'izq'] as const) {
      edges.push(
        [`ica-${s}`, `entrada-ica-${s}`, `bif-ica-${s}`],
        [`m1-${s}`, `bif-ica-${s}`, `bif-m1-${s}`],
        [`m2-sup-${s}`, `bif-m1-${s}`, `salida-m2-sup-${s}`],
        [`m2-inf-${s}`, `bif-m1-${s}`, `salida-m2-inf-${s}`],
        [`a2-${s}`, `aca-${s}`, `salida-a2-${s}`],
        [`pcoa-${s}`, `bif-ica-${s}`, `acp-${s}`],
        [`p1-${s}`, 'punta-basilar', `acp-${s}`],
        [`p2-${s}`, `acp-${s}`, `salida-p2-${s}`],
        [`vertebral-${s}`, `entrada-va-${s}`, 'vb'],
      );
      if (sim.head.vessels.some((v) => v.id === `a1-${s}`))
        edges.push([`a1-${s}`, `bif-ica-${s}`, `aca-${s}`]);
      boundaries[`entrada-ica-${s}`] = [`ica-${s}`, 1];
      boundaries[`entrada-va-${s}`] = [`vertebral-${s}`, 1];
      for (const terminal of ['m2-sup', 'm2-inf', 'a2', 'p2'])
        boundaries[`salida-${terminal}-${s}`] = [`${terminal}-${s}`, -1];
    }
    const graph = graphOf(edges);
    expect(edges.map(([id]) => id).sort()).toEqual(sim.head.vessels.map((v) => v.id).sort());
    for (const icpMmHg of [10, 30, 60]) {
      const hemo = hemodynamics({ mapMmHg: 85, paco2MmHg: 40, icpMmHg });
      for (const phase of [0.05, 0.2, 0.5, 0.95]) {
        const q = Object.fromEntries(
          sim.head.vessels.map((v) => [
            v.id,
            v.flowSign * flowForMeanVelocity(vesselMeanVelocityCms(v, phase, 1, hemo), v.radiusMm),
          ]),
        );
        const b = Object.fromEntries(
          Object.entries(boundaries).map(([id, [vessel, sign]]) => [id, sign * q[vessel]!]),
        );
        for (const balance of flowBalances(graph, q, b)) {
          expect(Math.abs(balance.residualMlMin)).toBeLessThan(1e-9);
          expect(balance.relativeResidual).toBeLessThan(0.01);
        }
      }
    }
  });
});
