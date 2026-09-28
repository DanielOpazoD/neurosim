import type { Side, WillisVariant } from '../domain/contracts';
import type { Vec3 } from '../core/vec3';
import type { Vessel } from './head';
import { ANATOMIA_CABEZA } from './params';
import { FISIOLOGIA } from '../physiology/params';

const HEAD = ANATOMIA_CABEZA.params;
const PHYS = FISIOLOGIA.params;

const FLOW_SCALE_ML_MIN = 0.6;
function velocityForFlow(
  flowMlMin: number,
  radiusMm: number,
): {
  meanCms: number;
  psvCms: number;
  edvCms: number;
} {
  const meanCms = flowMlMin / (Math.PI * radiusMm * radiusMm * FLOW_SCALE_ML_MIN);
  const scale = meanCms / 55;
  return {
    meanCms,
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

/**
 * Spline Catmull-Rom centripetal por los puntos de control, remuestreada a
 * ~`stepMm` por longitud de arco; conserva los extremos exactos.
 */
export function smoothPolyline(points: readonly Vec3[], stepMm = 1.0): Vec3[] {
  if (points.length < 3) return points.map((p) => [...p] as Vec3);
  const P: Vec3[] = [points[0]!, ...points, points[points.length - 1]!];
  const dist = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const dense: Vec3[] = [];
  for (let i = 0; i < P.length - 3; i++) {
    const p0 = P[i]!;
    const p1 = P[i + 1]!;
    const p2 = P[i + 2]!;
    const p3 = P[i + 3]!;
    const t1 = Math.sqrt(Math.max(1e-9, dist(p0, p1)));
    const t2 = t1 + Math.sqrt(Math.max(1e-9, dist(p1, p2)));
    const t3 = t2 + Math.sqrt(Math.max(1e-9, dist(p2, p3)));
    const n = Math.max(2, Math.ceil((t2 - t1) / (stepMm / 4)));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const seg = (a: Vec3, b: Vec3, ta: number, tb: number): Vec3 => {
        const w = tb === ta ? 0 : (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
      };
      const a1 = seg(p0, p1, 0, t1);
      const a2 = seg(p1, p2, t1, t2);
      const a3 = seg(p2, p3, t2, t3);
      const b1 = seg(a1, a2, 0, t2);
      const b2 = seg(a2, a3, t1, t3);
      dense.push(seg(b1, b2, t1, t2));
    }
  }
  // Remuestreo uniforme por longitud de arco (≤ stepMm por segmento),
  // interpolando sobre la polilínea densa.
  const out: Vec3[] = [dense[0]!];
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]!;
    const b = dense[i]!;
    const seg = dist(a, b);
    let consumed = 0;
    while (acc + seg - consumed >= stepMm) {
      consumed += stepMm - acc;
      const t = consumed / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      acc = 0;
    }
    acc += seg - consumed;
  }
  const last = points[points.length - 1]!;
  if (dist(out[out.length - 1]!, last) > 1e-9) out.push([last[0], last[1], last[2]]);
  else out[out.length - 1] = [last[0], last[1], last[2]];
  return out;
}

