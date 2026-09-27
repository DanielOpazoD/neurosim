import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/core/random';
import {
  buildReferenceEyes,
  classifyEyeLocal,
  nerveCenterline,
  sheathRadiiAt,
  trueOnsdMm,
} from '../src/anatomy/eye';
import { classifyHead, inTemporalWindow, skullThicknessAt, vesselAt } from '../src/anatomy/head';
import { NEURO_PARAMS } from '../src/domain/parameters';
import { buildReferenceCase } from '../src/domain/referenceCase';

describe('ojo de referencia N1', () => {
  const rng = new SeededRandom(0x0c12ab);
  const eyes = buildReferenceEyes(rng);
  const off = NEURO_PARAMS.params.onsdOffsetMm.value;

  it('el centro del globo es vítreo y la cara anterior, córnea/párpado', () => {
    expect(classifyEyeLocal(eyes.der, [0, 0, 0])).toBe('vitrio');
    expect(classifyEyeLocal(eyes.der, [0, 0, eyes.der.globeRadiusMm - 0.6])).toBe('cornea');
    expect(classifyEyeLocal(eyes.der, [0, 0, eyes.der.globeRadiusMm + 0.6])).toBe('piel');
    expect(classifyEyeLocal(eyes.der, [0, 0, eyes.der.globeRadiusMm + 4])).toBe('aire');
  });

  it('el cristalino está detrás del iris y no toca el nervio', () => {
    const r = eyes.der.globeRadiusMm;
    expect(classifyEyeLocal(eyes.der, [0, 0, r - 3.6])).toBe('cristalino');
    expect(classifyEyeLocal(eyes.der, [0, 0, -5])).not.toBe('cristalino');
  });

  it('a 3 mm retroglobo la sección es nervio → LCR → dura → grasa', () => {
    const c = nerveCenterline(eyes.der, off);
    const g = eyes.der;
    const radii = sheathRadiiAt(g, off);
    expect(classifyEyeLocal(g, c)).toBe('nervioOptico');
    // punto entre nervio y dura en el eje menor: LCR
    const lcr = [c[0], c[1] + radii.nerve + (radii.minor - radii.nerve) * 0.5, c[2]] as const;
    expect(classifyEyeLocal(g, [lcr[0], lcr[1], lcr[2]])).toBe('lcrVaina');
    // fuera de la vaina: grasa retrobulbar
    const out = [c[0], c[1] + radii.major + 2, c[2]];
    expect(classifyEyeLocal(g, out as [number, number, number])).toBe('grasaOrbitaria');
  });

  it('DVNO interno ≈ externo − 2·dura, en los valores del fixture', () => {
    const ext = trueOnsdMm(eyes.der, off, 'externo');
    const int = trueOnsdMm(eyes.der, off, 'interno');
    expect(ext - int).toBeCloseTo(2 * eyes.der.duraMm, 6);
    expect(ext).toBeGreaterThan(4);
    expect(ext).toBeLessThan(7);
  });
});

describe('cráneo de referencia N1', () => {
  const cas = buildReferenceCase();
  const h = cas.head;

  it('la ventana temporal es más fina que el resto del cráneo', () => {
    const wc = h.windowCenter.der;
    expect(inTemporalWindow(h, 'der', wc)).toBe(true);
    expect(skullThicknessAt(h, wc)).toBeLessThan(h.skullThicknessMm);
    const fuera = [h.skullCenter[0], h.skullCenter[1] + h.skullRadii[1] - 1, h.skullCenter[2]];
    expect(skullThicknessAt(h, fuera as [number, number, number])).toBe(h.skullThicknessMm);
  });

  it('el mesencéfalo está dentro del cráneo y es tejido cerebral', () => {
    expect(classifyHead(h, h.midbrainCenter)).toBe('tejidoCerebral');
  });

  it('M1 está a 40–65 mm de la ventana ipsilateral', () => {
    const m1 = h.vessels.find((v) => v.id === 'm1-der')!;
    const d = Math.hypot(
      m1.points[2]![0] - h.windowCenter.der[0],
      m1.points[2]![1] - h.windowCenter.der[1],
      m1.points[2]![2] - h.windowCenter.der[2],
    );
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(75);
    expect(vesselAt(h, m1.points[2]!)).toBe(m1);
  });
});
