/**
 * Doppler ocular N4: grafo vascular retrobulbar (`Vessel` compartido con
 * Willis), color por caja y PW sobre la ACR. Valores de referencia:
 * `lieb-orbital-doppler` (ACR 10/3, AO 35/8 cm/s).
 */
import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { defaultEyeSettings } from '../../src/domain/settings';
import { classifyEye } from '../../src/anatomy/eye';
import { vesselVelocityCms } from '../../src/physiology/flow';
import { CerebralFlow } from '../../src/physiology/flow';
import { renderColorDoppler } from '../../src/doppler/color';
import { insonationAngles } from '../../src/doppler/insonation';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import { observedTrace, measureBeats, summarizeBeats } from '../../src/doppler/measureMca';
import { eyeDopplerScene } from '../../src/app/renderRequest';
import { buildScan, imageToPatient } from '../../src/ultrasound/probe';
import { vesselDistance } from '../../src/anatomy/head';
import { eyePose } from './helpers';
import type { Vec3 } from '../../src/core/vec3';
import type { GateGeometry } from '../../src/doppler/sampleVolume';

const sim = buildReferenceCase();
const scene = eyeDopplerScene(sim.eyes.der);

describe('grafo vascular ocular', () => {
  it('cada ojo expone 6 vasos con velocidades finitas', () => {
    for (const side of ['der', 'izq'] as const) {
      const vessels = sim.eyes[side].vessels;
      expect(vessels.length).toBe(6);
      for (const v of vessels) {
        for (const phase of [0, 0.2, 0.5, 0.9]) {
          expect(Number.isFinite(vesselVelocityCms(v, phase))).toBe(true);
        }
      }
      const ids = vessels.map((v) => v.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          `acr-${side}`,
          `vcr-${side}`,
          `ao-${side}`,
          `vos-${side}`,
          `acp-sup-${side}`,
          `acp-inf-${side}`,
        ]),
      );
    }
  });

  it('ACR PSV ≈ 10 cm/s y AO PSV ≈ 35 cm/s', () => {
    const acr = sim.eyes.der.vessels.find((v) => v.id === 'acr-der')!;
    const ao = sim.eyes.der.vessels.find((v) => v.id === 'ao-der')!;
    expect(acr.psvCms).toBeCloseTo(10, 1);
    expect(acr.edvCms).toBeCloseTo(3, 1);
    expect(ao.psvCms).toBeCloseTo(35, 1);
    // La VCR es venosa: velocidad plana, sin pulsatilidad.
    const vcr = sim.eyes.der.vessels.find((v) => v.id === 'vcr-der')!;
    expect(vcr.venous).toBe(true);
    expect(vesselVelocityCms(vcr, 0)).toBeCloseTo(vesselVelocityCms(vcr, 0.25), 6);
  });
});

describe('clasificación vascular ocular', () => {
  const acr = sim.eyes.der.vessels.find((v) => v.id === 'acr-der')!;
  const mid = acr.points[Math.floor(acr.points.length / 2)]!;

  it('el eje de la ACR es vaso', () => {
    expect(classifyEye(sim.eyes.der, mid)).toBe('vaso');
  });

  it('1 mm lateral a la ACR (lejos de la VCR) es nervioOptico', () => {
    // ACR offset (+0,35; −0,2) vs VCR (−0,35; +0,2): la normal alejada de la
    // VCR en la sección del nervio es aprox. (0,87, −0,5) en local = paciente
    // para el ojo derecho (temporal = +x).
    const off: Vec3 = [mid[0] + 0.87, mid[1] - 0.5, mid[2]];
    expect(classifyEye(sim.eyes.der, off)).toBe('nervioOptico');
  });
});

