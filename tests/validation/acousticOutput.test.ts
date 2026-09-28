import { describe, expect, it } from 'vitest';
import { classifyEye } from '../../src/anatomy/eye';
import { normalize, sub } from '../../src/core/vec3';
import { buildReferenceCase, REFERENCE_SEED } from '../../src/domain/referenceCase';
import { defaultEyeSettings, defaultTemporalSettings } from '../../src/domain/settings';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import type { GateGeometry } from '../../src/doppler/sampleVolume';
import { renderBMode } from '../../src/ultrasound/bmode';
import { acousticOutput } from '../../src/ultrasound/acousticOutput';
import { buildScan, samplePoint } from '../../src/ultrasound/probe';
import { eyePose } from './helpers';

function output(
  overrides: Partial<ReturnType<typeof defaultEyeSettings>> & {
    station?: 'ojo' | 'temporal';
    mode?: 'bmode' | 'color' | 'pw';
  } = {},
) {
  const station = overrides.station ?? 'ojo';
  const base = station === 'ojo' ? defaultEyeSettings() : defaultTemporalSettings();
  return acousticOutput({
    transducer: base.transducer,
    station,
    mode: overrides.mode ?? 'bmode',
    frequencyMhz: overrides.frequencyMhz ?? base.frequencyMhz,
    focusMm: overrides.focusMm ?? base.focusMm,
    prfHz: overrides.prfHz ?? base.prfHz,
    gateMm: overrides.gateMm ?? base.gateMm,
    outputPowerDb: overrides.outputPowerDb ?? base.outputPowerDb,
  });
}

