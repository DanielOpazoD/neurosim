import type { Side, WillisVariant } from '../domain/contracts';
import type { Vessel } from './head';
import { ANATOMIA_CABEZA } from './params';
import { arterialShapeMean, FISIOLOGIA } from '../physiology/params';

const HEAD = ANATOMIA_CABEZA.params;
const PHYS = FISIOLOGIA.params;

const FLOW_SCALE_ML_MIN = 0.6;
const M1_MEAN_CMS = PHYS.edvCms.value + (PHYS.psvCms.value - PHYS.edvCms.value) * arterialShapeMean();

function velocityForFlow(flowMlMin: number, radiusMm: number): { psvCms: number; edvCms: number } {
  const meanCms = flowMlMin / (Math.PI * radiusMm * radiusMm * FLOW_SCALE_ML_MIN);
  const scale = M1_MEAN_CMS > 0 ? meanCms / M1_MEAN_CMS : 0;
  return {
    psvCms: PHYS.psvCms.value * scale,
    edvCms: PHYS.edvCms.value * scale,
  };
}

function roundRadius(value: number): number {
  return Math.round(value * 100) / 100;
}

function murrayRadius(radiusMm: number, flowMlMin: number, referenceFlowMlMin: number): number {
  return roundRadius(radiusMm * Math.pow(flowMlMin / referenceFlowMlMin, 1 / 3));
}

function vessel(
  id: string,
  side: Side | 'media',
  points: readonly [number, number, number][],
  radiusMm: number,
  flowMlMin: number,
  flowSign: 1 | -1,
): Vessel {
  const velocity = velocityForFlow(flowMlMin, radiusMm);
  return { id, side, points, radiusMm, flowSign, flowMlMin, ...velocity };
}

function sideLabel(s: 1 | -1): Side {
  return s === 1 ? 'izq' : 'der';
}

/**
 * Construye el grafo vascular del polígono de Willis.
 *
 * `points` siempre están ordenados proximal→distal según la anatomía del
 * segmento. `flowSign` invierte esa orientación solo cuando una variante
 * altera el sentido de una comunicante.
 */
export function buildWillisVessels(variant: WillisVariant = 'normal'): Vessel[] {
  const qM1 = PHYS.qM1MlMin.value;
  const qA2 = PHYS.qA2MlMin.value;
  const qP2 = PHYS.qP2MlMin.value;
  const aplasia: 1 | -1 | 0 = variant === 'aplasiaA1Izq' ? 1 : variant === 'aplasiaA1Der' ? -1 : 0;
  const fetal: 1 | -1 | 0 = variant === 'pcaFetalIzq' ? 1 : variant === 'pcaFetalDer' ? -1 : 0;
  const a1Q = (s: 1 | -1): number => (aplasia === 0 ? qA2 : s === aplasia ? 0 : 2 * qA2);
  const p1Q = (s: 1 | -1): number => (fetal !== 0 && s === fetal ? 0.15 * qP2 : qP2);
  const pcoaQ = (s: 1 | -1): number => (fetal !== 0 && s === fetal ? 0.85 * qP2 : 0);
  const vessels: Vessel[] = [];

  for (const s of [1, -1] as const) {
    const side = sideLabel(s);
    const m1Q = qM1;
    const a1Flow = a1Q(s);
    const pcoaFlow = pcoaQ(s);
    const icaQ = m1Q + a1Flow + pcoaFlow;
    vessels.push(
      vessel(
        `m1-${side}`,
        side,
        [
          [s * HEAD.m1OriginXmm.value, HEAD.m1OriginYmm.value, HEAD.m1OriginZmm.value],
          [s * HEAD.m1Point1Xmm.value, HEAD.m1Point1Ymm.value, HEAD.m1Point1Zmm.value],
          [s * HEAD.vesselM1PointXmm.value, HEAD.vesselM1PointYmm.value, HEAD.vesselM1PointZmm.value],
          [s * HEAD.m1Point3Xmm.value, HEAD.m1Point3Ymm.value, HEAD.m1Point3Zmm.value],
          [s * HEAD.m1Point4Xmm.value, HEAD.m1Point4Ymm.value, HEAD.m1Point4Zmm.value],
        ],
        HEAD.m1RadiusMm.value,
        m1Q,
        1,
      ),
      vessel(
        `ica-${side}`,
        side,
        [
          [s * 9, -6, -4],
          [s * 9, 1, -5],
          [s * 9, 8, -6],
        ],
        HEAD.icaRadiusMm.value,
        icaQ,
        1,
      ),
      vessel(
        `a2-${side}`,
        side,
        [
          [s * 1.5, 10, 2],
          [s * 2, 18, 6],
          [s * 2, 28, 8],
        ],
        HEAD.a2RadiusMm.value,
        qA2,
        1,
      ),
      vessel(
        `pcoa-${side}`,
        side,
        [
          [s * 9, 8, -6],
          [s * 10, 7, -15],
          [s * 11, 8, -24],
        ],
        fetal !== 0 && s === fetal
          ? murrayRadius(HEAD.p2RadiusMm.value, 0.85 * qP2, qP2)
          : HEAD.pcoaRadiusMm.value,
        pcoaFlow,
        1,
      ),
      vessel(
        `p1-${side}`,
        side,
        [
          [0, 6, -26],
          [s * 5, 7, -26],
          [s * 11, 8, -24],
        ],
        fetal !== 0 && s === fetal ? 0.5 : HEAD.p1RadiusMm.value,
        p1Q(s),
        1,
      ),
      vessel(
        `p2-${side}`,
        side,
        [
          [s * 11, 8, -24],
          [s * 15, 9, -20],
          [s * 17, 10, -15],
        ],
        HEAD.p2RadiusMm.value,
        qP2,
        1,
      ),
    );
    if (!(aplasia !== 0 && s === aplasia)) {
      vessels.push(
        vessel(
          `a1-${side}`,
          side,
          [
            [s * 9, 8, -6],
            [s * 5, 9, -1],
            [s * 1.5, 10, 2],
          ],
          aplasia !== 0 && s === -aplasia
            ? murrayRadius(HEAD.a1RadiusMm.value, 2 * qA2, qA2)
            : HEAD.a1RadiusMm.value,
          a1Flow,
          1,
        ),
      );
    }
  }

  const acoaDirection: 1 | -1 = aplasia === 1 ? -1 : 1;
  vessels.push(
    vessel(
      'acoa',
      'media',
      [
        [1.5, 10, 2],
        [-1.5, 10, 2],
      ],
      aplasia !== 0 ? murrayRadius(HEAD.acoaRadiusMm.value, qA2, qA2) : HEAD.acoaRadiusMm.value,
      aplasia !== 0 ? qA2 : 0,
      acoaDirection,
    ),
    vessel(
      'basilar',
      'media',
      [
        [0, 0, -30],
        [0, 3, -28],
        [0, 6, -26],
      ],
      HEAD.basilarRadiusMm.value,
      p1Q(1) + p1Q(-1),
      1,
    ),
  );
  for (const s of [1, -1] as const) {
    vessels.push(
      vessel(
        `vertebral-${sideLabel(s)}`,
        sideLabel(s),
        [
          [s * 4, -8, -32],
          [s * 2, -4, -31],
          [0, 0, -30],
        ],
        HEAD.vertebralRadiusMm.value,
        (p1Q(1) + p1Q(-1)) / 2,
        1,
      ),
    );
  }
  return vessels;
}
