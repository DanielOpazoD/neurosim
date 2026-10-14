/**
 * Dinámica de la regulación cerebrovascular (DEC-81).
 *
 * Las presiones (PAM, PIC) y la PaCO₂ son entradas que cambian al instante;
 * lo que tarda es la respuesta vascular: la resistencia autorreguladora
 * relaja hacia su valor estacionario con τ_auto (Aaslid 1989, Tiecks 1995) y
 * la reactividad al CO₂ con un retardo de transporte y τ_CO₂ (Poulin 1996).
 * Justo tras un escalón de PAM el flujo es pasivo a la presión
 * (resistencia aún antigua) y después se recupera; con autorregulación
 * «alterada» la resistencia autorreguladora no se mueve de su valor basal y
 * el flujo sigue a la PPC.
 *
 * Las entradas son constantes a trozos, así que la relajación de primer orden
 * tiene solución cerrada: el estado en `t` es determinista y no depende de la
 * cadencia de llamadas (SimulationClock es el único reloj).
 */
import type { BasalPhysiology } from '../domain/contracts';
import {
  autoregulationFactor,
  co2Factor,
  hemodynamics,
  steadyRegulation,
  type HemodynamicInput,
  type HemodynamicState,
  type Regulation,
} from './hemodynamics';
import { FISIOLOGIA } from './params';

export type AutoregulationMode = 'conservada' | 'alterada';

interface Relaxation {
  readonly from: number;
  readonly to: number;
  readonly startS: number;
  readonly tauS: number;
}

function relax(r: Relaxation, t: number): number {
  if (t <= r.startS) return r.from;
  return r.to + (r.from - r.to) * Math.exp(-(t - r.startS) / r.tauS);
}

function settled(r: Relaxation, t: number): boolean {
  return Math.abs(relax(r, t) - r.to) < 1e-6;
}

export class RegulationDynamics {
  private input: HemodynamicInput;
  private auto: Relaxation;
  private co2: Relaxation;
  private steady: HemodynamicState;
  private readonly basalCvrAuto: number;

  constructor(
    physiology: BasalPhysiology,
    readonly mode: AutoregulationMode = 'conservada',
  ) {
    this.input = pick(physiology);
    this.basalCvrAuto = steadyRegulation(basalInput()).cvrAutoRatio;
    const reg = this.targetRegulation(this.input);
    this.auto = { from: reg.cvrAutoRatio, to: reg.cvrAutoRatio, startS: 0, tauS: 1 };
    this.co2 = { from: reg.co2Factor, to: reg.co2Factor, startS: 0, tauS: 1 };
    this.steady = hemodynamics(this.input, reg);
  }

  /** Regulación estacionaria para unas entradas, según el modo. */
  targetRegulation(inp: HemodynamicInput): Regulation {
    const steady = steadyRegulation(inp);
    if (this.mode === 'alterada') {
      // Pasiva a la presión: resistencia autorreguladora fija en la basal.
      return { cvrAutoRatio: this.basalCvrAuto, co2Factor: steady.co2Factor };
    }
    return steady;
  }

  /**
   * Nuevo objetivo. Sin `atS` el cambio es instantáneo (estado estacionario,
   * comportamiento previo); con `atS` la regulación parte de su valor actual
   * en ese instante y relaja hacia el nuevo estacionario.
   */
  setTarget(physiology: BasalPhysiology, atS?: number): void {
    const next = pick(physiology);
    const reg = this.targetRegulation(next);
    if (atS === undefined) {
      this.auto = { from: reg.cvrAutoRatio, to: reg.cvrAutoRatio, startS: 0, tauS: 1 };
      this.co2 = { from: reg.co2Factor, to: reg.co2Factor, startS: 0, tauS: 1 };
    } else {
      const p = FISIOLOGIA.params;
      const autoNow = relax(this.auto, atS);
      const co2Now = relax(this.co2, atS);
      this.auto = { from: autoNow, to: reg.cvrAutoRatio, startS: atS, tauS: p.autoregTauS.value };
      this.co2 = {
        from: co2Now,
        to: reg.co2Factor,
        startS: atS + p.co2DelayS.value,
        tauS: p.co2TauS.value,
      };
    }
    this.input = next;
    this.steady = hemodynamics(next, reg);
  }

  regulationAt(t: number): Regulation {
    return { cvrAutoRatio: relax(this.auto, t), co2Factor: relax(this.co2, t) };
  }

  /** ¿Queda transitorio pendiente en `t`? */
  settledAt(t: number): boolean {
    return settled(this.auto, t) && settled(this.co2, t);
  }

  /** Estado hemodinámico en `t`; devuelve el objeto estacionario cacheado si ya no hay transitorio. */
  hemodynamicsAt(t: number): HemodynamicState {
    if (this.settledAt(t)) return this.steady;
    return hemodynamics(this.input, this.regulationAt(t));
  }

  get steadyState(): HemodynamicState {
    return this.steady;
  }

  /** Factores estacionarios de referencia (docencia/pruebas). */
  static steadyFactors(inp: HemodynamicInput): { autoregulation: number; co2: number } {
    return { autoregulation: autoregulationFactor(inp.mapMmHg - inp.icpMmHg), co2: co2Factor(inp.paco2MmHg) };
  }
}

function pick(p: BasalPhysiology): HemodynamicInput {
  return { mapMmHg: p.mapMmHg, paco2MmHg: p.paco2MmHg, icpMmHg: p.icpMmHg };
}

function basalInput(): HemodynamicInput {
  return {
    mapMmHg: FISIOLOGIA.params.mapMmHg.value,
    paco2MmHg: 40,
    icpMmHg: FISIOLOGIA.params.icpMmHg.value,
  };
}
