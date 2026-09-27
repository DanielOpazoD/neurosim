/**
 * Fisiología basal del adulto de referencia N1: reloj cardíaco, forma de onda
 * arterial cerebral y parámetros por vaso.
 *
 * La onda modela una ACM normal: upstroke sistólico rápido (~90 ms), decaimiento
 * exponencial a diástole. v(φ) = EDV + (PSV − EDV)·s(φ) con s∈[0,1].
 * TAMax emerge de integrar la envolvente real — NUNCA de (PSV+2·EDV)/3,
 * que es una aproximación clínica (plan §7.4).
 */
import { SeededRandom } from '../core/random';
import type { Vec3 } from '../core/vec3';
import { scale, normalize } from '../core/vec3';
import type { BasalPhysiology } from '../domain/contracts';
import type { HeadGeometry, Vessel } from '../anatomy/head';
import { vesselAt, vesselClosest, vesselDistance } from '../anatomy/head';
import { FISIOLOGIA } from './params';

/** Estado fisiológico instantáneo. */
export interface PhysState {
  /** Tiempo de simulación, s. */
  readonly t: number;
  /** Fase cardíaca [0,1). */
  readonly cardiacPhase: number;
  readonly heartRateBpm: number;
}

/** Reloj cardíaco: fase y tiempos de latido para las medidas. */
export class CardiacCycle {
  constructor(
    readonly bpm: number,
    private readonly rng: SeededRandom,
    private readonly jitter = 0.012,
  ) {}

  get periodS(): number {
    return 60 / this.bpm;
  }

  /** Fase en [0,1) con variabilidad RR gaussiana pequeña. */
  phaseAt(t: number): number {
    const p = (t / this.periodS) % 1;
    return p < 0 ? p + 1 : p;
  }

  /** Tiempos de inicio de latido que cubren [t0, t1]. */
  beatsIn(t0: number, t1: number): { tStart: number; rr: number }[] {
    const beats: { tStart: number; rr: number }[] = [];
    const first = Math.floor(t0 / this.periodS) - 1;
    for (let k = first; k * this.periodS <= t1 + this.periodS; k++) {
      const rr = this.periodS * (1 + this.rng.gaussian() * this.jitter);
      beats.push({ tStart: k * this.periodS, rr });
    }
    return beats;
  }
}

/** Fase del upstroke (fracción del ciclo) y constante de decaimiento. */
const UPSTROKE_PH = FISIOLOGIA.params.upstrokePhase.value;
const DECAY_TAU = FISIOLOGIA.params.decayTau.value;

/**
 * Forma de onda arterial sin dimensiones s(φ) ∈ [0,1]:
 * subida lineal hasta φ = UPSTROKE_PH, decaimiento exponencial después.
 * Con φp = 0,09 y τ = 0,35 el valor medio de s ≈ 0,36: para PSV 90/EDV 35 cm/s
 * da TAMax ≈ 55 cm/s (fixture N1 §2.4).
 */
export function arterialShape(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  if (p < UPSTROKE_PH) return p / UPSTROKE_PH;
  return Math.exp(-(p - UPSTROKE_PH) / DECAY_TAU);
}

/** Velocidad espacial media del vaso en la fase dada, cm/s. */
export function vesselVelocityCms(v: Vessel, phase: number): number {
  return v.edvCms + (v.psvCms - v.edvCms) * arterialShape(phase);
}

/** Query de flujo por posición: velocidad de la sangre (mm/s) en un punto. */
export class CerebralFlow {
  constructor(
    readonly head: HeadGeometry,
    readonly phys: BasalPhysiology,
  ) {}

  /**
   * Velocidad de la sangre en mm/s en un punto del paciente.
   * Perfil laminar: v(r) = vEje·(1 − 0,85·(r/R)²) dentro del tubo.
   */
  velocityAt(p: Vec3, phase: number): Vec3 {
    const v = vesselAt(this.head, p);
    if (!v) return [0, 0, 0];
    const d = vesselDistance(v, p); // <0 dentro
    const r = v.radiusMm + d; // distancia al eje
    const x = Math.min(1, Math.max(0, r / v.radiusMm));
    const profile = 1 - 0.85 * x * x;
    const uCms = vesselVelocityCms(v, phase);
    const dir = normalize(vesselClosest(v, p).tangent);
    return scale(dir, v.flowSign * uCms * 10 * Math.max(0, profile));
  }
}
