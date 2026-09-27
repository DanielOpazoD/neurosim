import type { Station, TransducerKind } from '../domain/contracts';
import { FISICA_US } from './params';

export type ImagingMode = 'bmode' | 'color' | 'pw';

export interface AcousticOutputInput {
  transducer: TransducerKind;
  station: Station;
  mode: ImagingMode;
  frequencyMhz: number;
  focusMm: number;
  prfHz: number;
  gateMm: number;
  outputPowerDb: number;
}

export interface AcousticOutput {
  mi: number;
  ti: number;
  tiKind: 'TIS' | 'TIC';
  prDeratedMPa: number;
  powerMw: number;
  ocularLimitExceeded: boolean;
}

function modePowerMw(mode: ImagingMode): number {
  if (mode === 'pw') return FISICA_US.params.pwPowerMw.value;
  if (mode === 'color') return FISICA_US.params.colorPowerMw.value;
  return FISICA_US.params.bmodePowerMw.value;
}

function dutyFactor(inp: AcousticOutputInput): number {
  if (inp.mode === 'bmode') return 1;
  const prfRef = inp.station === 'ojo' ? FISICA_US.params.defaultEyePrfHz.value : 6000;
  const gateRef = inp.station === 'ojo' ? FISICA_US.params.defaultEyeGateMm.value : 6;
  return Math.min(2, Math.max(0.25, (inp.prfHz / prfRef) * (inp.gateMm / gateRef)));
}

export function acousticOutput(inp: AcousticOutputInput): AcousticOutput {
  const p0 =
    inp.transducer === 'linear'
      ? FISICA_US.params.linearPeakPressureMPa.value
      : FISICA_US.params.sectorPeakPressureMPa.value;
  const outputDb = Math.min(0, Math.max(-20, inp.outputPowerDb));
  const pressure = p0 * 10 ** (outputDb / 20);
  const focusCm = Math.max(0, inp.focusMm) / 10;
  const prDeratedMPa = pressure * 10 ** (-(0.3 * inp.frequencyMhz * focusCm) / 20);
  const mi = prDeratedMPa / Math.sqrt(Math.max(Number.EPSILON, inp.frequencyMhz));
  const powerMw = modePowerMw(inp.mode) * 10 ** (outputDb / 10) * dutyFactor(inp);
  const tiKind = inp.station === 'ojo' ? 'TIS' : 'TIC';
  const ti =
    tiKind === 'TIS'
      ? (powerMw * inp.frequencyMhz) / 210
      : powerMw / (40 * (FISICA_US.params.sectorApertureActiveMm.value / 10));
  return {
    mi,
    ti,
    tiKind,
    prDeratedMPa,
    powerMw,
    ocularLimitExceeded:
      inp.station === 'ojo' &&
      (mi > FISICA_US.params.ocularMaxMi.value || ti > FISICA_US.params.ocularMaxTi.value),
  };
}
