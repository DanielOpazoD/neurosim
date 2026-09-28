/**
 * Estenosis focal de M1 (N5): radio local por arco, continuidad (R/r)² en la
 * garganta, jet en PW y turbulencia post-estenótica determinista.
 */
import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { caseById } from '../../src/domain/cases';
import { vesselRadiusAt } from '../../src/anatomy/head';
import { CerebralFlow } from '../../src/physiology/flow';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import { mmsToCms, velocityFromShiftMmS } from '../../src/core/units';
import { dist, add, scale, sub, type Vec3 } from '../../src/core/vec3';
import type { Vessel } from '../../src/anatomy/head';
import { m1Gate } from './helpers';

const sim = buildReferenceCase(undefined, 'normal', caseById('estenosisM1'));
const m1 = sim.head.vessels.find((v) => v.id === 'm1-der')!;

/** Punto sobre la línea central del vaso a un arco dado (mm). */
function pointAtS(v: Vessel, sMm: number): Vec3 {
  let acc = 0;
  for (let i = 0; i + 1 < v.points.length; i += 1) {
    const a = v.points[i]!;
    const b = v.points[i + 1]!;
    const len = dist(a, b);
    if (acc + len >= sMm) return add(a, scale(sub(b, a), (sMm - acc) / len));
    acc += len;
  }
  return [...v.points[v.points.length - 1]!] as Vec3;
}

describe('vesselRadiusAt', () => {
  it('vale el radio base lejos de la lesión y 0,5·base en la garganta', () => {
    const st = m1.stenosis!;
    expect(vesselRadiusAt(m1, st.sMm - 5 * st.lengthMm)).toBeCloseTo(m1.radiusMm, 5);
    expect(vesselRadiusAt(m1, st.sMm + 5 * st.lengthMm)).toBeCloseTo(m1.radiusMm, 5);
    expect(vesselRadiusAt(m1, st.sMm)).toBeCloseTo(0.5 * m1.radiusMm, 5);
  });
});

describe('continuidad en la garganta', () => {
  it('velocityAt en la garganta ≈ 4× la prestenótica (±15 %)', () => {
    const flow = new CerebralFlow(sim.head, sim.patient.physiology);
    const st = m1.stenosis!;
    const throat = pointAtS(m1, st.sMm);
    const pre = pointAtS(m1, st.sMm - 8);
    const phase = 0.1; // sístole
    const mag = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
    const ratio = mag(flow.velocityAt(throat, phase)) / mag(flow.velocityAt(pre, phase));
    expect(ratio).toBeGreaterThan(4 * 0.85);
    expect(ratio).toBeLessThan(4 * 1.15);
  });
});

function runPwGate(sMm: number): { psvCms: number; widthCms: number } {
  const gate = m1Gate(sim, pointAtS(m1, sMm));
  // Puerta focal: el jet ocupa ~2 mm alrededor de la garganta; una puerta de
  // 6 mm diluye su potencia bajo el umbral del trazador.
  const chain = new PwDopplerChain(sim.head, sim.patient.seed);
  chain.setGate({ ...gate, lengthMm: 3, lateralSigmaMm: 1.5 });
  const prfHz = 24000;
  chain.begin(prfHz, 2e6, 20, 100, 0);
  let t = 0;
  for (let i = 0; i < 94; i++) {
    chain.step(
      (tt) => sim.physStateAt(tt),
      t,
      () => [0, 0, 0],
      0.064,
    );
    chain.flush();
    t += 0.064;
  }
  // Borde de banda espectral: máxima |f| cuya potencia ≥ 10 % del pico de la
  // columna (el jet llena pocos bins; el trazador de envolvente lo pierde).
  let psvCms = 0;
  for (const col of chain.spectral.columns) {
    const power = Float64Array.from(col.powerDb, (db) => Math.pow(10, db / 10));
    let pMax = 0;
    for (const p of power) pMax = Math.max(pMax, p);
    for (let k = 0; k < power.length; k += 1) {
      if (power[k]! >= 0.1 * pMax) {
        const v = Math.abs(mmsToCms(velocityFromShiftMmS(chain.spectral.binFrequency(k, prfHz), 2e6, 0)));
        psvCms = Math.max(psvCms, v);
      }
    }
  }
  // Ancho espectral: RMS de la potencia alrededor de la mediana, por columna,
  // promediado en las columnas sistólicas.
  let widthSum = 0;
  let widthN = 0;
  for (const col of chain.spectral.columns) {
    const power = Float64Array.from(col.powerDb, (db) => Math.pow(10, db / 10));
    let pMax = 0;
    for (const p of power) pMax = Math.max(pMax, p);
    // Centroide y dispersión solo sobre bins ≥ 5 % del pico (banda significativa).
    let cen = 0;
    let wSum = 0;
    for (let i = 0; i < power.length; i += 1) {
      if (power[i]! >= 0.05 * pMax) {
        cen += i * power[i]!;
        wSum += power[i]!;
      }
    }
    if (wSum === 0) continue;
    cen /= wSum;
    let varSum = 0;
    for (let i = 0; i < power.length; i += 1) {
      if (power[i]! >= 0.05 * pMax) varSum += (i - cen) ** 2 * power[i]!;
    }
    widthSum += Math.sqrt(varSum / wSum);
    widthN += 1;
  }
  return { psvCms, widthCms: widthSum / Math.max(1, widthN) };
}

describe('PW sobre la estenosis de M1', () => {
  it('el jet en la garganta da PSV ≥ 2,5× la puerta 8 mm proximal', () => {
    const throat = runPwGate(m1.stenosis!.sMm);
    const pre = runPwGate(m1.stenosis!.sMm - 8);
    expect(pre.psvCms).toBeGreaterThan(20);
    expect(throat.psvCms).toBeGreaterThan(pre.psvCms * 2.5);
  });

  it('el ancho espectral post-estenótico ≥ 1,5× el prestenótico', () => {
    const post = runPwGate(m1.stenosis!.sMm + 2 * m1.stenosis!.lengthMm);
    const pre = runPwGate(m1.stenosis!.sMm - 8);
    expect(post.widthCms).toBeGreaterThan(pre.widthCms * 1.5);
  });
});