function pwBandPowerDb(outputPowerDb: number): number {
  const sim = buildReferenceCase(REFERENCE_SEED);
  const chain = new PwDopplerChain(sim.head, sim.patient.seed);
  const windowCenter = sim.head.windowCenter.der;
  const m1 = sim.head.vessels.find((v) => v.id === 'm1-der')!;
  const target = m1.points[2]!;
  const beamDir = normalize(sub(target, windowCenter));
  const gate: GateGeometry = {
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
  chain.setGate(gate);
  chain.begin(6000, 2e6, 20, 100, 0, 10 ** (outputPowerDb / 20));
  let t = 0;
  for (let step = 0; step < 16; step += 1) {
    chain.step(
      (tt) => sim.physStateAt(tt),
      t,
      () => [0, 0, 0],
      0.064,
    );
    chain.flush();
    t += 0.064;
  }
  const columns = chain.spectral.columns.slice(-100);
  let power = 0;
  let count = 0;
  for (const column of columns) {
    for (let index = 0; index < chain.spectral.fftSize; index += 1) {
      const frequency = chain.spectral.binFrequency(index);
      if (frequency >= 300 && frequency < 2200) {
        power += 10 ** (column.powerDb[index]! / 10);
        count += 1;
      }
    }
  }
  return 10 * Math.log10(power / count);
}

describe('salida acústica ALARA', () => {
  it('mantiene el preset ocular dentro de MI y TI', () => {
    const result = output();
    expect(result.mi).toBeLessThanOrEqual(0.23);
    expect(result.mi).toBeGreaterThanOrEqual(0.15);
    expect(result.ti).toBeLessThanOrEqual(1);
    expect(result.tiKind).toBe('TIS');
  });

  it('calcula un preset PW temporal de presión máxima sin derating focal', () => {
    const result = output({
      station: 'temporal',
      mode: 'pw',
      focusMm: 0,
      outputPowerDb: 0,
    });
    expect(result.mi).toBeGreaterThanOrEqual(0.8);
    expect(result.mi).toBeLessThanOrEqual(1.9);
    expect(result.ti).toBeGreaterThanOrEqual(0.5);
    expect(result.ti).toBeLessThanOrEqual(3);
    expect(result.tiKind).toBe('TIC');
  });

  it('escala MI con potencia, frecuencia y derating focal', () => {
    const full = output({ focusMm: 0, outputPowerDb: 0 });
    const halfDb = output({ focusMm: 0, outputPowerDb: -6 });
    const doubleFrequency = output({ focusMm: 0, frequencyMhz: 20, outputPowerDb: 0 });
    const deep = output({ focusMm: 30, outputPowerDb: 0 });
    expect(halfDb.mi / full.mi).toBeCloseTo(10 ** (-6 / 20), 2);
    expect(doubleFrequency.mi / full.mi).toBeCloseTo(1 / Math.sqrt(2), 2);
    expect(deep.mi).toBeLessThan(full.mi);
  });

  it('incrementa TI con modo, PRF y puerta', () => {
    const bmode = output({ mode: 'bmode', outputPowerDb: 0 });
    const color = output({ mode: 'color', outputPowerDb: 0 });
    const pw = output({ mode: 'pw', outputPowerDb: 0 });
    const highPrf = output({ mode: 'pw', prfHz: 2 * defaultEyeSettings().prfHz, outputPowerDb: 0 });
    const highGate = output({ mode: 'pw', gateMm: 2 * defaultEyeSettings().gateMm, outputPowerDb: 0 });
    expect(pw.ti).toBeGreaterThan(color.ti);
    expect(color.ti).toBeGreaterThan(bmode.ti);
    expect(highPrf.ti).toBeGreaterThan(pw.ti);
    expect(highGate.ti).toBeGreaterThan(pw.ti);
  });

  it('marca una salida temporal máxima aplicada al ojo como insegura', () => {
    expect(
      output({
        mode: 'pw',
        outputPowerDb: 0,
        frequencyMhz: 10,
        focusMm: 0,
      }).ocularLimitExceeded,
    ).toBe(true);
  });

  it('reduce la SNR lineal y conserva la visibilidad al bajar potencia', () => {
    const sim = buildReferenceCase(REFERENCE_SEED);
    const base = defaultEyeSettings();
    const scan = buildScan(eyePose(sim, 'der'), 'linear', 64);
    const render = (outputPowerDb: number, gainDb: number) =>
      renderBMode(
        { classify: (p) => classifyEye(sim.eyes.der, p) },
        scan,
        { ...base, outputPowerDb, gainDb },
        `acoustic-snr-${outputPowerDb}-${gainDb}`,
      );
    const noiseless = renderBMode(
      { classify: (p) => classifyEye(sim.eyes.der, p) },
      scan,
      { ...base, outputPowerDb: 0 },
      'acoustic-snr-noiseless',
      { electronicNoise: false },
    );
    const reference = render(0, base.gainDb);
    const low = render(-20, base.gainDb + 20);
    const samples = (frame: ReturnType<typeof render>) => {
      const sclera: number[] = [];
      const vitreous: number[] = [];
      const scleraDb: number[] = [];
      const vitreousDb: number[] = [];
      for (let zi = 0; zi < frame.height; zi += 2) {
        const zMm = ((zi + 0.5) / frame.height) * base.depthMm;
        for (let li = 0; li < frame.width; li += 2) {
          const material = classifyEye(sim.eyes.der, samplePoint(scan, li, zMm));
          const index = zi * frame.width + li;
          if (material === 'paredGlobo' && zMm >= 25 && zMm < 26) {
            sclera.push(Math.hypot(frame.iq[2 * index]!, frame.iq[2 * index + 1]!));
            scleraDb.push(frame.db[index]!);
          }
          // Vítreo central: el campo lateral es ahora ecogénico (reborde
          // óseo y piel hasta rxy ≤ 18 mm), así que se mide en el eje.
          if (material === 'vitrio' && zMm >= 14 && zMm < 22 && li >= 20 && li < frame.width - 20) {
            vitreous.push(Math.hypot(frame.iq[2 * index]!, frame.iq[2 * index + 1]!));
            vitreousDb.push(frame.db[index]!);
          }
        }
      }
      const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const displayMean = (values: number[]) =>
        mean(values.map((db) => 255 * Math.min(1, Math.max(0, db / base.dynamicRangeDb + 1))));
      return {
        scleraIq: mean(sclera),
        vitreousIq: mean(vitreous),
        snrDb: 20 * Math.log10(mean(sclera) / mean(vitreous)),
        scleraDisplay: displayMean(scleraDb),
        vitreousDisplay: displayMean(vitreousDb),
      };
    };
    const noiselessMetrics = samples(noiseless);
    expect(noiselessMetrics.scleraIq).toBeGreaterThan(10 * noiselessMetrics.vitreousIq);
    const referenceMetrics = samples(reference);
    const lowMetrics = samples(low);
    const snrDropDb = referenceMetrics.snrDb - lowMetrics.snrDb;
    expect(snrDropDb).toBeGreaterThanOrEqual(10);
    expect(referenceMetrics.vitreousDisplay).toBeLessThan(0.1 * 255);
    expect(lowMetrics.vitreousDisplay).toBeGreaterThanOrEqual(referenceMetrics.vitreousDisplay + 0.08 * 255);
    expect(Math.abs(referenceMetrics.scleraDisplay - lowMetrics.scleraDisplay)).toBeLessThanOrEqual(
      0.25 * 255,
    );
  });

  it('reduce la potencia espectral PW aproximadamente 20 dB a -20 dB', () => {
    const fullPowerDb = pwBandPowerDb(0);
    const lowPowerDb = pwBandPowerDb(-20);
    expect(fullPowerDb - lowPowerDb).toBeCloseTo(20, 0);
  }, 30000);
});
