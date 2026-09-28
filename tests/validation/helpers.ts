import { add, cross, normalize, scale, sub, type Vec3 } from '../../src/core/vec3';
import type {
  AcquiredFrame,
  AcquisitionSettings,
  ProbePose,
  Side,
  Station,
} from '../../src/domain/contracts';
import type { ReferenceCase } from '../../src/domain/referenceCase';
import type { GateGeometry } from '../../src/doppler/sampleVolume';
import { buildScan, type ScanGeometry } from '../../src/ultrasound/probe';

export function frameFromScan(
  scan: ScanGeometry,
  settings: AcquisitionSettings,
  side: Side,
  station: Station,
): AcquiredFrame {
  return {
    tSeconds: 0,
    geometry: {
      kind: scan.kind,
      apex: scan.apex,
      scanOrigin: scan.lines[0]!.origin,
      lateralDir: scan.lateralDir,
      axialDir: scan.axialDir,
      widthMmOrRad: scan.widthMmOrRad,
      depthMm: settings.depthMm,
    },
    settings,
    side,
    station,
    caseId: 'validation',
    seed: 0,
  };
}

export function eyePose(sim: ReferenceCase, side: Side, offsetMm = 0): ProbePose {
  const eye = sim.eyes[side];
  const anterior: Vec3 = [0, 0, 1];
  const lateral: Vec3 = [1, 0, 0];
  return {
    origin: add(eye.center, add(scale(anterior, eye.globeRadiusMm + 3.2), scale(lateral, offsetMm))),
    forward: [0, 0, -1],
    lateral,
    markerAngleRad: 0,
    contactPressure: 0,
  };
}

export function temporalPose(sim: ReferenceCase, side: Side): ProbePose {
  const wc = sim.head.windowCenter[side];
  const inward = normalize(sub(sim.head.midbrainCenter, wc));
  const up: Vec3 = [0, 1, 0];
  const lateral = normalize(cross(inward, up));
  return {
    origin: add(wc, scale(inward, -7.7)),
    forward: inward,
    lateral,
    markerAngleRad: 0,
    contactPressure: 0,
  };
}

export function eyeScanFrame(
  sim: ReferenceCase,
  settings: AcquisitionSettings,
  side: Side,
  lineCount: number,
): { pose: ProbePose; scan: ScanGeometry; frame: AcquiredFrame } {
  const pose = eyePose(sim, side);
  const scan = buildScan(pose, 'linear', lineCount);
  return { pose, scan, frame: frameFromScan(scan, settings, side, 'ojo') };
}

export function temporalScanFrame(
  sim: ReferenceCase,
  settings: AcquisitionSettings,
  side: Side,
  lineCount: number,
): { pose: ProbePose; scan: ScanGeometry; frame: AcquiredFrame } {
  const pose = temporalPose(sim, side);
  const scan = buildScan(pose, 'sector', lineCount);
  return { pose, scan, frame: frameFromScan(scan, settings, side, 'temporal') };
}

export function m1Gate(sim: ReferenceCase, target: Vec3): GateGeometry {
  const wc = sim.head.windowCenter.der;
  const beamDir = normalize(sub(target, wc));
  return {
    center: target,
    beamDir,
    lateral: normalize([-beamDir[2], 0, beamDir[0]]),
    elevation: normalize([
      beamDir[1] * beamDir[2],
      beamDir[2] * beamDir[2] + beamDir[0] * beamDir[0],
      -beamDir[1] * beamDir[0],
    ]),
    lengthMm: 6,
    lateralSigmaMm: 2.5,
    elevationSigmaMm: 5,
    pulseSigmaMm: 0.8,
    apertureAngleSigmaRad: 0.04,
    transmission: 0.5,
  };
}
