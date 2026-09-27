/**
 * Solicitud y ejecución pura de render B-mode/color para un caso reproducible.
 * No accede al DOM; el entry del worker y el fallback síncrono lo invocan aquí.
 */
import { classifyEye } from '../anatomy/eye';
import { classifyHead } from '../anatomy/head';
import type {
  AcquisitionSettings,
  AcquiredFrame,
  BasalPhysiology,
  Side,
  Station,
  WillisVariant,
} from '../domain/contracts';
import type { ReferenceCase } from '../domain/referenceCase';
import { renderColorDoppler } from '../doppler/color';
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
  readonly color?: {
    readonly vel: Float32Array;
    readonly pow: Float32Array;
    readonly variance: Float32Array;
    readonly w: 64;
    readonly h: 64;
  };
}

const cases = new Map<string, ReferenceCase>();

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
  const scene =
    req.station === 'ojo'
      ? { classify: (p: Parameters<typeof classifyEye>[1]) => classifyEye(sim.eyes[req.side], p) }
      : { classify: (p: Parameters<typeof classifyHead>[1]) => classifyHead(sim.head, p) };
  const bmode = renderBMode(scene, scan, req.settings, `seed-${sim.patient.seed}-${req.side}`);
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
      ? (() => {
          const [vel, pow, variance] = renderColorDoppler(
            sim.head,
            sim.flow,
            scan,
            pose,
            req.settings,
            sim.patient.seed,
            req.cardiacPhase,
            64,
            64,
            req.flowModulation,
            sim.physStateAt(req.t).hemo,
          );
          return { vel, pow, variance, w: 64 as const, h: 64 as const };
        })()
      : undefined;
  return { id: req.id, frame, bmode, scan, color };
}
