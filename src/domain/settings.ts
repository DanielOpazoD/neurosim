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
    lineDensity: 'media',
    frequencyMhz: FISICA_US.params.defaultEyeFrequencyMhz.value,
    depthMm: FISICA_US.params.defaultEyeDepthMm.value,
    focusMm: FISICA_US.params.defaultEyeFocusMm.value,
    gainDb: FISICA_US.params.defaultEyeGainDb.value,
    tgcDb: [-6, -4, -2, 0, 1, 2, 3, 4],
    dynamicRangeDb: FISICA_US.params.defaultEyeDynamicRangeDb.value,
    persistence: FISICA_US.params.defaultEyePersistence.value,
    prfHz: FISICA_US.params.defaultEyePrfHz.value,
    gateMm: FISICA_US.params.defaultEyeGateMm.value,
    wallFilterHz: FISICA_US.params.defaultEyeWallFilterHz.value,
    angleCorrectionDeg: 0,
    baseline: 0.5,
    dopplerGainDb: 0,
    spectralGainDb: 0,
    outputPowerDb: FISICA_US.params.defaultEyeOutputPowerDb.value,
    invertColor: false,
    // El color solo corre en temporal; forma válida por si se activa.
    colorBox: { uCenter: 0, uHalf: 15, zMinMm: 5, zMaxMm: 40 },
  };
}

export function defaultTemporalSettings(): AcquisitionSettings {
  return {
    transducer: 'sector',
    lineDensity: 'media',
    frequencyMhz: DOPPLER.params.tcdF0Mhz.value,
    depthMm: DOPPLER.params.defaultTemporalDepthMm.value,
    focusMm: DOPPLER.params.defaultTemporalFocusMm.value,
    gainDb: DOPPLER.params.defaultTemporalGainDb.value,
    tgcDb: [-4, -2, 0, 1, 2, 3, 4, 5],
    dynamicRangeDb: DOPPLER.params.defaultTemporalDynamicRangeDb.value,
    persistence: DOPPLER.params.defaultTemporalPersistence.value,
    prfHz: DOPPLER.params.defaultTemporalPrfHz.value,
    gateMm: DOPPLER.params.defaultTemporalGateMm.value,
    wallFilterHz: DOPPLER.params.defaultTemporalWallFilterHz.value,
    angleCorrectionDeg: 0,
    baseline: 0.5,
    dopplerGainDb: 8,
    spectralGainDb: 0,
    outputPowerDb: FISICA_US.params.defaultTemporalOutputPowerDb.value,
    invertColor: false,
    // Caja por defecto centrada sobre el espacio basal/M1.
    colorBox: { uCenter: 0, uHalf: (25 * Math.PI) / 180, zMinMm: 30, zMaxMm: 80 },
  };
}
