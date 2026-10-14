import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/core/vec3';
import { fromEyeLocal, nerveCenterline } from '../../src/anatomy/eye';
import type { Vessel } from '../../src/anatomy/head';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import type { WillisVariant } from '../../src/domain/contracts';

const VARIANTS: WillisVariant[] = ['normal', 'aplasiaA1Der', 'aplasiaA1Izq', 'pcaFetalDer', 'pcaFetalIzq'];

/**
 * Coherencia regional (DEC-76): las uniones declaradas comparten nodo exacto,
 * los tubos no conectados no se interpenetran y los marcos oculares apuntan
 * hacia afuera en ambos lados. Son invariantes geométricas del fixture, no una
 * validación anatómica externa.
 */
const sim = buildReferenceCase();
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ends = (v: Vessel): Vec3[] => [v.points[0]!, v.points[v.points.length - 1]!];

function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = l === 0 ? 0 : Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l));
  return dist(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]);
}

function minCenterlineDist(a: Vessel, b: Vessel): number {
  let m = Infinity;
  for (const p of a.points)
    for (let k = 0; k + 1 < b.points.length; k++) m = Math.min(m, segDist(p, b.points[k]!, b.points[k + 1]!));
  return m;
}

/** Tubos sin extremo común: su separación debe superar la suma de radios. */
function overlaps(vessels: readonly Vessel[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < vessels.length; i++)
    for (let j = i + 1; j < vessels.length; j++) {
      const a = vessels[i]!;
      const b = vessels[j]!;
      const joined =
        ends(a).some((p) => ends(b).some((q) => dist(p, q) < 1e-9)) ||
        ends(a).some((p) => b.controlPoints.some((q) => dist(p, q) < 1e-9)) ||
        ends(b).some((p) => a.controlPoints.some((q) => dist(p, q) < 1e-9));
      if (joined) continue;
      const m = minCenterlineDist(a, b);
      if (m < a.radiusMm + b.radiusMm) out.push(`${a.id}~${b.id} (${m.toFixed(2)} mm)`);
    }
  return out;
}

/** Extremos a menos de 6 mm de otro extremo deben coincidir o estar declarados libres. */
function nearMisses(vessels: readonly Vessel[], free: readonly string[]): string[] {
  const out: string[] = [];
  for (const a of vessels)
    for (const [k, p] of ends(a).entries()) {
      if (free.includes(`${a.id}:${k === 0 ? 'ini' : 'fin'}`)) continue;
      let best = Infinity;
      let who = '';
      for (const b of vessels) {
        if (b === a) continue;
        for (const q of [...ends(b), ...b.controlPoints]) {
          const d = dist(p, q);
          if (d < best) {
            best = d;
            who = b.id;
          }
        }
      }
      if (best > 1e-9 && best < 6)
        out.push(`${a.id} ${k === 0 ? 'ini' : 'fin'} → ${who} ${best.toFixed(2)} mm`);
    }
  return out;
}

describe('coherencia regional del fixture (DEC-76)', () => {
  it.each(VARIANTS.map((variant) => ({ variant })))(
    'Willis $variant: las uniones comparten nodo y ningún tubo no conectado se interpenetra',
    ({ variant }) => {
      const vessels = buildReferenceCase(0x0c12ab, variant).head.vessels;
      expect(nearMisses(vessels, ['a2-der:fin', 'a2-izq:fin'])).toEqual([]);
      expect(overlaps(vessels)).toEqual([]);
    },
  );

  it('la punta basilar es el origen exacto de ambas P1', () => {
    const by = new Map(sim.head.vessels.map((v) => [v.id, v]));
    const tip = ends(by.get('basilar')!)[1]!;
    for (const side of ['der', 'izq'] as const)
      expect(dist(ends(by.get(`p1-${side}`)!)[0]!, tip)).toBeLessThan(1e-9);
  });

  it('la ACI cervical termina donde empieza el sifón del mismo lado', () => {
    for (const side of ['der', 'izq'] as const) {
      const aci = sim.neck[side].vessels.find((v) => v.id === `aci-${side}`)!;
      const ica = sim.head.vessels.find((v) => v.id === `ica-${side}`)!;
      expect(dist(ends(aci)[1]!, ends(ica)[0]!)).toBeLessThan(1e-9);
      expect(ica.radiusMm).toBeLessThanOrEqual(aci.radiusMm);
    }
  });

  it('las ramas de la ACE nacen sobre el tronco y no se interpenetran con él', () => {
    for (const side of ['der', 'izq'] as const) {
      const vessels = sim.neck[side].vessels;
      expect(overlaps(vessels)).toEqual([]);
      const ace = vessels.find((v) => v.id === `ace-${side}`)!;
      for (const id of ['ace-facial', 'ace-lingual']) {
        const origin = ends(vessels.find((v) => v.id === `${id}-${side}`)!)[0]!;
        expect(ace.controlPoints.some((q) => dist(q, origin) < 1e-9)).toBe(true);
      }
    }
  });

  it('el eje temporal de cada ojo apunta hacia afuera y el nervio se acerca al plano medio', () => {
    for (const side of ['der', 'izq'] as const) {
      const g = sim.eyes[side];
      const outward = Math.sign(g.center[0]);
      expect(g.temporal[0] * outward).toBeGreaterThan(0.99);
      const papila = fromEyeLocal(g, nerveCenterline(g, 0));
      const canal = fromEyeLocal(g, nerveCenterline(g, 25));
      expect(Math.abs(canal[0])).toBeLessThan(Math.abs(papila[0]));
      expect(Math.abs(papila[0])).toBeLessThan(Math.abs(g.center[0]) + 0.5);
    }
  });

  it('los dos ojos son imagen especular salvo las asimetrías documentadas', () => {
    const d = sim.eyes.der;
    const i = sim.eyes.izq;
    expect(d.center[0]).toBeCloseTo(-i.center[0], 9);
    expect(d.temporal[0]).toBeCloseTo(-i.temporal[0], 9);
    for (const s of [0, 10, 25]) {
      const pd = fromEyeLocal(d, nerveCenterline(d, s));
      const pi = fromEyeLocal(i, nerveCenterline(i, s));
      expect(Math.abs(Math.abs(pd[0]) - Math.abs(pi[0]))).toBeLessThan(1.5);
      expect(Math.abs(pd[2] - pi[2])).toBeLessThan(1.5);
    }
  });
});
