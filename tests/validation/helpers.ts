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
import { createInitialState, type AppState } from '../../src/app/state';
import { defaultSubmandibularSettings } from '../../src/domain/settings';
import { PwController } from '../../src/app/pwController';
import { currentPose } from '../../src/app/poses';
import { dopplerSceneFor } from '../../src/app/renderRequest';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import { measureBeats, observedTrace, summarizeBeats } from '../../src/doppler/measureMca';
import { insonationAngles, type InsonationAngles } from '../../src/doppler/insonation';
import type { GateComposition } from '../../src/doppler/sampleVolume';

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

/** Estado de la app en la ventana submandibular por defecto (DEC-58): puerta a 45 mm. */
export function submandibularState(sim: ReferenceCase, side: Side): AppState {
  const s = createInitialState();
  s.station = 'submandibular';
  s.side = side;
  s.settings = defaultSubmandibularSettings();
  s.handMotion = false;
  s.pwOn = true;
  s.gateDepthMm = 45;
  s.gateUMm = 0;
  return s;
}

/**
 * PW de `seconds` s con la puerta/equipo que construiría la app para el
 * estado `s` (geometría de `PwController.gateGeometry`), sin temblor de mano.
 */
export function measureIcaWithChain(
  sim: ReferenceCase,
  s: AppState,
  seconds: number,
): {
  summary: ReturnType<typeof summarizeBeats>;
  composition: GateComposition;
  angle: InsonationAngles;
} {
  const pw = new PwController(sim, s);
  const pose = currentPose(sim, s);
  const gate = pw.gateGeometry(pose);
  const scene = dopplerSceneFor(sim, s.station, s.side);
  const angle = insonationAngles(scene, gate.center, gate.beamDir, gate.lateral, gate.elevation);
  const chain = new PwDopplerChain(scene, sim.patient.seed);
  chain.setGate(gate);
  const f0Hz = s.settings.frequencyMhz * 1e6;
  chain.begin(
    s.settings.prfHz,
    f0Hz,
    s.settings.dopplerGainDb,
    s.settings.wallFilterHz,
    0,
    10 ** (s.settings.outputPowerDb / 20),
  );
  let t = 0;
  while (t < seconds - 1e-9) {
    chain.step(
      (tt) => sim.physStateAt(tt),
      t,
      () => [0, 0, 0],
      0.064,
    );
    chain.flush();
    t += 0.064;
  }
  const trace = observedTrace(chain.spectral.columns, {
    f0Hz,
    angleCorrectionRad: 0,
    invert: false,
    fftSize: chain.spectral.fftSize,
    wallFilterHz: s.settings.wallFilterHz,
  });
  const beats = sim.cardiac.beatsIn(trace[0]!.t, trace.at(-1)!.t);
  return {
    summary: summarizeBeats(measureBeats(trace, beats)),
    composition: { ...chain.sampleVolume.lastComposition },
    angle,
  };
}
