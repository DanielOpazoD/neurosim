import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyEye } from '../../src/anatomy/eye';
import { classifyHead } from '../../src/anatomy/head';
import { buildReferenceCase, REFERENCE_SEED } from '../../src/domain/referenceCase';
import { defaultEyeSettings, defaultTemporalSettings } from '../../src/domain/settings';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import { renderBMode } from '../../src/ultrasound/bmode';
import { renderColorDoppler } from '../../src/doppler/color';
import { buildScan } from '../../src/ultrasound/probe';
import { eyePose, m1Gate, temporalPose } from './helpers';
import { hashBMode, hashColor, hashSpectral } from './hash';

const goldenPath = resolve(process.cwd(), 'tests/validation/golden.json');
type Goldens = { eyeDerBmode: string; temporalDerBmode: string; pwM1Point2: string; colorM1Der: string };

function eyeHash(seed: number): string {
  const sim = buildReferenceCase(seed);
  const settings = defaultEyeSettings();
  const pose = eyePose(sim, 'der');
  const frame = renderBMode(
    { classify: (p) => classifyEye(sim.eyes.der, p) },
    buildScan(pose, 'linear', 64),
    settings,
    `seed-${sim.patient.seed}-der`,
  );
  return hashBMode(frame);
}

function temporalHash(): string {
  const sim = buildReferenceCase();
  const settings = defaultTemporalSettings();
  const pose = temporalPose(sim, 'der');
  const frame = renderBMode(
    { classify: (p) => classifyHead(sim.head, p) },
    buildScan(pose, 'sector', 64),
    settings,
    `seed-${sim.patient.seed}-der`,
  );
  return hashBMode(frame);
}

function pwHash(): string {
  const sim = buildReferenceCase();
  const target = sim.head.vessels.find((v) => v.id === 'm1-der')!.points[2]!;
  const chain = new PwDopplerChain(sim.head, sim.patient.seed);
  chain.setGate(m1Gate(sim, target));
  chain.begin(6000, 2e6, 20, 100, 0);
  let t = 0;
  while (t < 1) {
    chain.step({ t, cardiacPhase: sim.cardiac.phaseAt(t), heartRateBpm: 70 }, [0, 0, 0], 0.064);
    chain.flush();
    t += 0.064;
  }
  return hashSpectral(chain.spectral.columns);
}

function colorHash(): string {
  const sim = buildReferenceCase();
  const settings = defaultTemporalSettings();
  const pose = temporalPose(sim, 'der');
  const [vel, pow] = renderColorDoppler(
    sim.head,
    sim.flow,
    buildScan(pose, 'sector', 64),
    pose,
    settings,
    sim.patient.seed,
    0.2,
    64,
    64,
  );
  return hashColor(vel, pow);
}

describe('goldens deterministas', () => {
  it('mantiene los hashes de referencia', () => {
    const values: Goldens = {
      eyeDerBmode: eyeHash(REFERENCE_SEED),
      temporalDerBmode: temporalHash(),
      pwM1Point2: pwHash(),
      colorM1Der: colorHash(),
    };
    if (process.env.GOLDEN_UPDATE === '1') {
      writeFileSync(goldenPath, `${JSON.stringify(values, null, 2)}\n`);
      return;
    }
    const expected = JSON.parse(readFileSync(goldenPath, 'utf8')) as Goldens;
    expect(values).toEqual(expected);
  });

  it('repite el mismo B-mode con la misma semilla', () => {
    expect(eyeHash(REFERENCE_SEED)).toBe(eyeHash(REFERENCE_SEED));
  });

  it('cambia el B-mode con otra semilla', () => {
    expect(eyeHash(REFERENCE_SEED + 1)).not.toBe(eyeHash(REFERENCE_SEED));
  });
});
