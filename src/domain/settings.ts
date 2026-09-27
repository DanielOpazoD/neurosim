/**
 * Ajustes de fábrica por estación. Todo ajuste con efecto observable vive
 * en `AcquisitionSettings` (contrato); nada «libre» fuera de él.
 */
import type { AcquisitionSettings } from './contracts';
import { NEURO_PARAMS } from './parameters';

export function defaultEyeSettings(): AcquisitionSettings {
  return {
    transducer: 'linear',
    frequencyMhz: 10,
    depthMm: 45,
    focusMm: 22,
    gainDb: 6,
    tgcDb: [0, 0, 0, 0, 0, 0, 0, 0],
    dynamicRangeDb: 60,
    persistence: 0.3,
    prfHz: 2500,
    gateMm: 2,
    wallFilterHz: 50,
    angleCorrectionDeg: 0,
    baseline: 0.5,
    dopplerGainDb: 0,
    invertColor: false,
  };
}

export function defaultTemporalSettings(): AcquisitionSettings {
  return {
    transducer: 'sector',
    frequencyMhz: NEURO_PARAMS.params.tcdF0Mhz.value,
    depthMm: 90,
    focusMm: 50,
    gainDb: 14,
    tgcDb: [0, 0, 0, 0, 0, 0, 0, 0],
    dynamicRangeDb: 55,
    persistence: 0.4,
    prfHz: 6000,
    gateMm: 6,
    wallFilterHz: 100,
    angleCorrectionDeg: 0,
    baseline: 0.5,
    dopplerGainDb: 8,
    invertColor: false,
  };
}
