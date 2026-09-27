import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/core/random';
import {
  buildReferenceEyes,
  classifyEyeLocal,
  nerveCenterline,
  sheathRadiiAt,
  trueOnsdMm,
} from '../src/anatomy/eye';
import { classifyHead, inTemporalWindow, landmarkAt, skullThicknessAt, vesselAt } from '../src/anatomy/head';
import { ANATOMIA_CABEZA, ANATOMIA_OJO } from '../src/anatomy/params';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { dist, type Vec3 } from '../src/core/vec3';
import { temporalPose } from '../src/app/poses';
import { buildScan } from '../src/ultrasound/probe';

describe('ojo de referencia N1', () => {
  const rng = new SeededRandom(0x0c12ab);
  const eyes = buildReferenceEyes(rng);
  const off = ANATOMIA_OJO.params.onsdOffsetMm.value;

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

  it('ancla la ampolla en 3 mm y ensancha la vaina proximal', () => {
    expect(trueOnsdMm(eyes.der, 3, 'interno')).toBeCloseTo(4.6, 6);
    expect(trueOnsdMm(eyes.izq, 3, 'interno')).toBeCloseTo(4.7, 6);
    expect(trueOnsdMm(eyes.der, 1.5, 'interno')).toBeGreaterThan(trueOnsdMm(eyes.der, 3, 'interno'));
    expect(trueOnsdMm(eyes.der, 3, 'interno')).toBeGreaterThan(trueOnsdMm(eyes.der, 10, 'interno'));
  });

  it('clasifica la lámina cribosa en la inserción y conserva la pared lateral', () => {
    const insertion = nerveCenterline(eyes.der, 0);
    expect(classifyEyeLocal(eyes.der, insertion)).toBe('laminaCribosa');
    expect(classifyEyeLocal(eyes.der, [0, 0, -eyes.der.globeRadiusMm + 0.2])).toBe('paredGlobo');
  });

  it('aplica tortuosidad y mirada a la línea central del nervio', () => {
    const g = eyes.der;
    const s = 20;
    const bend = 1 - Math.exp(-s / 18);
    const noTortuosity: Vec3 = [
      -(1.2 + ANATOMIA_OJO.params.nerveNasalBendMm.value * bend),
      -0.4 * bend,
      -(g.globeRadiusMm + s),
    ];
    expect(dist(nerveCenterline(g, s), noTortuosity)).toBeLessThanOrEqual(
      ANATOMIA_OJO.params.tortuosityAmpMm.value + 1e-9,
    );
    const gaze = { ...g, gazeAngleRad: 0.3 };
    expect(nerveCenterline(gaze, s)[0] - nerveCenterline(g, s)[0]).toBeCloseTo(s * Math.sin(0.3), 6);
  });

  it('mantiene el centro del nervio clasificable en toda la profundidad N1', () => {
    for (const s of [2, 5, 10, 20]) {
      expect(classifyEyeLocal(eyes.der, nerveCenterline(eyes.der, s))).toBe('nervioOptico');
    }
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
    expect(classifyHead(h, m1.points[2]!)).toBe('vaso');
  });

  it('modela pedúnculos, muesca interpeduncular y sustancia negra', () => {
    const offset = ANATOMIA_CABEZA.params.peduncleOffsetXmm.value;
    const c = h.midbrainCenter;
    expect(classifyHead(h, [c[0] - offset, c[1], c[2]])).toBe('tejidoCerebral');
    expect(classifyHead(h, [c[0] + offset, c[1], c[2]])).toBe('tejidoCerebral');
    expect(classifyHead(h, [c[0], c[1], c[2] + 4])).toBe('cisterna');

    const snCenter: Vec3 = [c[0] + offset, c[1], c[2] + ANATOMIA_CABEZA.params.snCenterZOffsetMm.value];
    expect(classifyHead(h, snCenter)).toBe('sustanciaNegra');
    const snHalfWidth = ANATOMIA_CABEZA.params.snHalfWidthMm.value;
    const snHalfHeight = (ANATOMIA_CABEZA.params.snAreaCm2.value * 100) / (Math.PI * snHalfWidth);
    let areaMm2 = 0;
    for (let x = -snHalfWidth; x <= snHalfWidth; x += 0.1) {
      for (let y = -snHalfHeight; y <= snHalfHeight; y += 0.1) {
        if (classifyHead(h, [snCenter[0] + x, snCenter[1] + y, snCenter[2]]) === 'sustanciaNegra') {
          areaMm2 += 0.01;
        }
      }
    }
    const areaCm2 = areaMm2 / 100;
    expect(areaCm2).toBeGreaterThan(ANATOMIA_CABEZA.params.snAreaCm2.value * 0.8);
    expect(areaCm2).toBeLessThan(ANATOMIA_CABEZA.params.snAreaCm2.value * 1.2);
  });

  it('clasifica el plano diencefálico y sus hitos', () => {
    const c = h.thirdVentricleCenter;
    expect(classifyHead(h, c)).toBe('lcrVaina');
    expect(classifyHead(h, [c[0] + 2.75, c[1], c[2]])).toBe('ependimo');
    expect(classifyHead(h, [c[0] + 10, c[1], c[2]])).toBe('talamo');
    expect(classifyHead(h, [c[0], c[1], c[2] - 7])).toBe('pineal');
    expect(landmarkAt(h, h.midbrainCenter)).toBe('mesencefalo');
    expect(
      landmarkAt(h, [
        h.midbrainCenter[0] + 6,
        h.midbrainCenter[1],
        h.midbrainCenter[2] + ANATOMIA_CABEZA.params.snCenterZOffsetMm.value,
      ]),
    ).toBe('sustanciaNegra');
    expect(landmarkAt(h, c)).toBe('tercerVentriculo');
    expect(landmarkAt(h, [c[0] + 10, c[1], c[2]])).toBe('talamo');
    expect(landmarkAt(h, [c[0], c[1], c[2] - 7])).toBe('pineal');
    expect(landmarkAt(h, [h.midbrainCenter[0], h.midbrainCenter[1], h.midbrainCenter[2] + 4])).toBe(
      'cisternaInterpeduncular',
    );
    expect(landmarkAt(h, [h.midbrainCenter[0] + 3, h.midbrainCenter[1] + 1, h.midbrainCenter[2] - 4])).toBe(
      'nucleoRojo',
    );
    expect(landmarkAt(h, [h.midbrainCenter[0], h.midbrainCenter[1], h.midbrainCenter[2] - 2])).toBe('rafe');
    expect(landmarkAt(h, [c[0] + 10, c[1], c[2] + 15])).toBe('cuernoFrontal');
    expect(landmarkAt(h, [h.midbrainCenter[0] + 20, h.midbrainCenter[1] - 4, h.midbrainCenter[2] - 30])).toBe(
      'penasco',
    );
  });

  it('separa el plano mesencefálico del diencefálico mediante el tilt', () => {
    const countsAtTilt = (tiltDeg: number): { midbrain: number; ventricle: number } => {
      const pose = temporalPose(buildReferenceCase(), {
        side: 'der',
        station: 'temporal',
        tiltDeg,
        offsetMm: 0,
        rotDeg: 0,
        press: 0.3,
      });
      const scan = buildScan(pose, 'sector', 65);
      let midbrain = 0;
      let ventricle = 0;
      for (const line of scan.lines) {
        for (let i = 0; i <= 1000; i++) {
          const p: Vec3 = [
            line.origin[0] + line.dir[0] * i * 0.1,
            line.origin[1] + line.dir[1] * i * 0.1,
            line.origin[2] + line.dir[2] * i * 0.1,
          ];
          if (landmarkAt(h, p) === 'mesencefalo') midbrain++;
          if (landmarkAt(h, p) === 'tercerVentriculo') ventricle++;
        }
      }
      return { midbrain, ventricle };
    };
    const mesencephalic = countsAtTilt(0);
    const diencephalic = countsAtTilt(10);
    expect(mesencephalic.midbrain).toBeGreaterThan(0);
    expect(mesencephalic.ventricle).toBe(0);
    expect(diencephalic.ventricle).toBeGreaterThan(0);
    expect(diencephalic.midbrain).toBe(0);
  });
});
