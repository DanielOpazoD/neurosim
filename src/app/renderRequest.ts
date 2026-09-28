/**
 * Solicitud y ejecución pura de render B-mode/color para un caso reproducible.
 * No accede al DOM; el entry del worker y el fallback síncrono lo invocan aquí.
 */
import { classifyEye, fromEyeLocal, toEyeLocal, type EyeGeometry } from '../anatomy/eye';
import { ANATOMIA_OJO } from '../anatomy/params';
import { scatterNoise } from '../ultrasound/speckle';
import type { MaterialId } from '../anatomy/materials';
import { smoothstep, type Vec3 } from '../core/vec3';
import {
  butterflyLevel,
  classifyHead,
  insideInnerTable,
  type HeadGeometry,
  type Vessel,
} from '../anatomy/head';
import { DOPPLER } from '../doppler/params';
import { FISIOLOGIA } from '../physiology/params';
import { arterialShape } from '../physiology/flow';
import type {
  AcquisitionSettings,
  AcquiredFrame,
  BasalPhysiology,
  Side,
  Station,
  WillisVariant,
} from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import { renderColorDoppler, type ColorGrid } from '../doppler/color';
import { buildReferenceCase } from '../domain/referenceCase';
import { caseById } from '../domain/cases';
import { renderBMode, type BModeFrame } from '../ultrasound/bmode';
import { buildScan, linesFor, type ScanGeometry } from '../ultrasound/probe';
import { currentPose, type PoseInput } from './poses';

export interface RenderRequest {
  readonly id: number;
  readonly seed: number;
  readonly willisVariant?: WillisVariant;
  /** Caso clínico (`?caso=`); ausente o desconocido → 'normal'. */
  readonly caseId?: string;
  readonly side: Side;
  readonly station: Station;
  readonly settings: AcquisitionSettings;
  readonly tiltDeg: number;
  readonly offsetMm: number;
  readonly rotDeg?: number;
  readonly press?: number;
  readonly t: number;
  readonly cardiacPhase: number;
  readonly respiratoryPhase: number;
  readonly handMotion?: boolean;
  readonly flowModulation: number;
  readonly physiology?: BasalPhysiology;
  readonly color: boolean;
}

export interface RenderResponse {
  readonly id: number;
  readonly frame: AcquiredFrame;
  readonly bmode: BModeFrame;
  readonly scan: ScanGeometry;
  readonly color?: ColorGrid;
}

const cases = new Map<string, ReferenceCase>();

/**
 * Escena ocular completa: clasificación anatómica + septos fibrosos dentro
 * de la grasa (ruido 3 mm) y modulación de la amplitud de speckle graso.
 */
/** Media de `arterialShape` sobre el ciclo (64 muestras) — desplazamientos de media cero. */
const ARTERIAL_SHAPE_MEAN = (() => {
  let acc = 0;
  for (let i = 0; i < 64; i++) acc += arterialShape(i / 64);
  return acc / 64;
})();

export interface EyeMotion {
  readonly press?: number;
  readonly cardiacPhase?: number;
}

export function eyeScene(
  eye: EyeGeometry,
  seedLabel: string,
  motion?: EyeMotion,
): { classify: (p: Vec3) => MaterialId; scatterScale: (p: Vec3) => number; warp?: (p: Vec3) => Vec3 } {
  const press = motion?.press ?? 0;
  const cardiacPhase = motion?.cardiacPhase ?? 0;
  const warp = motion
    ? (p: Vec3): Vec3 => {
        const l = toEyeLocal(eye, p);
        // Micropulsación cardíaca del globo: u = +z·0,05·(forma−media).
        let z = l[2] - 0.05 * (arterialShape(cardiacPhase) - ARTERIAL_SHAPE_MEAN);
        // Presión de contacto: empuje posterior −1,6·press·smoothstep (nada
        // se mueve tras z < −0,5·R → el espacio retrobulbar y la DVNO son
        // invariantes a la presión).
        // La cara del tejido no se despega de la sonda: el empuje se acota
        // para no muestrear aire (α≈125 dB/cm a 10 MHz ahogaría el fotograma);
        // el exceso se convierte en una banda de gel/párpado comprimida.
        const zContact =
          eye.globeRadiusMm +
          ANATOMIA_OJO.params.eyelidAnteriorMm.value +
          ANATOMIA_OJO.params.eyelidAirGapMm.value;
        z += Math.min(
          1.6 * press * smoothstep(-0.5 * eye.globeRadiusMm, eye.globeRadiusMm + 4, l[2]),
          Math.max(0, zContact - l[2]),
        );
        const q: Vec3 = [l[0], l[1], z];
        // Aplanamiento del globo: ecuador ×(1+0,05·press), eje ×(1−0,05·press)
        // — en espacio material el muestreo divide, así el globo renderizado
        // se aplana (el polo posterior retrocede y el anterior se hunde).
        const d = Math.hypot(l[0], l[1], l[2]);
        if (d < eye.globeRadiusMm + 0.3 && press > 0) {
          const sxz = 1 + 0.05 * press;
          const szz = 1 - 0.05 * press;
          q[0] /= sxz;
          q[1] /= sxz;
          q[2] /= szz;
        }
        if (l[2] <= zContact) q[2] = Math.min(q[2], zContact);
        return fromEyeLocal(eye, q);
      }
    : undefined;
  return {
    warp,
    classify: (p: Vec3): MaterialId => {
      const id = classifyEye(eye, p);
      return id === 'grasaOrbitaria' && scatterNoise(`${seedLabel}:septa2`, p, 3) > 0.72
        ? 'septoOrbitario'
        : id;
    },
    scatterScale: (p: Vec3): number =>
      classifyEye(eye, p) === 'grasaOrbitaria'
        ? 0.75 + 0.5 * (0.5 + 0.5 * scatterNoise(`${seedLabel}:septa`, p, 2))
        : 1,
  };
}

