import { describe, expect, it } from 'vitest';
import { classifyHead, vesselAt } from '../src/anatomy/head';
import { ANATOMIA_CABEZA } from '../src/anatomy/params';
import { buildReferenceCase } from '../src/domain/referenceCase';
import type { WillisVariant } from '../src/domain/contracts';
import { FISIOLOGIA } from '../src/physiology/params';

const HEAD = ANATOMIA_CABEZA.params;
const PHYS = FISIOLOGIA.params;
const variants: WillisVariant[] = ['normal', 'aplasiaA1Der', 'aplasiaA1Izq', 'pcaFetalDer', 'pcaFetalIzq'];

function byId(sim: ReturnType<typeof buildReferenceCase>, id: string) {
  return sim.head.vessels.find((v) => v.id === id);
}

describe('polígono de Willis continuo', () => {
  it.each(variants)('conserva continuidad de caudal en %s', (variant) => {
    const vessels = buildReferenceCase(0x0c12ab, variant).head.vessels;
    const get = (id: string) => vessels.find((v) => v.id === id)?.flowMlMin ?? 0;
    for (const side of ['der', 'izq'] as const) {
      expect(get(`ica-${side}`)).toBeCloseTo(get(`m1-${side}`) + get(`a1-${side}`) + get(`pcoa-${side}`), 9);
      expect(get(`p2-${side}`)).toBeCloseTo(get(`p1-${side}`) + get(`pcoa-${side}`), 9);
    }
    expect(get('basilar')).toBeCloseTo(get('p1-der') + get('p1-izq'), 9);
    expect(get('vertebral-der')).toBeCloseTo(get('basilar') / 2, 9);
    expect(get('vertebral-izq')).toBeCloseTo(get('basilar') / 2, 9);
  });

  it('conserva M1 en 90/35 cm/s y las comunicantes normales sin flujo', () => {
    const sim = buildReferenceCase();
    const m1 = byId(sim, 'm1-der')!;
    expect(m1.psvCms).toBeCloseTo(90, 12);
    expect(m1.edvCms).toBeCloseTo(35, 12);
    expect(byId(sim, 'acoa')!.flowMlMin).toBe(0);
    expect(byId(sim, 'pcoa-der')!.flowMlMin).toBe(0);
    expect(byId(sim, 'pcoa-izq')!.flowMlMin).toBe(0);
  });

  it('redistribuye una aplasia A1 derecha hacia la ACoA', () => {
    const normal = buildReferenceCase();
    const sim = buildReferenceCase(0x0c12ab, 'aplasiaA1Der');
    expect(byId(sim, 'a1-der')).toBeUndefined();
    expect(byId(sim, 'a1-izq')!.radiusMm).toBeGreaterThan(byId(normal, 'a1-izq')!.radiusMm);
    expect(byId(sim, 'a1-izq')!.flowMlMin).toBeCloseTo(2 * PHYS.qA2MlMin.value, 12);
    expect(byId(sim, 'acoa')!.flowMlMin).toBeCloseTo(PHYS.qA2MlMin.value, 12);
    expect(byId(sim, 'acoa')!.flowSign).toBe(1);
  });

  it('reduce P1 y aumenta PCoA en la ACP fetal derecha', () => {
    const normal = buildReferenceCase();
    const sim = buildReferenceCase(0x0c12ab, 'pcaFetalDer');
    expect(byId(sim, 'p1-der')!.radiusMm).toBe(0.5);
    expect(byId(sim, 'pcoa-der')!.radiusMm).toBeGreaterThan(byId(sim, 'p1-der')!.radiusMm);
    expect(byId(sim, 'basilar')!.flowMlMin).toBeLessThan(byId(normal, 'basilar')!.flowMlMin);
    expect(byId(sim, 'pcoa-der')!.flowMlMin).toBeCloseTo(0.85 * PHYS.qP2MlMin.value, 12);
  });

  it('verifica Murray y conserva la discrepancia documentada de la basilar', () => {
    const sim = buildReferenceCase();
    const ica = byId(sim, 'ica-der')!;
    const m1 = byId(sim, 'm1-der')!;
    const a1 = byId(sim, 'a1-der')!;
    const icaError = Math.abs(ica.radiusMm ** 3 - (m1.radiusMm ** 3 + a1.radiusMm ** 3)) / ica.radiusMm ** 3;
    expect(icaError).toBeLessThan(0.25);

    const basilar = byId(sim, 'basilar')!;
    const p1 = byId(sim, 'p1-der')!;
    const basilarError = Math.abs(basilar.radiusMm ** 3 - 2 * p1.radiusMm ** 3) / basilar.radiusMm ** 3;
    expect(basilarError).toBeCloseTo(0.35009765625, 9);
  });

  it('mantiene M1 como vaso y los segmentos dentro del cráneo', () => {
    const sim = buildReferenceCase();
    const m1 = byId(sim, 'm1-der')!;
    expect(vesselAt(sim.head, m1.points[2]!)).toBe(m1);
    expect(classifyHead(sim.head, m1.points[2]!)).toBe('vaso');
    for (const vessel of sim.head.vessels) {
      for (const point of vessel.points) {
        expect(classifyHead(sim.head, point)).not.toBe('hueso');
        expect(classifyHead(sim.head, point)).not.toBe('aire');
      }
    }
  });

  it('conserva la geometría y radios de la puerta M1', () => {
    const sim = buildReferenceCase();
    const m1 = byId(sim, 'm1-der')!;
    expect(m1.points).toEqual([
      [-9, 8, -6],
      [-14, 9, -4],
      [-20, 9.5, -1],
      [-26, 10, 2],
      [-31, 11, 4],
    ]);
    expect(m1.radiusMm).toBe(HEAD.m1RadiusMm.value);
  });
});
