/**
 * Ajustes de fábrica por estación. Todo ajuste con efecto observable vive
 * en `AcquisitionSettings` (contrato); nada «libre» fuera de él.
 */
import type { AcquisitionSettings } from './contracts';
import { FISICA_US } from '../ultrasound/params';
import { DOPPLER } from '../doppler/params';

export function defaultEyeSettings(): AcquisitionSettings {
  return {
    transducer: 'linear',
    frequencyMhz: FISICA_US.params.defaultEyeFrequencyMhz.value,
    depthMm: FISICA_US.params.defaultEyeDepthMm.value,
    focusMm: FISICA_US.params.defaultEyeFocusMm.value,
    gainDb: FISICA_US.params.defaultEyeGainDb.value,
    tgcDb: Array(8).fill(FISICA_US.params.defaultTgcDb.value),
    dynamicRangeDb: FISICA_US.params.defaultEyeDynamicRangeDb.value,
    persistence: FISICA_US.params.defaultEyePersistence.value,
    prfHz: FISICA_US.params.defaultEyePrfHz.value,
    gateMm: FISICA_US.params.defaultEyeGateMm.value,
    wallFilterHz: FISICA_US.params.defaultEyeWallFilterHz.value,
    angleCorrectionDeg: 0,
    baseline: 0.5,
    dopplerGainDb: 0,
    invertColor: false,
  };
}

export function defaultTemporalSettings(): AcquisitionSettings {
  return {
    transducer: 'sector',
    frequencyMhz: DOPPLER.params.tcdF0Mhz.value,
    depthMm: DOPPLER.params.defaultTemporalDepthMm.value,
    focusMm: DOPPLER.params.defaultTemporalFocusMm.value,
    gainDb: DOPPLER.params.defaultTemporalGainDb.value,
    tgcDb: Array(8).fill(FISICA_US.params.defaultTgcDb.value),
    dynamicRangeDb: DOPPLER.params.defaultTemporalDynamicRangeDb.value,
    persistence: DOPPLER.params.defaultTemporalPersistence.value,
    prfHz: DOPPLER.params.defaultTemporalPrfHz.value,
    gateMm: DOPPLER.params.defaultTemporalGateMm.value,
    wallFilterHz: DOPPLER.params.defaultTemporalWallFilterHz.value,
    angleCorrectionDeg: 0,
    baseline: 0.5,
    dopplerGainDb: 8,
    invertColor: false,
  };
}
