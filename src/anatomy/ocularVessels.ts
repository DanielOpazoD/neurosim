/**
 * Grafo vascular retrobulbar del ojo — misma interfaz `Vessel` que el
 * polígono de Willis, construido en coordenadas del paciente vía
 * `fromEyeLocal`, para que el Doppler color y el PW usen la misma cadena
 * (`VesselScene`, DEC-46).
 *
 * Calibres y velocidades según Doppler color orbitario (Lieb 1991,
 * `lieb-orbital-doppler`): ACR 10/3 cm/s, VCR ~8 cm/s (venosa, plana),
 * AO 35/8, VOS ~6 (venosa), ciliares posteriores 12/4. El flujo Q se
 * deriva de la velocidad con la misma relación que Willis:
 * Q = v̄·πr²·0,6 (ver `velocityForFlow`).
 *
 * LIM-26: tubos de radio constante, venas sin pulsatilidad, trayecto de la
 * AO estilizado (cruza sobre el nervio ~15 mm retroglobo).
 */
import type { Vec3 } from '../core/vec3';
import type { Side } from '../domain/contracts';
import type { Vessel } from './head';
import { smoothPolyline } from './willis';
import { fromEyeLocal, nerveCenterline, type EyeGeometry } from './eye';

/** Geometría del ojo antes de insertar el grafo vascular (se construye tras el marco). */
type EyeBase = Omit<EyeGeometry, 'vessels'>;

/** Factor de `velocityForFlow` (Willis): Q[ml/min] = v̄[cm/s]·π·r²·0,6. */
const FLOW_FACTOR = 0.6;

function mkVessel(
  id: string,
  side: Side,
  controlLocal: readonly Vec3[],
  radiusMm: number,
  meanCms: number,
  psvCms: number,
  edvCms: number,
  eye: EyeBase,
  venous = false,
  stepMm = 0.5,
): Vessel {
  const controlPoints = controlLocal.map((p) => fromEyeLocal(eye, p));
  const points = smoothPolyline(controlPoints, stepMm);
  // Los vasos oculares son submilimétricos: el AABB se infla 1,5 mm sobre el
  // radio para que el Doppler (caja color, selección de vaso dominante) vea
  // celdas/puertas cercanas aunque su centro caiga fuera del tubo. El rechazo
  // sigue siendo exacto: solo se amplía la región donde se mide distancia real.
  const pad = radiusMm + 1.5;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i]! - pad < min[i]!) min[i] = p[i]! - pad;
      if (p[i]! + pad > max[i]!) max[i] = p[i]! + pad;
    }
  }
  return {
    id,
    side,
    points,
    controlPoints,
    radiusMm,
    aabb: { min, max },
    flowSign: 1,
    flowMlMin: meanCms * Math.PI * radiusMm * radiusMm * FLOW_FACTOR,
    meanCms,
    psvCms,
    edvCms,
    ...(venous ? { venous: true } : {}),
  };
}

/**
 * Trayecto intraneural de los vasos retinianos centrales: siguen la línea
 * central del nervio con un desplazamiento fijo en la sección
 * (`inPlane` de `nerveSection`), desde s=12 hasta s=0 y 0,5 mm dentro de la
 * papila (s=−0,5). `flowPosterior` ordena los puntos en el sentido del flujo
 * (VCR drena hacia el ápex: s ascendente; la ACR fluye al globo: s descendente).
 */
function retinalControls(eye: EyeBase, ox: number, oy: number, flowPosterior: boolean): Vec3[] {
  const ss: number[] = [];
  for (let s = -0.5; s <= 12.001; s += 1) ss.push(s);
  const controls = ss.map((s): Vec3 => {
    const c = nerveCenterline(eye, s);
    return [c[0] + ox, c[1] + oy, c[2]];
  });
  return flowPosterior ? controls : controls.reverse();
}

/** Construye los 6 vasos retrobulbares del ojo (ACR, VCR, AO, VOS, 2 ACP). */
export function buildOcularVessels(eye: EyeBase): Vessel[] {
  const R = eye.globeRadiusMm;
  const side = eye.side;
  const suffix = side === 'der' ? 'der' : 'izq';
  return [
    // Arteria central de la retina: hacia el globo (s=12 → papila), 10/3 cm/s.
    mkVessel(`acr-${suffix}`, side, retinalControls(eye, 0.35, -0.2, false), 0.18, 5.5, 10, 3, eye),
    // Vena central de la retina: paralela, flujo posterior, ~8 cm/s estacionario.
    mkVessel(`vcr-${suffix}`, side, retinalControls(eye, -0.35, 0.2, true), 0.2, 8, 8, 8, eye, true),
    // Arteria oftálmica: del ápex, inferolateral al nervio, cruza superior a
    // ~15 mm retroglobo y termina nasal; flujo anterior, 35/8 cm/s.
    mkVessel(
      `ao-${suffix}`,
      side,
      [
        [-1.5, -0.5, -(R + 40)],
        [-6, -3, -(R + 28)],
        [0, 6, -(R + 15)],
        [-8, 6, -(R + 8)],
        [-12, 6, -(R + 4)],
      ],
      0.7,
      17,
      35,
      8,
      eye,
    ),
    // Vena oftálmica superior: superomedial al nervio, drena al ápex; ~6 cm/s.
    mkVessel(
      `vos-${suffix}`,
      side,
      [
        [4, 9, -(R + 2)],
        [2, 8, -(R + 15)],
        [-1, 5, -(R + 40)],
      ],
      1.0,
      6,
      6,
      6,
      eye,
      true,
    ),
    // Ciliares posteriores superior e inferior: cortas, alcanzan la pared.
    mkVessel(
      `acp-sup-${suffix}`,
      side,
      [
        [3, -1, -(R + 10)],
        [4, -1.5, -(R - 0.5)],
      ],
      0.3,
      7,
      12,
      4,
      eye,
      false,
      0.25,
    ),
    mkVessel(
      `acp-inf-${suffix}`,
      side,
      [
        [-3, 1, -(R + 10)],
        [-4, 1.5, -(R - 0.5)],
      ],
      0.3,
      7,
      12,
      4,
      eye,
      false,
      0.25,
    ),
  ];
}
