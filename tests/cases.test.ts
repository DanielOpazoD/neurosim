import { describe, expect, it } from 'vitest';
import { CASES, caseById } from '../src/domain/cases';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { skullAttenuationDb } from '../src/ultrasound/attenuation';
import { hemodynamics } from '../src/physiology/hemodynamics';
import { trueOnsdMm } from '../src/anatomy/eye';
import { lindegaardRatio } from '../src/doppler/measureMca';
import { sub, normalize, add, scale } from '../src/core/vec3';

describe('biblioteca de casos clínicos', () => {
  it('cada caso construye un ReferenceCase y caseById cae a normal', () => {
    for (const c of CASES) {
      const sim = buildReferenceCase(undefined, c.willisVariant, c);
      expect(sim.head.vessels.length).toBeGreaterThan(0);
      expect(sim.clinicalCase.id).toBe(c.id);
    }
    expect(caseById('nope').id).toBe('normal');
    expect(caseById(null).id).toBe('normal');
  });

  it('vasoespasmo eleva la velocidad de m1-izq por continuidad', () => {
    const normal = buildReferenceCase(undefined, 'normal', caseById('normal'));
    const spasm = buildReferenceCase(undefined, 'normal', caseById('vasoespasmo'));
    const n = normal.head.vessels.find((v) => v.id === 'm1-izq')!;
    const v = spasm.head.vessels.find((v2) => v2.id === 'm1-izq')!;
    expect(v.meanCms).toBeGreaterThanOrEqual(2.5 * n.meanCms);
    const nDer = normal.head.vessels.find((x) => x.id === 'm1-der')!;
    const vDer = spasm.head.vessels.find((x) => x.id === 'm1-der')!;
    expect(vDer.meanCms).toBeCloseTo(nDer.meanCms, 10);
  });

  it('ventanaPobre atenúa al menos 6 dB más que la ventana de referencia', () => {
    const normal = buildReferenceCase(undefined, 'normal', caseById('normal'));
    const poor = buildReferenceCase(undefined, 'normal', caseById('ventanaPobre'));
    const attenuationThrough = (head: typeof normal.head): number => {
      const wc = head.windowCenter.der;
      const n = normalize(sub(wc, head.skullCenter));
      return skullAttenuationDb(head, add(wc, scale(n, 15)), add(wc, scale(n, -20)), 2);
    };
    expect(attenuationThrough(poor.head) - attenuationThrough(normal.head)).toBeGreaterThanOrEqual(6);
  });

  it('hic dilata la DVNO y eleva el PI esperado', () => {
    const hic = buildReferenceCase(undefined, 'normal', caseById('hic'));
    expect(trueOnsdMm(hic.eyes.der, 3, 'interno')).toBeGreaterThan(5.8);
    const expected = hemodynamics(caseById('hic').physiology).expectedPi;
    const basal = hemodynamics(caseById('normal').physiology).expectedPi;
    expect(expected).toBeGreaterThan(basal);
  });

  it('paradaCirculatoria produce flujo oscilante (max>0, min<0)', () => {
    const hemo = hemodynamics(caseById('paradaCirculatoria').physiology);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const w = hemo.waveform(i / 2000);
      min = Math.min(min, w);
      max = Math.max(max, w);
    }
    expect(max).toBeGreaterThan(0);
    expect(min).toBeLessThan(0);
  });

  it('lindegaardRatio divide TAMax ACM por ACI extracraneal', () => {
    expect(lindegaardRatio(180, 45)).toBe(4);
    expect(lindegaardRatio(-180, 45)).toBe(4);
  });
});
