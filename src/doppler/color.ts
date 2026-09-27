/**
 * Doppler color por autocorrelación de Kasai sobre ensembles IQ sintetizados.
 * Las celdas sin un vaso en el corte no generan clutter todavía (LIM-16).
 */
import { SeededRandom, hash3 } from '../core/random';
import type { AcquisitionSettings, ProbePose } from '../domain/contracts';
import type { HeadGeometry, Vessel } from '../anatomy/head';
import { vesselClosest, vesselDistance } from '../anatomy/head';
import type { CerebralFlow } from '../physiology/flow';
import { elevationFwhmMm, probeBeamSpec } from '../ultrasound/beam';
import { beamDirAt, imageToPatient, type ScanGeometry } from '../ultrasound/probe';
import { skullAttenuationDb } from '../ultrasound/attenuation';
import { MATERIALS } from '../anatomy/materials';
import { DOPPLER } from './params';
import { ensembleWallFilter, kasaiEstimate, kasaiVariance, kasaiVelocityCms } from './kasai';
import { tissueVelocityMmS } from './clutter';
import { FISIOLOGIA } from '../physiology/params';
import type { HemodynamicState } from '../physiology/hemodynamics';
import { hemodynamics } from '../physiology/hemodynamics';

export interface ColorCell {
  /** Velocidad proyectada con signo hacia la sonda, cm/s. NaN = sin flujo. */
  vCms: number;
  /** Potencia relativa del retorno de sangre [0,1]. */
  power: number;
  /** Varianza normalizada de Kasai [0,1]. */
  variance: number;
}

interface ColorScatterer {
  readonly phase: number;
  readonly amplitude: number;
  readonly velocityTowardCms: number;
  readonly rangeMm: number;
}

const SOUND_SPEED_MS = 1540;

function elevationDirection(pose: ProbePose): [number, number, number] {
  const f = pose.forward;
  const l = pose.lateral;
  return [f[1] * l[2] - f[2] * l[1], f[2] * l[0] - f[0] * l[2], f[0] * l[1] - f[1] * l[0]];
}

function cellScatterers(
  head: HeadGeometry,
  flow: CerebralFlow,
  center: [number, number, number],
  axial: [number, number, number],
  lateral: [number, number, number],
  elevation: [number, number, number],
  axialHalf: number,
  lateralHalf: number,
  elevationHalf: number,
  seed: number,
  zi: number,
  ci: number,
  cardiacPhase: number,
  heartRateBpm: number,
  flowModulation: number,
  hemo: HemodynamicState,
  primaryVessel: Vessel,
): ColorScatterer[] {
  const rng = new SeededRandom((seed ^ hash3(zi, ci, 0, 0x4b534149)) >>> 0);
  const result: ColorScatterer[] = [];
  for (let j = 0; j < DOPPLER.params.colorScatterers.value; j += 1) {
    const da = rng.range(-axialHalf, axialHalf);
    const dl = rng.range(-lateralHalf, lateralHalf);
    const de = rng.range(-elevationHalf, elevationHalf);
    const p: [number, number, number] = [
      center[0] + axial[0] * da + lateral[0] * dl + elevation[0] * de,
      center[1] + axial[1] * da + lateral[1] * dl + elevation[1] * de,
      center[2] + axial[2] * da + lateral[2] * dl + elevation[2] * de,
    ];
    const distance = vesselDistance(primaryVessel, p);
    const closest = distance < 0 ? { distance, point: vesselClosest(primaryVessel, p).point } : null;
    let velocityTowardCms = 0;
    let amplitude = MATERIALS.tejidoCerebral.scatterAmp * 60;
    if (closest) {
      const velocity = flow.velocityAt(closest.point, cardiacPhase, flowModulation, hemo);
      velocityTowardCms = -(velocity[0] * axial[0] + velocity[1] * axial[1] + velocity[2] * axial[2]) / 10;
      amplitude = DOPPLER.params.amplitudSangre.value;
    } else {
      const tissueVelocity = tissueVelocityMmS({
        head,
        point: p,
        cardiacPhase,
        heartRateBpm,
        tSec: (cardiacPhase * 60) / heartRateBpm,
      });
      velocityTowardCms =
        -(tissueVelocity[0] * axial[0] + tissueVelocity[1] * axial[1] + tissueVelocity[2] * axial[2]) / 10;
    }
    result.push({
      phase: rng.range(0, 2 * Math.PI),
      amplitude: amplitude * rng.range(0.7, 1.3),
      velocityTowardCms,
      rangeMm: p[0] * axial[0] + p[1] * axial[1] + p[2] * axial[2],
    });
  }
  return result;
}

/**
 * Mapa de color por muestra del barrido. `rows`/`cols` sobre la geometría
 * (`z` profundidad, `u` lateral).
 */
