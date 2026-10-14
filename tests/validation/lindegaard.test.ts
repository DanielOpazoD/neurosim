/**
 * Lindegaard con la ACI medida (DEC-58): la hiperemia (hipercapnia) sube la
 * ACM y la ACI a la vez (índice < 3); el vasoespasmo sube solo la ACM
 * (índice ≥ 3). La primera prueba usa TAMax del modelo; la ruta del
 * controlador exige además alcance físico y señal interpretable (DEC-73).
 */
import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { caseById } from '../../src/domain/cases';
import { vesselAxialVelocityCms } from '../../src/physiology/flow';
import { lindegaardIndex } from '../../src/doppler/measureMca';
import { PwController, SyncPwTransport } from '../../src/app/pwController';
import { SimulationClock } from '../../src/core/clock';
import { currentPose } from '../../src/app/poses';
import { defaultTemporalSettings } from '../../src/domain/settings';
import { patientToImage } from '../../src/ultrasound/probe';
import type { ReferenceCase } from '../../src/domain/referenceCase';
import type { Side } from '../../src/domain/contracts';
import { measureIcaWithChain, submandibularState } from './helpers';
import { solveOptimalWindow } from '../../src/app/optimalWindow';

function mcaTaMaxModel(sim: ReferenceCase, side: Side): number {
  const m1 = sim.head.vessels.find((v) => v.id === `m1-${side}`)!;
  const hemo = sim.physStateAt(0).hemo;
  let acc = 0;
  for (let i = 0; i < 400; i++) acc += vesselAxialVelocityCms(m1, i / 400, 1, hemo) / 400;
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

  it.each(['normal', 'vasoespasmo'])('ACI→ACM con PRF factible en %s por el controlador PW', (caseId) => {
    const sim = buildReferenceCase(undefined, 'normal', caseById(caseId));
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
    // El antiguo fixture de 16 kHz a ~62 mm no es PW de rango único.
    s.station = 'temporal';
    s.settings = { ...defaultTemporalSettings(), prfHz: 16000 };
    const target = sim.head.vessels.find((v) => v.id === 'm1-izq')!.points[2]!;
    const { u, z } = patientToImage(currentPose(sim, s), 'sector', target);
    s.gateUMm = u;
    s.gateDepthMm = z;
    pw.reset();
    runPw(pw, clock, 4);
    nowMs += 1000;
    expect(pw.latestCapture()?.status).toBe('prf-inviable');
    expect(pw.lindegaard()).toBeNull();
    const w = solveOptimalWindow(sim, 'temporal', 'izq');
    Object.assign(s, w.probe);
    s.gateUMm = w.gate!.uMm;
    s.gateDepthMm = w.gate!.depthMm;
    s.settings = { ...s.settings, prfHz: 11000 };
    expect(pw.pulseTiming().status).toBe('compatible');
    pw.reset();
    runPw(pw, clock, 4);
    nowMs += 1000;
    const li = pw.lindegaard();
    if (caseId === 'vasoespasmo') {
      // Un PRF realizable no elimina el aliasing del fixture a 2 MHz.
      expect(pw.latestCapture()?.status).toBe('bidireccional');
      expect(pw.latestMcaMeasure()).toBeNull();
      expect(li).toBeNull();
      return;
    }
    expect(li).not.toBeNull();
    expect(li!.icaSource).toBe('medida');
    expect(li!.icaTaMaxCms).toBeCloseTo(ica!.taMaxCms, 9);
    expect(li!.ratio).toBeLessThan(3);
    // Una ACI contralateral mal almacenada no se transforma en referencia.
    s.icaMeasured = { ...s.icaMeasured, izq: { ...ica!, vesselId: 'aci-der' } };
    expect(pw.lindegaard()!.ratio).toBeNaN();
    expect(pw.lindegaard()!.icaSource).toBe('medida');
    // Con la ACI de referencia (sin medida) el índice cambia de origen.
    s.icaMeasured = { der: null, izq: null };
    expect(pw.lindegaard()!.icaSource).toBe('referencia');
  });
});
