/** Alcance ideal del PW de rango único (DEC-73), no secuenciador ni modelo HPRF. */
import { FISICA_US } from '../ultrasound/params';
import { DOPPLER } from './params';
import type { GateGeometry } from './sampleVolume';
import { add, scale, length } from '../core/vec3';

export interface PulseTiming {
  readonly status: 'compatible' | 'prf-inviable' | 'parametros-invalidos';
  readonly prfHz: number;
  readonly maxSampleRangeMm: number;
  readonly roundTripS: number;
  readonly maxPrfHz: number;
  readonly unambiguousRangeMm: number;
  readonly nyquistHz: number;
}

export function pulseTiming(
  prfHz: number,
  depthMm: number,
  gate: Pick<
    GateGeometry,
    'lengthMm' | 'pulseSigmaMm' | 'lateralSigmaMm' | 'elevationSigmaMm' | 'beamDir' | 'lateral' | 'elevation'
  >,
): PulseTiming {
  const support = DOPPLER.params.sampleVolumeSupportSigma.value;
  const parametersOk =
    [prfHz, depthMm, gate.lengthMm].every((v) => Number.isFinite(v) && v > 0) &&
    [gate.pulseSigmaMm, gate.lateralSigmaMm, gate.elevationSigmaMm].every(
      (v) => Number.isFinite(v) && v >= 0,
    ) &&
    [...gate.beamDir, ...gate.lateral, ...gate.elevation].every(Number.isFinite);
  const cMmS = FISICA_US.params.soundSpeedMs.value * 1000;
  let maxSampleRangeMm = parametersOk ? 0 : Number.NaN;
  if (parametersOk) {
    // Vértices nominales de SampleVolumeIQ; el lateral sectorial no es perpendicular al haz.
    for (const axial of [-1, 1])
      for (const lateral of [-1, 1])
        for (const elevation of [-1, 1]) {
          const corner = add(
            scale(gate.beamDir, depthMm + axial * (gate.lengthMm / 2 + support * gate.pulseSigmaMm)),
            add(
              scale(gate.lateral, lateral * support * gate.lateralSigmaMm),
              scale(gate.elevation, elevation * support * gate.elevationSigmaMm),
            ),
          );
          maxSampleRangeMm = Math.max(maxSampleRangeMm, length(corner));
        }
  }
  const roundTripS = (2 * maxSampleRangeMm) / cMmS;
  const maxPrfHz = 1 / roundTripS;
  const unambiguousRangeMm = parametersOk ? cMmS / (2 * prfHz) : Number.NaN;
  const valid =
    parametersOk &&
    [maxSampleRangeMm, roundTripS, maxPrfHz, unambiguousRangeMm].every((v) => Number.isFinite(v) && v > 0);
  return {
    status: !valid ? 'parametros-invalidos' : prfHz <= maxPrfHz ? 'compatible' : 'prf-inviable',
    prfHz,
    maxSampleRangeMm,
    roundTripS,
    maxPrfHz,
    unambiguousRangeMm,
    nyquistHz: parametersOk ? prfHz / 2 : Number.NaN,
  };
}

export function pulseTimingText(status: PulseTiming['status']): string {
  switch (status) {
    case 'compatible':
      return 'Alcance compatible con PW de rango único bajo el límite ideal; no valida un equipo real.';
    case 'prf-inviable':
      return 'PRF excede el límite ideal de rango único. HPRF/ambigüedad de rango no modelados: bajar PRF o profundidad de puerta. Índices y audio bloqueados; puede persistir aliasing de velocidad.';
    case 'parametros-invalidos':
      return 'Parámetros PW no finitos o fuera de rango: no se puede evaluar la adquisición.';
  }
}
