/**
 * Lindegaard con la ACI medida (DEC-58): la hiperemia (hipercapnia) sube la
 * ACM y la ACI a la vez (índice < 3); el vasoespasmo sube solo la ACM
 * (índice ≥ 3). La ACI se mide con PW en la ventana submandibular; la TAMax
 * de la ACM es la del modelo (M1 casi alineada con el haz temporal).
 */
import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { caseById } from '../../src/domain/cases';
import { vesselVelocityCms } from '../../src/physiology/flow';
import { lindegaardIndex } from '../../src/doppler/measureMca';
import { PwController, SyncPwTransport } from '../../src/app/pwController';
import { SimulationClock } from '../../src/core/clock';
import { currentPose } from '../../src/app/poses';
import { defaultTemporalSettings } from '../../src/domain/settings';
import { patientToImage } from '../../src/ultrasound/probe';
import type { ReferenceCase } from '../../src/domain/referenceCase';
import type { Side } from '../../src/domain/contracts';
import { measureIcaWithChain, submandibularState } from './helpers';

function mcaTaMaxModel(sim: ReferenceCase, side: Side): number {
  const m1 = sim.head.vessels.find((v) => v.id === `m1-${side}`)!;
  const hemo = sim.physStateAt(0).hemo;
  let acc = 0;
  for (let i = 0; i < 400; i++) acc += vesselVelocityCms(m1, i / 400, 1, hemo) / 400;
  return acc;
}

function measuredIca(sim: ReferenceCase, side: Side): number {
  const { summary, composition } = measureIcaWithChain(sim, submandibularState(sim, side), 3);
  expect(composition.dominantVesselId).toBe(`aci-${side}`);
  expect(summary).not.toBeNull();
  return Math.abs(summary!.taMaxCms);
}

/** Avanza el controlador PW `seconds` s de tiempo real a 60 fps. */
function runPw(pw: PwController, clock: SimulationClock, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) {
    const n = clock.requestSteps(1 / 60);
    for (let k = 0; k < n; k += 1) clock.advance();
    pw.step(clock, 1 / 60);
  }
}

describe('Lindegaard con ACI medida', () => {
  it('normal < 2 e hipercapnia < 3 aunque la ACM esté elevada', () => {
    const normal = buildReferenceCase(undefined, 'normal', caseById('normal'));
    const hyper = buildReferenceCase(undefined, 'normal', caseById('hipercapnia'));
    const liNormal = lindegaardIndex(
      mcaTaMaxModel(normal, 'izq'),
      measuredIca(normal, 'izq'),
      normal.clinicalCase.icaExtracranialTamaxCms,
    );
    const liHyper = lindegaardIndex(
      mcaTaMaxModel(hyper, 'izq'),
      measuredIca(hyper, 'izq'),
      hyper.clinicalCase.icaExtracranialTamaxCms,
    );
    expect(liNormal.icaSource).toBe('medida');
    expect(liNormal.ratio).toBeLessThan(2);
    expect(liHyper.mcaTaMaxCms).toBeGreaterThan(1.5 * liNormal.mcaTaMaxCms);
    expect(liHyper.icaTaMaxCms).toBeGreaterThan(1.5 * liNormal.icaTaMaxCms);
    expect(liHyper.ratio).toBeLessThan(3);
  });

  it('vasoespasmo ≥ 3 con la ACI medida por el controlador PW (ruta de la app)', () => {
    const sim = buildReferenceCase(undefined, 'normal', caseById('vasoespasmo'));
    const s = submandibularState(sim, 'izq');
    const pw = new PwController(sim, s, new SyncPwTransport());
    let nowMs = 0;
    pw.nowMs = () => nowMs;
    const clock = new SimulationClock();
    pw.reset();
    runPw(pw, clock, 4);
    nowMs += 1000;
    expect(pw.latestMcaMeasure()).not.toBeNull();
    const ica = s.icaMeasured.izq;
    expect(ica).not.toBeNull();
    expect(ica!.vesselId).toBe('aci-izq');
    expect(ica!.taMaxCms).toBeGreaterThan(25);
    expect(ica!.taMaxCms).toBeLessThan(45);
    expect(s.icaMeasured.der).toBeNull();
    // Sin puerta en M1 (estación submandibular) no hay índice.
    expect(pw.lindegaard()).toBeNull();
    // Temporal izq con la puerta en la M1 espástica (PRF alta: PSV > 200 cm/s).
    s.station = 'temporal';
    s.settings = { ...defaultTemporalSettings(), prfHz: 16000 };
    const target = sim.head.vessels.find((v) => v.id === 'm1-izq')!.points[2]!;
    const { u, z } = patientToImage(currentPose(sim, s), 'sector', target);
    s.gateUMm = u;
    s.gateDepthMm = z;
    pw.reset();
    runPw(pw, clock, 4);
    nowMs += 1000;
    const li = pw.lindegaard();
    expect(li).not.toBeNull();
    expect(li!.icaSource).toBe('medida');
    expect(li!.icaTaMaxCms).toBeCloseTo(ica!.taMaxCms, 9);
    expect(li!.ratio).toBeGreaterThanOrEqual(3);
    // Con la ACI de referencia (sin medida) el índice cambia de origen.
    s.icaMeasured = { der: null, izq: null };
    expect(pw.lindegaard()!.icaSource).toBe('referencia');
  });
});