describe('color Doppler ocular', () => {
  const settings = defaultEyeSettings();
  const pose = eyePose(sim, 'der');
  const scan = buildScan(pose, 'linear', 64);
  const grid = renderColorDoppler(
    scene,
    new CerebralFlow(scene, sim.patient.physiology),
    scan,
    pose,
    settings,
    sim.patient.seed,
    0.2, // sístole
    settings.colorBox,
  );

  it('la caja retrobulbar produce al menos 20 celdas con velocidad finita', () => {
    const finite = Array.from(grid.vel).filter((v) => Number.isFinite(v)).length;
    expect(finite).toBeGreaterThanOrEqual(20);
  });

  it('ACR positiva (hacia la sonda) y VCR negativa en la misma caja', () => {
    // Celdas cuyo centro cae a ≤0,6 mm de la superficie del vaso: la ACR y la
    // VCR son submilimétricas y no todas las columnas las intersectan.
    const cellVelocitiesNear = (vesselId: string): number[] => {
      const v = scene.vessels.find((x) => x.id === vesselId)!;
      const out: number[] = [];
      const box = grid.box;
      for (let zi = 0; zi < grid.rows; zi++) {
        for (let ci = 0; ci < grid.cols; ci++) {
          const vel = grid.vel[zi * grid.cols + ci]!;
          if (!Number.isFinite(vel)) continue;
          const u = box.uCenter + ((ci + 0.5) / grid.cols - 0.5) * box.uHalf * 2;
          const z = box.zMinMm + ((zi + 0.5) / grid.rows) * (box.zMaxMm - box.zMinMm);
          if (vesselDistance(v, imageToPatient(pose, 'linear', u, z)) <= 0.6) out.push(vel);
        }
      }
      return out;
    };
    const acr = cellVelocitiesNear('acr-der');
    const vcr = cellVelocitiesNear('vcr-der');
    expect(acr.length).toBeGreaterThan(0);
    expect(vcr.length).toBeGreaterThan(0);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(acr)).toBeGreaterThan(0); // flujo hacia la sonda (al globo)
    expect(mean(vcr)).toBeLessThan(0); // drenaje posterior
  });
});

describe('PW ocular sobre la ACR', () => {
  it('mide PSV dentro del 30 % de 10 cm/s con ángulo casi nulo', () => {
    const acr = sim.eyes.der.vessels.find((v) => v.id === 'acr-der')!;
    const center = acr.points[Math.floor(acr.points.length / 2)]!;
    // Haz lineal mirando posterior (−z): la ACR corre a lo largo del haz.
    const beamDir: Vec3 = [0, 0, -1];
    const gate: GateGeometry = {
      center,
      beamDir,
      lateral: [1, 0, 0],
      elevation: [0, 1, 0],
      lengthMm: 0.8,
      lateralSigmaMm: 0.5,
      elevationSigmaMm: 0.6,
      pulseSigmaMm: 0.25,
      apertureAngleSigmaRad: 0.04,
      transmission: 0.9,
    };
    const angle = insonationAngles(scene, center, beamDir, gate.lateral, gate.elevation);
    expect(angle.vesselId).toBe('acr-der');
    expect(angle.realDeg).toBeLessThan(20);

    const chain = new PwDopplerChain(scene, sim.patient.seed);
    chain.setGate(gate);
    chain.begin(4000, 10e6, 20, 50, 0);
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
    expect(chain.spectral.columns.length).toBeGreaterThan(50);
    const trace = observedTrace(chain.spectral.columns, {
      f0Hz: 10e6,
      angleCorrectionRad: 0,
      invert: false,
      fftSize: chain.spectral.fftSize,
      wallFilterHz: 50,
    });
    const beats = sim.cardiac.beatsIn(trace[0]!.t, trace[trace.length - 1]!.t);
    const s = summarizeBeats(measureBeats(trace, beats));
    expect(s).not.toBeNull();
    expect(Math.abs(s!.psvCms)).toBeGreaterThan(7);
    expect(Math.abs(s!.psvCms)).toBeLessThan(13);
  });
});
