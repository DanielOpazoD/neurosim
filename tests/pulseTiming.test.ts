import { describe, expect, it } from 'vitest';
import { pulseTiming } from '../src/doppler/pulseTiming';
import { DOPPLER } from '../src/doppler/params';
import type { GateGeometry } from '../src/doppler/sampleVolume';
import { nyquistVelocityCms, dopplerShiftHz, wrapToNyquist } from '../src/core/units';

const gate: Pick<
  GateGeometry,
  'lengthMm' | 'pulseSigmaMm' | 'lateralSigmaMm' | 'elevationSigmaMm' | 'beamDir' | 'lateral' | 'elevation'
> = {
  lengthMm: 4,
  pulseSigmaMm: 0,
  lateralSigmaMm: 0,
  elevationSigmaMm: 0,
  beamDir: [0, 0, 1],
  lateral: [1, 0, 0],
  elevation: [0, 1, 0],
};

describe('tiempo de ida y vuelta PW sin HPRF (DEC-73)', () => {
  it('incluye el alcance de los bordes cuando el haz sectorial gira respecto del lateral', () => {
    const timing = pulseTiming(4000, 60, { ...gate, beamDir: [0.6, 0, 0.8], lateralSigmaMm: 2 });
    expect(timing.maxSampleRangeMm).toBeCloseTo(Math.hypot(62 * 0.6 + 5, 62 * 0.8), 9);
  });

  it('separa aliasing de velocidad de rango: bajar frecuencia aumenta velocidad Nyquist, no su banda en Hz', () => {
    const timing = pulseTiming(4000, 60, gate);
    expect(timing.status).toBe('compatible');
    const shift = dopplerShiftHz(1000, 2e6);
    expect(shift).toBeGreaterThan(timing.nyquistHz);
    expect(wrapToNyquist(shift, timing.prfHz)).toBeLessThan(0);
    expect(nyquistVelocityCms(timing.prfHz, 2e6)).toBe(77);
    expect(nyquistVelocityCms(timing.prfHz, 1e6)).toBe(154);
    expect(nyquistVelocityCms(timing.prfHz, 2e6, Math.PI / 3)).toBeCloseTo(154, 9);
  });

  it('rechaza desbordamiento numérico del alcance aunque los parámetros sean finitos', () => {
    expect(pulseTiming(1e-320, 60, gate).status).toBe('parametros-invalidos');
    expect(pulseTiming(4000, Number.MAX_VALUE, { ...gate, lengthMm: Number.MAX_VALUE }).status).toBe(
      'parametros-invalidos',
    );
  });
  it('usa mm/s y el borde lejano de la puerta, no solo su centro', () => {
    const timing = pulseTiming(10000, 60, gate);
    expect(timing.status).toBe('compatible');
    expect(timing.maxSampleRangeMm).toBe(62);
    expect(timing.roundTripS).toBeCloseTo((2 * 0.062) / 1540, 12);
    expect(timing.maxPrfHz).toBeCloseTo(1540 / (2 * 0.062), 8);
    expect(timing.unambiguousRangeMm).toBe(77);
    expect(timing.nyquistHz).toBe(5000);
  });

  it('16 kHz a 62 mm requieren ambigüedad de rango no modelada', () => {
    const timing = pulseTiming(16000, 62.44319, gate);
    expect(timing.status).toBe('prf-inviable');
    expect(timing.unambiguousRangeMm).toBe(48.125);
  });

  it('acepta la igualdad ideal y rechaza superar el máximo sin tolerancia arbitraria', () => {
    const maximum = pulseTiming(4000, 60, gate).maxPrfHz;
    expect(pulseTiming(maximum, 60, gate).status).toBe('compatible');
    expect(pulseTiming(maximum * (1 + 1e-10), 60, gate).status).toBe('prf-inviable');
  });

  it('aumentar profundidad o longitud reduce la PRF máxima', () => {
    const shallow = pulseTiming(11000, 60, gate);
    expect(pulseTiming(11000, 90, gate).status).toBe('prf-inviable');
    expect(pulseTiming(11000, 60, { ...gate, lengthMm: 40 }).status).toBe('prf-inviable');
    expect(shallow.status).toBe('compatible');
  });

  it('incluye el soporte finito del pulso y el volumen lateral/elevacional del motor', () => {
    const support = DOPPLER.params.sampleVolumeSupportSigma.value;
    const timing = pulseTiming(4000, 60, {
      ...gate,
      pulseSigmaMm: 1,
      lateralSigmaMm: 2,
      elevationSigmaMm: 3,
    });
    expect(timing.maxSampleRangeMm).toBeCloseTo(Math.hypot(62 + support, support * 2, support * 3), 9);
  });

  it.each([0, -100, Number.NaN, Number.POSITIVE_INFINITY])('PRF inválida %s no es realizable', (prf) => {
    expect(pulseTiming(prf, 60, gate).status).toBe('parametros-invalidos');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'profundidad inválida %s no es realizable',
    (depth) => {
      expect(pulseTiming(4000, depth, gate).status).toBe('parametros-invalidos');
    },
  );

  it.each(['lengthMm', 'pulseSigmaMm', 'lateralSigmaMm', 'elevationSigmaMm'] as const)(
    'rechaza %s negativo/no finito',
    (field) => {
      expect(pulseTiming(4000, 60, { ...gate, [field]: -1 }).status).toBe('parametros-invalidos');
      expect(pulseTiming(4000, 60, { ...gate, [field]: Number.NaN }).status).toBe('parametros-invalidos');
    },
  );
});