/**
 * Escena transcraneal: clasificación de la cabeza + modulación del speckle —
 * cisternas más brillantes pegadas al borde del mesencéfalo y parénquima
 * (sustancia blanca/corteza) con heterogeneidad suave de 2,5 mm.
 */
export interface HeadMotion {
  readonly cardiacPhase: number;
  readonly respiratoryPhase: number;
  readonly heartRateBpm?: number;
}

/** ¿p cae en la AABB del vaso inflada `padMm` mm? */
function inInflatedAabb(v: Vessel, p: Vec3, padMm: number): boolean {
  const { min, max } = v.aabb;
  return (
    p[0] >= min[0] - padMm &&
    p[0] <= max[0] + padMm &&
    p[1] >= min[1] - padMm &&
    p[1] <= max[1] + padMm &&
    p[2] >= min[2] - padMm &&
    p[2] <= max[2] + padMm
  );
}

export function headScene(
  head: HeadGeometry,
  seedLabel: string,
  motion?: HeadMotion,
): { classify: (p: Vec3) => MaterialId; scatterScale: (p: Vec3) => number; warp?: (p: Vec3) => Vec3 } {
  // renderBMode llama classify y scatterScale sobre el mismo punto por
  // muestra: memoizar la última clasificación evita una pasada doble.
  let lastP: Vec3 | null = null;
  let lastId: MaterialId = 'aire';
  const classifyCached = (p: Vec3): MaterialId => {
    if (lastP && p[0] === lastP[0] && p[1] === lastP[1] && p[2] === lastP[2]) return lastId;
    lastP = p;
    lastId = classifyHead(head, p);
    return lastId;
  };
  const shapeDev = motion ? arterialShape(motion.cardiacPhase) - ARTERIAL_SHAPE_MEAN : 0;
  // Desplazamiento cerebral: pulsación sistólica uniforme + deriva
  // respiratoria, solo dentro de la tabla interna.
  const brainZ =
    DOPPLER.params.brainPulsationMm.value * shapeDev +
    (motion ? FISIOLOGIA.params.respBrainShiftMm.value * Math.sin(2 * Math.PI * motion.respiratoryPhase) : 0);
  // Excursión radial de pared arterial, mismas constantes que el clutter
  // Doppler para que ambas señales se muevan juntas.
  const wallAmp = DOPPLER.params.wallExcursionMm.value * shapeDev;
  const wallDecay = DOPPLER.params.wallMotionDecayMm.value;
  const warp = motion
    ? (p: Vec3): Vec3 => {
        // Todo el movimiento tisular ocurre dentro de la tabla interna;
        // fuera (cráneo, cuero cabelludo, aire) el warp es identidad.
        if (!insideInnerTable(head, p)) return p;
        let ux = 0;
        let uy = 0;
        let uz = brainZ;
        if (wallAmp !== 0) {
          // Vaso más próximo dentro de su AABB inflada 6 mm; distancia a la
          // línea central (no a la pared) para el vector radial.
          let best2 = Infinity;
          let bestRadius = 0;
          let cx = 0;
          let cy = 0;
          let cz = 0;
          for (const v of head.vessels) {
            if (!inInflatedAabb(v, p, 6)) continue;
            const pts = v.points;
            for (let i = 0; i + 1 < pts.length; i++) {
              const a = pts[i]!;
              const b = pts[i + 1]!;
              const abx = b[0] - a[0];
              const aby = b[1] - a[1];
              const abz = b[2] - a[2];
              const den = abx * abx + aby * aby + abz * abz;
              const t =
                den < 1e-12
                  ? 0
                  : Math.min(
                      1,
                      Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / den),
                    );
              const dx = p[0] - (a[0] + abx * t);
              const dy = p[1] - (a[1] + aby * t);
              const dz = p[2] - (a[2] + abz * t);
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < best2) {
                best2 = d2;
                bestRadius = v.radiusMm;
                cx = a[0] + abx * t;
                cy = a[1] + aby * t;
                cz = a[2] + abz * t;
              }
            }
          }
          const mag = wallAmp * Math.exp(-Math.max(0, Math.sqrt(best2) - bestRadius) / wallDecay);
          if (best2 > 1e-12 && mag !== 0) {
            const inv = 1 / Math.sqrt(best2);
            ux += (p[0] - cx) * inv * mag;
            uy += (p[1] - cy) * inv * mag;
            uz += (p[2] - cz) * inv * mag;
          }
        }
        return [p[0] - ux, p[1] - uy, p[2] - uz];
      }
    : undefined;
  return {
    warp,
    classify: classifyCached,
    scatterScale: (p: Vec3): number => {
      const id = classifyCached(p);
      if (id === 'cisterna') {
        return 1.5 - 0.8 * smoothstep(1.0, 1.45, butterflyLevel(head, p));
      }
      if (id === 'sustanciaBlanca' || id === 'tejidoCerebral') {
        return 0.85 + 0.3 * (0.5 + 0.5 * scatterNoise(`${seedLabel}:wm`, p, 2.5));
      }
      return 1;
    },
  };
}