function vessel(
  id: string,
  side: Side | 'media',
  controlPoints: readonly Vec3[],
  radiusMm: number,
  flowMlMin: number,
  flowSign: 1 | -1,
): Vessel {
  const velocity = velocityForFlow(flowMlMin, radiusMm);
  const points = smoothPolyline(controlPoints);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i]! - radiusMm < min[i]!) min[i] = p[i]! - radiusMm;
      if (p[i]! + radiusMm > max[i]!) max[i] = p[i]! + radiusMm;
    }
  }
  return {
    id,
    side,
    points,
    controlPoints,
    radiusMm,
    flowSign,
    flowMlMin,
    aabb: { min, max },
    ...velocity,
  };
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
export function buildWillisVessels(
  variant: WillisVariant = 'normal',
  radiusScale: Readonly<Record<string, number>> = {},
): Vessel[] {
  const qM1 = PHYS.qM1MlMin.value;
  const qA2 = PHYS.qA2MlMin.value;
  const qP2 = PHYS.qP2MlMin.value;
  const aplasia: 1 | -1 | 0 = variant === 'aplasiaA1Izq' ? 1 : variant === 'aplasiaA1Der' ? -1 : 0;
  const fetal: 1 | -1 | 0 = variant === 'pcaFetalIzq' ? 1 : variant === 'pcaFetalDer' ? -1 : 0;
  const a1Q = (s: 1 | -1): number => (aplasia === 0 ? qA2 : s === aplasia ? 0 : 2 * qA2);
  const p1Q = (s: 1 | -1): number => (fetal !== 0 && s === fetal ? 0.15 * qP2 : qP2);
  const pcoaQ = (s: 1 | -1): number => (fetal !== 0 && s === fetal ? 0.85 * qP2 : 0);
  // `radiusScale` (casos clínicos) reduce el radio ANTES de `velocityForFlow`:
  // el flujo no cambia, así que la velocidad sube por continuidad (espasmo).
  const v = (
    id: string,
    side: Side | 'media',
    controlPoints: readonly Vec3[],
    radiusMm: number,
    flowMlMin: number,
    flowSign: 1 | -1,
  ): Vessel => vessel(id, side, controlPoints, radiusMm * (radiusScale[id] ?? 1), flowMlMin, flowSign);
  const vessels: Vessel[] = [];

  for (const s of [1, -1] as const) {
    const side = sideLabel(s);
    const m1Q = qM1;
    const a1Flow = a1Q(s);
    const pcoaFlow = pcoaQ(s);
    const icaQ = m1Q + a1Flow + pcoaFlow;
    vessels.push(
      v(
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
      v(
        `m2-sup-${side}`,
        side,
        [
          [s * 32, 14, 4],
          [s * 37, 20, 4],
          [s * 41, 27, 3],
        ],
        HEAD.m2RadiusMm.value,
        m1Q / 2,
        1,
      ),
      v(
        `m2-inf-${side}`,
        side,
        [
          [s * 32, 14, 4],
          [s * 36, 10, 7],
          [s * 40, 6, 10],
        ],
        HEAD.m2RadiusMm.value,
        m1Q / 2,
        1,
      ),
      // Sifón carotídeo C4–C6: curva en S hacia la bifurcación ACI.
      v(
        `ica-${side}`,
        side,
        [
          [s * 9, -4, -10],
          [s * 10, 0, -4],
          [s * 9.5, 4, -8],
          [s * 9, 8, -7],
          [s * 9, 12, -6],
        ],
        HEAD.icaRadiusMm.value,
        icaQ,
        1,
      ),
      v(
        `a2-${side}`,
        side,
        [
          [s * 1.5, 14, 2],
          [s * 2, 22, 6],
          [s * 2, 32, 8],
        ],
        HEAD.a2RadiusMm.value,
        qA2,
        1,
      ),
      v(
        `pcoa-${side}`,
        side,
        [
          [s * 9, 12, -6],
          [s * 10, 10, -15],
          [s * 11, 10, -24],
        ],
        fetal !== 0 && s === fetal
          ? murrayRadius(HEAD.p2RadiusMm.value, 0.85 * qP2, qP2)
          : HEAD.pcoaRadiusMm.value,
        pcoaFlow,
        1,
      ),
      v(
        `p1-${side}`,
        side,
        [
          [0, 8, -26],
          [s * 5, 9, -26],
          [s * 11, 10, -24],
        ],
        fetal !== 0 && s === fetal ? 0.5 : HEAD.p1RadiusMm.value,
        p1Q(s),
        1,
      ),
      v(
        `p2-${side}`,
        side,
        [
          [s * 11, 10, -24],
          [s * 15, 11, -20],
          [s * 17, 12, -15],
        ],
        HEAD.p2RadiusMm.value,
        qP2,
        1,
      ),
    );
    if (!(aplasia !== 0 && s === aplasia)) {
      vessels.push(
        v(
          `a1-${side}`,
          side,
          [
            [s * 9, 12, -6],
            [s * 5, 13, -1],
            [s * 1.5, 14, 2],
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
    v(
      'acoa',
      'media',
      [
        [1.5, 14, 2],
        [-1.5, 14, 2],
      ],
      aplasia !== 0 ? murrayRadius(HEAD.acoaRadiusMm.value, qA2, qA2) : HEAD.acoaRadiusMm.value,
      aplasia !== 0 ? qA2 : 0,
      acoaDirection,
    ),
    v(
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
      v(
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
