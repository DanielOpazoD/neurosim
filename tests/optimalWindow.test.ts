import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { caseById } from '../src/domain/cases';
import {
  clearOptimalWindowCache,
  eyeNerveTarget,
  solveOptimalWindow,
  type OptimalWindow,
} from '../src/app/optimalWindow';
import { stationPose } from '../src/app/poses';
import { dopplerSceneFor } from '../src/app/renderRequest';
import { insonationAngles } from '../src/doppler/insonation';
import { beamDirAt, elevAxis, imageToPatient, patientToImage } from '../src/ultrasound/probe';
import type { Side, Station } from '../src/domain/contracts';

const SIDES: readonly Side[] = ['der', 'izq'];
const timings: string[] = [];

function poseOf(sim: ReturnType<typeof buildReferenceCase>, w: OptimalWindow) {
  return stationPose(sim, { side: w.side, station: w.station, ...w.probe }, w.side);
}

/** Ángulo real de insonación recalculado como `PwController.insonation`. */
function gateInsonation(sim: ReturnType<typeof buildReferenceCase>, w: OptimalWindow) {
  const pose = poseOf(sim, w);
  const center = imageToPatient(pose, 'sector', w.gate!.uMm, w.gate!.depthMm);
  const beam = beamDirAt(pose, 'sector', w.gate!.uMm);
  return insonationAngles(
    dopplerSceneFor(sim, w.station, w.side),
    center,
    beam,
    pose.lateral,
    elevAxis(pose),
  );
}

/**
 * Resuelve sin caché tres veces: el presupuesto (< 150 ms) se exige al mejor
 * de los tres (coste del algoritmo, no el ruido de una máquina cargada) y se
 * informan mínimo y máximo.
 */
function timed(sim: ReturnType<typeof buildReferenceCase>, station: Station, side: Side, plane?: 'sagital') {
  const runs: number[] = [];
  let w: OptimalWindow | null = null;
  for (let i = 0; i < 3; i++) {
    clearOptimalWindowCache(sim);
    w = solveOptimalWindow(sim, station, side, { plane });
    runs.push(w.metrics.solveMs);
  }
  const m = w!.metrics;
  const extra =
    station === 'ojo'
      ? `u ${m.nerveImageUMm!.toFixed(3)} mm`
      : `vaso ${m.inPlaneLengthMm!.toFixed(1)} mm, ángulo ${m.insonationDeg?.toFixed(1)}°`;
  timings.push(
    `${sim.clinicalCase.id} ${station}${plane ? `/${plane}` : ''} ${side}: ${Math.min(...runs).toFixed(1)}–${Math.max(...runs).toFixed(1)} ms (${m.evaluations} poses; ${extra}; ${JSON.stringify(w!.probe)})`,
  );
  expect(Math.min(...runs)).toBeLessThan(150);
  return w!;
}

describe('ventana óptima (DEC-60)', () => {
  it('ojo: el nervio a 3 mm queda a ≤ 0,5 mm de la línea central (ambos ojos, normal y HIC)', () => {
    for (const caseId of ['normal', 'hic']) {
      const sim = buildReferenceCase(undefined, undefined, caseById(caseId));
      for (const side of SIDES) {
        for (const plane of [undefined, 'sagital'] as const) {
          const w = timed(sim, 'ojo', side, plane);
          const pose = poseOf(sim, w);
          const img = patientToImage(pose, 'linear', eyeNerveTarget(sim, side));
          expect(Math.abs(img.u)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(w.metrics.nerveElevationMm!)).toBeLessThanOrEqual(0.5);
          expect(w.probe.rotDeg).toBe(plane === 'sagital' ? 90 : 0);
          expect(w.probe.tiltDeg).toBe(0);
          expect(w.probe.tiltVDeg).toBe(0);
          expect(w.depthMm).toBe(45);
          // Foco a la profundidad del nervio (≈ 3 mm tras la pared del globo).
          expect(Math.abs(w.focusMm - img.z)).toBeLessThanOrEqual(0.5);
          expect(w.colorOn).toBe(false);
        }
      }
    }
  });

  it('temporal: M1 en el plano ≥ 25 mm y ángulo en la puerta ≤ 30°, ambos lados', () => {
    const sim = buildReferenceCase();
    for (const side of SIDES) {
      const w = timed(sim, 'temporal', side);
      expect(w.metrics.inPlaneLengthMm!).toBeGreaterThanOrEqual(25);
      expect(Math.abs(w.probe.tiltDeg)).toBeLessThanOrEqual(10);
      expect(Math.abs(w.probe.offsetMm)).toBeLessThanOrEqual(6);
      expect(Math.abs(w.probe.offsetVMm)).toBeLessThanOrEqual(6);
      expect(w.depthMm).toBe(90);
      expect(w.colorOn).toBe(true);
      expect(w.gate).not.toBeNull();
      const ins = gateInsonation(sim, w);
      expect(ins.vesselId).toBe(`m1-${side}`);
      expect(ins.realDeg).toBeLessThanOrEqual(30);
      expect(ins.realDeg).toBeCloseTo(w.metrics.insonationDeg!, 9);
      // La caja de color contiene la puerta.
      const box = w.colorBox!;
      expect(Math.abs(w.gate!.uMm - box.uCenter)).toBeLessThanOrEqual(box.uHalf);
      expect(w.gate!.depthMm).toBeGreaterThanOrEqual(box.zMinMm);
      expect(w.gate!.depthMm).toBeLessThanOrEqual(box.zMaxMm);
    }
  });

  it('submandibular: ángulo a la ACI ≤ 15° con ≥ 10 mm de ACI en el plano', () => {
    const sim = buildReferenceCase();
    for (const side of SIDES) {
      const w = timed(sim, 'submandibular', side);
      expect(w.metrics.inPlaneLengthMm!).toBeGreaterThanOrEqual(10);
      const ins = gateInsonation(sim, w);
      expect(ins.vesselId).toBe(`aci-${side}`);
      expect(ins.realDeg).toBeLessThanOrEqual(15);
      expect(w.colorOn).toBe(true);
      expect(w.gate!.depthMm).toBeLessThanOrEqual(w.depthMm);
    }
  });

  it('caché por (caso, estación, lado, plano): la segunda llamada devuelve el mismo objeto', () => {
    const sim = buildReferenceCase();
    const a = solveOptimalWindow(sim, 'temporal', 'der');
    expect(solveOptimalWindow(sim, 'temporal', 'der')).toBe(a);
    expect(solveOptimalWindow(sim, 'temporal', 'izq')).not.toBe(a);
    const t = solveOptimalWindow(sim, 'ojo', 'der');
    expect(solveOptimalWindow(sim, 'ojo', 'der', { plane: 'sagital' })).not.toBe(t);
    console.log(`Tiempos del solver (sin caché):\n  ${timings.join('\n  ')}`);
  });
});