export function renderColorDoppler(
  head: HeadGeometry,
  flow: CerebralFlow,
  scan: ScanGeometry,
  pose: ProbePose,
  settings: AcquisitionSettings,
  seed: number,
  cardiacPhase: number,
  rows: number,
  cols: number,
  flowModulation = 1,
  hemo?: HemodynamicState,
): [Float32Array, Float32Array, Float32Array] {
  const vel = new Float32Array(rows * cols).fill(Number.NaN);
  const pow = new Float32Array(rows * cols);
  const variance = new Float32Array(rows * cols);
  const beam = probeBeamSpec(settings.transducer, settings);
  const ensemble = DOPPLER.params.colorEnsemble.value;
  const f0Hz = settings.frequencyMhz * 1e6;
  const phaseScale = (4 * Math.PI * f0Hz) / (SOUND_SPEED_MS * 1000);
  const heartRateBpm = FISIOLOGIA.params.heartRateBpm.value;
  const effectiveHemo =
    hemo ??
    hemodynamics({
      mapMmHg: FISIOLOGIA.params.mapMmHg.value,
      paco2MmHg: FISIOLOGIA.params.paco2MmHg.value,
      icpMmHg: FISIOLOGIA.params.icpMmHg.value,
    });
  const outputAmplitude = 10 ** (settings.outputPowerDb / 20);
  const wallVelocityCms = (SOUND_SPEED_MS * settings.wallFilterHz * 100) / (2 * f0Hz);
  const elevation = elevationDirection(pose);
  const attenuationCache = new Map<number, number>();
  for (let zi = 0; zi < rows; zi += 1) {
    const zMm = ((zi + 0.5) / rows) * settings.depthMm;
    const sliceHalfMm = Math.max(1, elevationFwhmMm(beam, zMm) / 2);
    const axialHalf = settings.depthMm / rows / 2;
    for (let ci = 0; ci < cols; ci += 1) {
      const u = ((ci + 0.5) / cols - 0.5) * scan.widthMmOrRad;
      const center = imageToPatient(pose, scan.kind, u, zMm);
      let bestExtra = Infinity;
      let primaryVessel: Vessel | null = null;
      for (const vessel of head.vessels) {
        const distance = vesselDistance(vessel, center);
        if (distance < bestExtra) {
          bestExtra = distance;
          primaryVessel = vessel;
        }
      }
      if (bestExtra >= sliceHalfMm) continue;
      if (!primaryVessel) continue;
      const axial = beamDirAt(pose, scan.kind, u);
      const lateral = scan.lateralDir;
      const lateralHalf = Math.abs(scan.widthMmOrRad / cols) / 2;
      const scatterers = cellScatterers(
        head,
        flow,
        center,
        axial,
        lateral,
        elevation,
        axialHalf,
        lateralHalf,
        sliceHalfMm,
        seed,
        zi,
        ci,
        cardiacPhase,
        heartRateBpm,
        flowModulation,
        effectiveHemo,
        primaryVessel,
      );
      const re = new Float32Array(ensemble);
      const im = new Float32Array(ensemble);
      const noiseRng = new SeededRandom((seed ^ hash3(zi, ci, ensemble, 0x4e4f4953)) >>> 0);
      const attenuationKey = zi * 16 + Math.floor(ci / 4);
      let attDb = attenuationCache.get(attenuationKey);
      if (attDb === undefined) {
        attDb = skullAttenuationDb(head, pose.origin, center, settings.frequencyMhz);
        attenuationCache.set(attenuationKey, attDb);
      }
      const transmission = Math.pow(10, -attDb / 20);
      for (let k = 0; k < ensemble; k += 1) {
        for (const scatterer of scatterers) {
          // vToward>0 reduce la distancia; así R1 tiene fase negativa y
          // kasaiVelocityCms conserva el signo positivo hacia la sonda.
          const range = scatterer.rangeMm - (scatterer.velocityTowardCms * 10 * k) / settings.prfHz;
          const phase = scatterer.phase + phaseScale * range;
          re[k] = re[k]! + outputAmplitude * scatterer.amplitude * transmission * Math.cos(phase);
          im[k] = im[k]! + outputAmplitude * scatterer.amplitude * transmission * Math.sin(phase);
        }
        const noise = DOPPLER.params.colorNoiseRel.value * DOPPLER.params.amplitudSangre.value * transmission;
        re[k] = re[k]! + noiseRng.gaussian() * noise;
        im[k] = im[k]! + noiseRng.gaussian() * noise;
      }
      ensembleWallFilter(re, im, ensemble);
      const estimate = kasaiEstimate(re, im, ensemble);
      const vCms = kasaiVelocityCms(estimate.r1Re, estimate.r1Im, settings.prfHz, f0Hz, SOUND_SPEED_MS);
      const varNorm = kasaiVariance(estimate.r0, estimate.r1Re, estimate.r1Im);
      const gainLinear = Math.pow(10, settings.dopplerGainDb / 10);
      const bloodReferencePower =
        gainLinear *
        ensemble *
        scatterers.length *
        DOPPLER.params.amplitudSangre.value ** 2 *
        transmission ** 2;
      const power = Math.min(1, (gainLinear * estimate.r0) / Math.max(Number.EPSILON, bloodReferencePower));
      const idx = zi * cols + ci;
      if (
        power >= DOPPLER.params.colorPowerThreshold.value &&
        varNorm <= DOPPLER.params.colorVarianceMax.value &&
        Math.abs(vCms) >= wallVelocityCms
      ) {
        vel[idx] = vCms;
        pow[idx] = power;
        variance[idx] = varNorm;
      }
    }
  }
  return [vel, pow, variance];
}
