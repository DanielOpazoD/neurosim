import { describe, expect, it } from 'vitest';
import { CASES, caseById } from '../src/domain/cases';
import { classifyHead } from '../src/anatomy/head';
import { headScene } from '../src/app/renderRequest';
import { ANATOMIA_CABEZA } from '../src/anatomy/params';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { skullAttenuationDb } from '../src/ultrasound/attenuation';
import { hemodynamics } from '../src/physiology/hemodynamics';
import { trueOnsdMm } from '../src/anatomy/eye';
import { lindegaardIndex, lindegaardInterpretation, lindegaardRatio } from '../src/doppler/measureMca';
import { sub, normalize, add, scale, dot } from '../src/core/vec3';
import { landmarkAt } from '../src/anatomy/head';
import { temporalPose } from '../src/app/poses';

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

  it('lindegaardIndex prefiere la ACI medida y cae a la de referencia (DEC-58)', () => {
    expect(lindegaardIndex(-150, -37.5, 45)).toEqual({
      mcaTaMaxCms: 150,
      icaTaMaxCms: 37.5,
      ratio: 4,
      icaSource: 'medida',
    });
    expect(lindegaardIndex(90, null, 45)).toMatchObject({ ratio: 2, icaSource: 'referencia' });
    expect(lindegaardIndex(90, Number.NaN, 45).icaSource).toBe('referencia');
    expect(lindegaardInterpretation(2.2)).toBe('hiperemia o normal');
    expect(lindegaardInterpretation(4)).toBe('vasoespasmo leve-moderado');
    expect(lindegaardInterpretation(6.5)).toBe('vasoespasmo grave');
  });

  it('parkinson: SN ≥ 0,25 cm² por lado (percentil 90) y más ecogénica', () => {
    const parkinson = caseById('parkinson');
    const sim = buildReferenceCase(undefined, 'normal', parkinson);
    const h = sim.head;
    // Sección x–y por el centro de la SN: rejilla 0,15 mm sobre el elipsoide.
    const step = 0.15;
    const areaCm2 = (side: -1 | 1): number => {
      const c: [number, number, number] = [
        h.midbrainCenter[0] + side * ANATOMIA_CABEZA.params.peduncleOffsetXmm.value,
        h.midbrainCenter[1] + ANATOMIA_CABEZA.params.snCenterYmm.value,
        h.midbrainCenter[2] + ANATOMIA_CABEZA.params.snCenterZOffsetMm.value,
      ];
      let n = 0;
      for (let dx = -5; dx <= 5; dx += step) {
        for (let dy = -7; dy <= 7; dy += step) {
          if (classifyHead(h, [c[0] + dx, c[1] + dy, c[2]]) === 'sustanciaNegra') n++;
        }
      }
      return (n * step * step) / 100;
    };
    expect(areaCm2(-1)).toBeGreaterThanOrEqual(0.25);
    expect(areaCm2(1)).toBeGreaterThanOrEqual(0.25);
    // Ecogenicidad: headScene escala el scatter de sustanciaNegra ×2,4.
    const snPoint = [
      h.midbrainCenter[0] - ANATOMIA_CABEZA.params.peduncleOffsetXmm.value,
      h.midbrainCenter[1] + ANATOMIA_CABEZA.params.snCenterYmm.value,
      h.midbrainCenter[2] + ANATOMIA_CABEZA.params.snCenterZOffsetMm.value,
    ] as const;
    expect(classifyHead(h, [...snPoint])).toBe('sustanciaNegra');
    expect(headScene(h, 'x', undefined, parkinson.snEchogenicity).scatterScale([...snPoint])).toBeCloseTo(
      2.4,
      6,
    );
  });
});

describe('casos del plano diencefálico', () => {
  it('desplazamientoLineaMedia mueve el III ventrículo +6 mm y la distancia sonda→III difiere ~12 mm', () => {
    const normal = buildReferenceCase();
    const sim = buildReferenceCase(undefined, 'normal', caseById('desplazamientoLineaMedia'));
    const c0 = normal.head.thirdVentricleCenter;
    // El centro original ya no es ventrículo; el desplazado +6 mm sí.
    expect(landmarkAt(sim.head, c0)).not.toBe('tercerVentriculo');
    expect(landmarkAt(sim.head, [c0[0] + 6, c0[1], c0[2]])).toBe('tercerVentriculo');
    expect(sim.truths.midlineShiftMm).toBe(6);
    // Profundidad axial (a lo largo del haz) al III ventrículo desde cada ventana.
    const depth = (side: 'der' | 'izq') => {
      const pose = temporalPose(sim, {
        side,
        station: 'temporal',
        tiltDeg: 10,
        offsetMm: 0,
        rotDeg: 0,
        press: 0.3,
      });
      return dot(sub(sim.head.thirdVentricleCenter, pose.origin), pose.forward);
    };
    const delta = depth('der') - depth('izq');
    expect(Math.abs(delta - 12)).toBeLessThanOrEqual(1);
  });

  it('hidrocefalia: III ventrículo de 12 ± 0,5 mm y cuernos frontales ×1,6', () => {
    const sim = buildReferenceCase(undefined, 'normal', caseById('hidrocefalia'));
    const c = sim.head.thirdVentricleCenter;
    expect(sim.truths.thirdVentricleWidthMm).toBe(12);
    let x0: number | null = null;
    let x1: number | null = null;
    for (let x = -15; x <= 15; x += 0.05) {
      if (classifyHead(sim.head, [c[0] + x, c[1], c[2]]) === 'lcrVaina') {
        if (x0 === null) x0 = x;
        x1 = x;
      }
    }
    expect(x1! - x0!).toBeGreaterThanOrEqual(11.5);
    expect(x1! - x0!).toBeLessThanOrEqual(12.5);
    // Cuerno frontal dilatado: un punto a 1,3× el radio lateral nominal sigue siendo LCR.
    const horn = [
      c[0]! + ANATOMIA_CABEZA.params.frontalHornCenterXmm.value,
      c[1]!,
      c[2]! + ANATOMIA_CABEZA.params.frontalHornCenterZmm.value,
    ];
    const edge = [horn[0]! + ANATOMIA_CABEZA.params.frontalHornRadiusXmm.value * 1.3, horn[1]!, horn[2]!];
    expect(classifyHead(sim.head, edge as [number, number, number])).toBe('lcrVaina');
    expect(classifyHead(buildReferenceCase().head, edge as [number, number, number])).not.toBe('lcrVaina');
  });
});
