import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { createInitialState } from '../../src/app/state';
import { DebriefLog, buildDebrief, sampleProbeTrack } from '../../src/app/debrief';
import { hemodynamics } from '../../src/physiology/hemodynamics';
import type { Measurement } from '../../src/domain/contracts';
import { fromEyeLocal, nerveCenterline, trueOnsdMm } from '../../src/anatomy/eye';
import { exportPayload } from '../../src/app/exporter';
import { caseById } from '../../src/domain/cases';
import { lindegaardIndex, lindegaardInterpretation } from '../../src/doppler/measureMca';

function measurement(sim: ReturnType<typeof buildReferenceCase>, value: number, offset: number): Measurement {
  const eye = sim.eyes.der;
  const center = fromEyeLocal(eye, nerveCenterline(eye, offset));
  return {
    kind: 'dvno',
    frameTSeconds: 0,
    side: 'der',
    pointsMm: [
      center,
      fromEyeLocal(eye, [
        nerveCenterline(eye, offset)[0],
        nerveCenterline(eye, offset)[1] + 2,
        nerveCenterline(eye, offset)[2],
      ]),
    ],
    value,
    unit: 'mm',
    referenceOffsetMm: offset,
  };
}

describe('debriefing docente', () => {
  it.each(['vasoespasmo', 'estenosisM1'] as const)('no diagnostica por cociente aislado en %s', (caseId) => {
    const sim = buildReferenceCase(undefined, 'normal', caseById(caseId));
    const s = createInitialState();
    s.debrief.record('freeze', 'congelar', {
      frozen: true,
      side: 'izq',
      mcaTaMaxCms: 40,
      icaTaMaxCms: 5,
      lindegaardSource: 'medida',
      lindegaard: 8,
      lindegaardMedido: 8,
    });
    const report = buildDebrief(s.debrief, sim, s, sim.physStateAt(0).hemo);
    const finding = report.findings.find((f) => f.code === 'lindegaard-contextual');
    expect(finding?.text).toContain(lindegaardInterpretation(lindegaardIndex(40, 5, 45)));
    expect(JSON.stringify(report)).not.toContain('vasoespasmo probable');
    expect(JSON.stringify(report)).not.toContain('vasoespasmo grave');
    if (caseId === 'estenosisM1') expect(JSON.stringify(finding)).toContain('estenosis focal');
  });

  it('exporta la interpretación de la última captura sin rescatar razones obsoletas', () => {
    const sim = buildReferenceCase();
    const s = createInitialState();
    s.debrief.record('freeze', 'congelar', {
      frozen: true,
      side: 'der',
      mcaTaMaxCms: 180,
      icaTaMaxCms: 45,
      lindegaardSource: 'medida',
      lindegaard: 4,
    });
    expect(exportPayload(sim, s)).toMatchObject({
      lindegaard: 4,
      lindegaardDetalle: {
        estado: 'leve-moderado',
        interpretacion: lindegaardInterpretation(lindegaardIndex(180, 45, 45)),
        mcaTaMaxCms: 180,
        icaTaMaxCms: 45,
        lado: 'der',
      },
    });
    s.debrief.record('freeze', 'reanudar', { frozen: false });
    expect(exportPayload(sim, s)).toMatchObject({ lindegaard: 4 });
    s.debrief.record('freeze', 'congelar', {
      frozen: true,
      side: 'izq',
      mcaTaMaxCms: 40,
      icaTaMaxCms: 0,
      lindegaardSource: 'medida',
      lindegaard: Number.NaN,
    });
    expect(exportPayload(sim, s)).toMatchObject({
      lindegaard: null,
      lindegaardDetalle: { estado: 'no-interpretable' },
    });
    s.debrief.record('freeze', 'congelar sin medida', { frozen: true });
    expect(exportPayload(sim, s)).toMatchObject({
      lindegaard: null,
      lindegaardDetalle: { estado: 'sin-captura' },
    });
  });

  it('detecta errores cuantitativos y protocolo incompleto', () => {
    const sim = buildReferenceCase();
    const s = createInitialState();
    s.measurements = [measurement(sim, 5.4, 5.5)];
    s.onsdActive = true;
    const log = new DebriefLog(0);
    log.record('protocol', 'inicio', { started: true });
    log.record('measurement', 'DVNO', { kind: 'dvno', gainDb: 10, realDeg: 70 });
    const report = buildDebrief(log, sim, s, hemodynamics({ mapMmHg: 90, paco2MmHg: 40, icpMmHg: 10 }));
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['dvno-error', 'dvno-fuera-de-3mm', 'angulo-alto', 'protocolo-incompleto']),
    );
  });

  it('es determinista y un escenario limpio no tiene errores', () => {
    const sim = buildReferenceCase();
    const s = createInitialState();
    s.measurements = [measurement(sim, trueOnsdMm(sim.eyes.der, 3, 'interno'), 3)];
    const log = new DebriefLog(2);
    log.record('station', 'ojo der', { station: 'ojo' });
    const hemo = hemodynamics({ mapMmHg: 90, paco2MmHg: 40, icpMmHg: 10 });
    expect(buildDebrief(log, sim, s, hemo)).toEqual(buildDebrief(log, sim, s, hemo));
    expect(
      buildDebrief(log, sim, s, hemo).findings.filter((finding) => finding.severity === 'error'),
    ).toHaveLength(0);
    expect(JSON.stringify(exportPayload(sim, s))).not.toContain('"truth"');
  });

  it('acumula la trayectoria de la sonda y la reporta en el debriefing', () => {
    const sim = buildReferenceCase();
    const s = createInitialState();
    const log = new DebriefLog(0);
    log.record('station', 'ojo der', { station: 'ojo' });
    sampleProbeTrack(s, 0); // primera muestra: solo siembra la pose
    s.tiltDeg = 10;
    s.offsetMm = 4;
    sampleProbeTrack(s, 0.25);
    s.tiltDeg = 20;
    sampleProbeTrack(s, 0.5);
    sampleProbeTrack(s, 1.0); // sin cambio de pose: no suma camino ni movimiento
    expect(s.probeTrack.angularDeg).toBeCloseTo(20);
    expect(s.probeTrack.lateralMm).toBeCloseTo(4);
    expect(s.probeTrack.movingS).toBeCloseTo(0.5);
    expect(s.probeTrack.samples).toBe(4);
    const report = buildDebrief(log, sim, s, hemodynamics({ mapMmHg: 90, paco2MmHg: 40, icpMmHg: 10 }));
    expect(report.probe.angularDeg).toBeCloseTo(20);
    expect(report.probe.lateralMm).toBeCloseTo(4);
    expect(report.probe.movingS).toBeCloseTo(0.5);
    expect(report.probe.tToFirstMeasureS).toBeNull();
    log.record('measurement', 'DVNO', { kind: 'dvno' });
    // El log fija t relativo a su origen; el primer evento fue en t=0.
    expect(
      buildDebrief(log, sim, s, hemodynamics({ mapMmHg: 90, paco2MmHg: 40, icpMmHg: 10 })).probe
        .tToFirstMeasureS,
    ).not.toBeNull();
    const exported = JSON.stringify(exportPayload(sim, s));
    expect(exported).toContain('"angularDeg"');
    expect(exported).not.toContain('"last"'); // la pose previa es estado interno
  });
});