export function renderCase(
  seed: number,
  willisVariant: WillisVariant = 'normal',
  caseId?: string,
): ReferenceCase {
  const clinicalCase = caseById(caseId);
  const key = `${seed}:${willisVariant}:${clinicalCase.id}`;
  let sim = cases.get(key);
  if (!sim) {
    sim = buildReferenceCase(seed, willisVariant, clinicalCase);
    cases.set(key, sim);
  }
  return sim;
}

export function renderRequest(req: RenderRequest, sim: ReferenceCase): RenderResponse {
  if (req.physiology) sim.setPhysiology(req.physiology);
  const poseInput: PoseInput = {
    side: req.side,
    station: req.station,
    tiltDeg: req.tiltDeg,
    offsetMm: req.offsetMm,
    rotDeg: req.rotDeg,
    press: req.press,
    tSec: req.t,
    handMotion: req.handMotion,
  };
  const pose = currentPose(sim, poseInput);
  const scan = buildScan(pose, req.settings.transducer, linesFor(req.settings.lineDensity));
  const seedLabel = `seed-${sim.patient.seed}-${req.side}`;
  const scene =
    req.station === 'ojo'
      ? eyeScene(sim.eyes[req.side], seedLabel, {
          press: req.press ?? 0,
          cardiacPhase: req.cardiacPhase,
        })
      : headScene(sim.head, seedLabel, {
          cardiacPhase: req.cardiacPhase,
          respiratoryPhase: req.respiratoryPhase,
        });
  const bmode = renderBMode(scene, scan, req.settings, seedLabel);
  const frame: AcquiredFrame = {
    tSeconds: req.t,
    geometry: {
      kind: scan.kind,
      apex: scan.apex,
      scanOrigin: scan.lines[0]!.origin,
      lateralDir: scan.lateralDir,
      axialDir: scan.axialDir,
      widthMmOrRad: scan.widthMmOrRad,
      depthMm: req.settings.depthMm,
    },
    settings: { ...req.settings },
    side: req.side,
    station: req.station,
    caseId: sim.patient.label,
    seed: sim.patient.seed,
  };
  const color =
    req.color && req.station === 'temporal'
      ? renderColorDoppler(
          sim.head,
          sim.flow,
          scan,
          pose,
          req.settings,
          sim.patient.seed,
          req.cardiacPhase,
          req.settings.colorBox,
          req.flowModulation,
          sim.physStateAt(req.t).hemo,
        )
      : undefined;
  return { id: req.id, frame, bmode, scan, color };
}
