/**
 * Solicitud y ejecución pura de render B-mode/color para un caso reproducible.
 * No accede al DOM; el entry del worker y el fallback síncrono lo invocan aquí.
 */
import { classifyEye, type EyeGeometry } from '../anatomy/eye';
import { scatterNoise } from '../ultrasound/speckle';
import type { MaterialId } from '../anatomy/materials';
import { smoothstep, type Vec3 } from '../core/vec3';
import { butterflyLevel, classifyHead, type HeadGeometry } from '../anatomy/head';
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
import { renderBMode, type BModeFrame } from '../ultrasound/bmode';
import { buildScan, linesFor, type ScanGeometry } from '../ultrasound/probe';
import { currentPose, type PoseInput } from './poses';

export interface RenderRequest {
  readonly id: number;
  readonly seed: number;
  readonly willisVariant?: WillisVariant;
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
export function eyeScene(
  eye: EyeGeometry,
  seedLabel: string,
): { classify: (p: Vec3) => MaterialId; scatterScale: (p: Vec3) => number } {
  return {
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
export function headScene(
  head: HeadGeometry,
  seedLabel: string,
): { classify: (p: Vec3) => MaterialId; scatterScale: (p: Vec3) => number } {
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
  return {
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

export function renderCase(seed: number, willisVariant: WillisVariant = 'normal'): ReferenceCase {
  const key = `${seed}:${willisVariant}`;
  let sim = cases.get(key);
  if (!sim) {
    sim = buildReferenceCase(seed, willisVariant);
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
  };
  const pose = currentPose(sim, poseInput);
  const scan = buildScan(pose, req.settings.transducer, linesFor(req.settings.lineDensity));
  const seedLabel = `seed-${sim.patient.seed}-${req.side}`;
  const scene =
    req.station === 'ojo' ? eyeScene(sim.eyes[req.side], seedLabel) : headScene(sim.head, seedLabel);
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
