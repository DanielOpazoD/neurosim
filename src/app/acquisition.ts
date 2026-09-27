/**
 * Adquisición B-mode: clasifica la escena y construye marcos físicos.
 * No depende del DOM; recibe el reloj y el estado explícitamente.
 */
import { classifyEye } from '../anatomy/eye';
import { classifyHead } from '../anatomy/head';
import type { SimulationClock } from '../core/clock';
import type { ReferenceCase } from '../domain/referenceCase';
import type { AcquiredFrame } from '../domain/contracts';
import { renderBMode, type BModeFrame } from '../ultrasound/bmode';
import { buildScan, type ScanGeometry } from '../ultrasound/probe';
import type { AppState } from './state';
import { currentPose } from './poses';

export const LINES = 176;

export function sceneClassify(sim: ReferenceCase, s: AppState) {
  if (s.station === 'ojo') {
    const eye = sim.eyes[s.side];
    return { classify: (p: Parameters<typeof classifyEye>[1]) => classifyEye(eye, p) };
  }
  return { classify: (p: Parameters<typeof classifyHead>[1]) => classifyHead(sim.head, p) };
}

export function acquire(
  sim: ReferenceCase,
  s: AppState,
  clock: SimulationClock,
): { frame: AcquiredFrame; bmode: BModeFrame; scan: ScanGeometry } {
  const pose = currentPose(sim, s);
  const scan = buildScan(pose, s.settings.transducer, LINES);
  const scene = sceneClassify(sim, s);
  const bmode = renderBMode(scene, scan, s.settings, `seed-${sim.patient.seed}-${s.side}`);
  const frame: AcquiredFrame = {
    tSeconds: clock.t,
    geometry: {
      kind: scan.kind,
      apex: scan.apex,
      scanOrigin: scan.lines[0]!.origin,
      lateralDir: scan.lateralDir,
      axialDir: scan.axialDir,
      widthMmOrRad: scan.widthMmOrRad,
      depthMm: s.settings.depthMm,
    },
    settings: { ...s.settings },
    side: s.side,
    station: s.station,
    caseId: sim.patient.label,
    seed: sim.patient.seed,
  };
  return { frame, bmode, scan };
}
