/**
 * Fisiología basal del adulto de referencia N1: reloj cardíaco, forma de onda
 * arterial cerebral y parámetros por vaso.
 *
 * La onda modela una ACM normal mediante una tabla Windkessel de dos elementos.
 * v(φ) = EDV + (PSV − EDV)·s(φ) con s∈[0,1].
 * TAMax emerge de integrar la envolvente real — NUNCA de (PSV+2·EDV)/3,
 * que es una aproximación clínica (plan §7.4).
 */
import { hash3 } from '../core/random';
import type { Vec3 } from '../core/vec3';
import { scale, normalize } from '../core/vec3';
import type { BasalPhysiology } from '../domain/contracts';
import type { Vessel, VesselScene } from '../anatomy/head';
import { vesselAt, vesselClosest, vesselDistance } from '../anatomy/head';
import { arterialShapeTable, FISIOLOGIA } from './params';
import { Respiration } from './respiration';
import type { HemodynamicState } from './hemodynamics';

/** Estado fisiológico instantáneo. */
export interface PhysState {
  /** Tiempo de simulación, s. */
  readonly t: number;
  /** Fase cardíaca [0,1). */
  readonly cardiacPhase: number;
  readonly heartRateBpm: number;
  /** Fase respiratoria [0,1). */
  readonly respiratoryPhase: number;
  /** Modulación multiplicativa del flujo por respiración. */
  readonly flowModulation: number;
  readonly hemo: HemodynamicState;
}

/** Reloj cardíaco: fase y tiempos de latido para las medidas. */
export class CardiacCycle {
  private readonly starts = [0];
  private readonly intervals: number[] = [];

  constructor(
    readonly bpm: number,
    readonly seed: number,
    readonly respiration: Respiration,
  ) {}

  get periodS(): number {
    return 60 / this.bpm;
  }

  private gaussianAt(k: number): number {
    const u1 = Math.max(Number.EPSILON, hash3(this.seed, k, 0, 0x48525631));
    const u2 = hash3(this.seed, k, 1, 0x48525632);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private rrAt(k: number, tStart: number): number {
    const physiology = FISIOLOGIA.params;
    const rsa = physiology.rsaAmplitude.value * this.respiration.signalAt(tStart);
    const hrv = physiology.hrvSd.value * this.gaussianAt(k);
    return this.periodS * Math.max(0.5, 1 + rsa + hrv);
  }

  private ensureThrough(t: number): void {
    if (this.intervals.length === 0) this.intervals.push(this.rrAt(0, 0));
    while (this.starts[this.starts.length - 1]! + this.intervals[this.intervals.length - 1]! <= t) {
      const k = this.intervals.length;
      const tStart = this.starts[this.starts.length - 1]! + this.intervals[this.intervals.length - 1]!;
      this.intervals.push(this.rrAt(k, tStart));
      this.starts.push(tStart);
    }
  }

  /** Fase en [0,1) según la agenda determinista de latidos. */
  phaseAt(t: number): number {
    if (t <= 0) return 0;
    this.ensureThrough(t);
    let k = this.starts.length - 1;
    while (k > 0 && t < this.starts[k]!) k -= 1;
    const rr = this.intervals[k]!;
    return Math.min(1 - Number.EPSILON, Math.max(0, (t - this.starts[k]!) / rr));
  }

  /** Tiempos de inicio de latido que cubren [t0, t1]. */
  beatsIn(t0: number, t1: number): { tStart: number; rr: number }[] {
    if (t1 < 0) return [];
    this.ensureThrough(t1);
    const beats: { tStart: number; rr: number }[] = [];
    let first = 0;
    while (first + 1 < this.starts.length && this.starts[first]! + this.intervals[first]! < t0) first += 1;
    for (let k = first; k < this.intervals.length && this.starts[k]! <= t1; k += 1) {
      beats.push({ tStart: this.starts[k]!, rr: this.intervals[k]! });
    }
    return beats;
  }
}

/** Forma de onda arterial Windkessel sin dimensiones s(φ) ∈ [0,1]. */
export function arterialShape(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const position = p * arterialShapeTable.length;
  const left = Math.floor(position) % arterialShapeTable.length;
  const right = (left + 1) % arterialShapeTable.length;
  const fraction = position - Math.floor(position);
  return arterialShapeTable[left]! * (1 - fraction) + arterialShapeTable[right]! * fraction;
}

/** Velocidad espacial media del vaso en la fase dada, cm/s. */
export function vesselVelocityCms(v: Vessel, phase: number, modulation = 1, hemo?: HemodynamicState): number {
  // Venoso: flujo cuasi estacionario — ignora la forma arterial y la onda hemodinámica.
  if (v.venous) return v.meanCms * modulation;
  if (hemo) return v.meanCms * hemo.flowFactor * hemo.waveform(phase) * modulation;
  return (v.edvCms + (v.psvCms - v.edvCms) * arterialShape(phase)) * modulation;
}

/** Query de flujo por posición: velocidad de la sangre (mm/s) en un punto. */
export class CerebralFlow {
  constructor(
    readonly scene: VesselScene,
    readonly phys: BasalPhysiology,
  ) {}

  /**
   * Velocidad de la sangre en mm/s en un punto del paciente.
   * Perfil laminar: v(r) = vEje·(1 − 0,85·(r/R)²) dentro del tubo.
   */
  velocityAt(p: Vec3, phase: number, modulation = 1, hemo?: HemodynamicState): Vec3 {
    const v = vesselAt(this.scene, p);
    if (!v) return [0, 0, 0];
    const d = vesselDistance(v, p); // <0 dentro
    const r = v.radiusMm + d; // distancia al eje
    const x = Math.min(1, Math.max(0, r / v.radiusMm));
    const profile = 1 - 0.85 * x * x;
    const uCms = vesselVelocityCms(v, phase, modulation, hemo);
    const dir = normalize(vesselClosest(v, p).tangent);
    return scale(dir, v.flowSign * uCms * 10 * Math.max(0, profile));
  }
}
