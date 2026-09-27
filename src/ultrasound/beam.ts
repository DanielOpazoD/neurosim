import { SPEED_OF_SOUND_M_S } from '../core/units';
import type { AcquisitionSettings, TransducerKind } from '../domain/contracts';
import { FISICA_US } from './params';

export interface BeamSpec {
  readonly apertureMm: number;
  readonly elevationApertureMm: number;
  readonly focusMm: number;
  readonly elevationFocusMm: number;
  readonly frequencyMhz: number;
  readonly soundSpeedMs: number;
}

const FWHM_TO_SIGMA = 2.355;

function fwhmAtFocus(
  apertureMm: number,
  focusMm: number,
  frequencyMhz: number,
  soundSpeedMs: number,
): number {
  const wavelengthMm = soundSpeedMs / (frequencyMhz * 1000);
  return (wavelengthMm * focusMm) / apertureMm;
}

function fwhm(
  apertureMm: number,
  focusMm: number,
  frequencyMhz: number,
  soundSpeedMs: number,
  zMm: number,
  divergenceGamma: number,
): number {
  const atFocus = fwhmAtFocus(apertureMm, focusMm, frequencyMhz, soundSpeedMs);
  const defocus = zMm - focusMm;
  const divergence = defocus * (apertureMm / focusMm) * divergenceGamma;
  return Math.sqrt(atFocus * atFocus + divergence * divergence);
}

export function lateralFwhmMm(spec: BeamSpec, zMm: number): number {
  const tx = fwhm(
    spec.apertureMm,
    spec.focusMm,
    spec.frequencyMhz,
    spec.soundSpeedMs,
    zMm,
    FISICA_US.params.beamDivergenceGamma.value,
  );
  const wavelengthMm = spec.soundSpeedMs / (spec.frequencyMhz * 1000);
  const rx = (wavelengthMm * Math.max(zMm, 5)) / spec.apertureMm;
  return 1 / Math.sqrt(1 / (tx * tx) + 1 / (rx * rx));
}

export function elevationFwhmMm(spec: BeamSpec, zMm: number): number {
  return fwhm(
    spec.elevationApertureMm,
    spec.elevationFocusMm,
    spec.frequencyMhz,
    spec.soundSpeedMs,
    zMm,
    FISICA_US.params.elevationDivergenceGamma.value,
  );
}

export function sidelobeLevelDb(_spec: BeamSpec): number {
  return FISICA_US.params.sidelobeDb.value;
}

export function probeBeamSpec(transducer: TransducerKind, settings: AcquisitionSettings): BeamSpec {
  const p = FISICA_US.params;
  const sector = transducer === 'sector';
  return {
    apertureMm: sector ? p.sectorApertureActiveMm.value : p.linearApertureActiveMm.value,
    elevationApertureMm: sector ? p.sectorElevationApertureMm.value : p.linearElevationApertureMm.value,
    focusMm: settings.focusMm,
    elevationFocusMm: sector ? p.sectorElevationFocusMm.value : p.linearElevationFocusMm.value,
    frequencyMhz: settings.frequencyMhz,
    soundSpeedMs: SPEED_OF_SOUND_M_S,
  };
}

export function sigmaFromFwhm(fwhmMm: number): number {
  return fwhmMm / FWHM_TO_SIGMA;
}
