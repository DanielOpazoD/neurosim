import { describe, expect, it } from 'vitest';
import { onsdForIcpMm } from '../../src/physiology/hemodynamics';
import {
  addProtocolMeasurement,
  buildReport,
  createOnsdProtocolState,
  nextSlot,
  planeForRotation,
  type OnsdProtocolState,
} from '../../src/domain/onsdProtocol';
import type { Measurement } from '../../src/domain/contracts';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { caliperDistanceMm } from '../../src/domain/measure';
import { defaultEyeSettings } from '../../src/domain/settings';
import { buildScan, patientToImage } from '../../src/ultrasound/probe';
import { frameFromScan } from './helpers';
import { fromEyeLocal, nerveCenterline, sheathRadiiAt, trueOnsdMm } from '../../src/anatomy/eye';
import { eyePose as appEyePose } from '../../src/app/poses';

const measurement = (
  side: 'der' | 'izq',
  value: number,
  kind: Measurement['kind'] = 'dvno',
): Measurement => ({
  kind,
  frameTSeconds: 0,
  side,
  pointsMm: [],
  value,
  unit: 'mm',
});

describe('protocolo DVNO 2×2 + DTE', () => {
  it('determina el plano por la rotación del marcador', () => {
    expect(planeForRotation(0)).toBe('transversal');
    expect(planeForRotation(90)).toBe('sagital');
    expect(planeForRotation(180)).toBe('transversal');
    expect(planeForRotation(-80)).toBe('sagital');
    expect(planeForRotation(44)).toBe('transversal');
    expect(planeForRotation(46)).toBe('sagital');
  });

  it('recorre los cuatro slots y sobreescribe de forma inmutable', () => {
    let state = createOnsdProtocolState();
    expect(nextSlot(state)).toEqual({ side: 'der', plane: 'transversal' });
    state = addProtocolMeasurement(state, nextSlot(state)!, measurement('der', 4.6));
    state = addProtocolMeasurement(state, nextSlot(state)!, measurement('der', 4.7));
    state = addProtocolMeasurement(state, nextSlot(state)!, measurement('izq', 4.6));
    state = addProtocolMeasurement(state, nextSlot(state)!, measurement('izq', 4.7));
    expect(nextSlot(state)).toBeNull();
    const replaced = addProtocolMeasurement(
      state,
      { side: 'der', plane: 'transversal' },
      measurement('der', 5),
    );
    expect(Object.keys(replaced.dvno)).toHaveLength(4);
    expect(replaced.dvno['der-transversal']?.value).toBe(5);
  });

  it('construye el informe N1 y marca PIC elevada', () => {
    const fill = (values: [number, number, number, number], dte = 23): OnsdProtocolState => {
      let state = createOnsdProtocolState();
      for (const [slot, value] of state.slots.map((slot, i) => [slot, values[i]!] as const))
        state = addProtocolMeasurement(state, slot, measurement(slot.side, value));
      return { ...state, dte: { der: measurement('der', dte, 'dte'), izq: measurement('izq', dte, 'dte') } };
    };
    const normal = buildReport(fill([4.6, 4.6, 4.7, 4.7]));
    expect(normal.complete).toBe(true);
    expect(normal.flags).toEqual([]);
    expect(normal.bilateralMeanMm).toBeCloseTo(4.65);
    expect(normal.perSide.der.ratio).toBeCloseTo(0.2);
    expect(normal.perSide.izq.ratio).toBeCloseTo(0.2);
    expect(normal.asymmetryMm).toBeCloseTo(0.1);
    expect(buildReport(fill([onsdForIcpMm(4.6, 30), onsdForIcpMm(4.6, 30), 5.9, 5.9])).flags).toEqual([
      'dvno-elevado',
      'ratio-elevado',
    ]);
    const incomplete = fill([4.6, 4.6, 4.7, 4.7]);
    const { ['izq-sagital']: _missing, ...remainingDvno } = incomplete.dvno;
    expect(buildReport({ ...incomplete, dvno: remainingDvno }).flags).toContain('plano-incompleto');
  });

  it('mide DVNO en plano sagital y DTE transversal sobre el frame', () => {
    const sim = buildReferenceCase();
    const eye = sim.eyes.der;
    const settings = defaultEyeSettings();
    const pose = appEyePose(sim, {
      side: 'der',
      station: 'ojo',
      tiltDeg: 0,
      offsetMm: 0,
      rotDeg: 90,
    });
    const scan = buildScan(pose, 'linear', 128);
    const frame = frameFromScan(scan, settings, 'der', 'ojo');
    const sMm = 3;
    const center = nerveCenterline(eye, sMm);
    const radii = sheathRadiiAt(eye, sMm);
    const half = radii.major - eye.duraMm;
    const a = patientToImage(pose, 'linear', fromEyeLocal(eye, [center[0], center[1] - half, center[2]]));
    const b = patientToImage(pose, 'linear', fromEyeLocal(eye, [center[0], center[1] + half, center[2]]));
    expect(Math.abs(caliperDistanceMm(frame, a, b) - trueOnsdMm(eye, sMm, 'interno'))).toBeLessThanOrEqual(
      0.4,
    );
    const transversePose = appEyePose(sim, {
      side: 'der',
      station: 'ojo',
      tiltDeg: 0,
      offsetMm: 0,
      rotDeg: 0,
    });
    const dteA = patientToImage(transversePose, 'linear', fromEyeLocal(eye, [-eye.globeRadiusMm, 0, 0]));
    const dteB = patientToImage(transversePose, 'linear', fromEyeLocal(eye, [eye.globeRadiusMm, 0, 0]));
    const transverseScan = buildScan(transversePose, 'linear', 128);
    const transverseFrame = frameFromScan(transverseScan, settings, 'der', 'ojo');
    expect(
      Math.abs(caliperDistanceMm(transverseFrame, dteA, dteB) - 2 * eye.globeRadiusMm),
    ).toBeLessThanOrEqual(0.6);
  });
});
