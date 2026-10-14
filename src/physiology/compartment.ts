/**
 * Compartimento intracraneal (DEC-82): la PIC emerge del volumen, no es una
 * entrada.
 *
 * Doctrina de Monro–Kellie con dos ingredientes clásicos:
 *   · curva presión–volumen exponencial de Marmarou: P = P₀·10^(ΔV/PVI), con
 *     PVI el volumen que multiplica la presión por 10 (≈ 26 mL en el adulto);
 *   · balance de LCR de Davson: dV_LCR/dt = I_f − (P − P_ss)/R_out, con
 *     formación I_f, resistencia de salida R_out y presión del seno sagital
 *     P_ss. En reposo P₀ = P_ss + I_f·R_out.
 *
 * Un volumen añadido (lesión, edema) sube la PIC al instante por la curva;
 * después el LCR se desplaza hacia el raquis/absorción y la PIC baja en
 * minutos (τ ≈ PVI·R_out/(ln10·P)) hasta agotar la reserva desplazable
 * (`csfDisplaceableMl`): a partir de ahí la PIC queda sostenida. Con un
 * drenaje (volumen negativo) ocurre lo simétrico con la reserva en sentido
 * contrario (acumulación de LCR hasta `csfDisplaceableMl`).
 *
 * Integración explícita con paso fijo desde el último evento (entradas
 * constantes a trozos): determinista e independiente de la cadencia de
 * render; SimulationClock es el único reloj.
 */
import { FISIOLOGIA } from './params';

export interface CompartmentParams {
  readonly pviMl: number;
  readonly csfFormationMlMin: number;
  readonly csfOutflowResistance: number; // mmHg·min/mL
  readonly csfDisplaceableMl: number;
  readonly icp0MmHg: number;
  /** Saturación de la curva (la exponencial no se extrapola más allá). */
  readonly icpCapMmHg: number;
}

export interface CompartmentState {
  readonly t: number;
  /** Volumen añadido por lesión/edema (positivo) o drenado (negativo), mL. */
  readonly lesionVolumeMl: number;
  /** LCR desplazado fuera del cráneo (positivo) respecto al reposo, mL; |x| ≤ csfDisplaceableMl. */
  readonly csfDisplacedMl: number;
}

const DT_MIN = 1 / 60; // 1 s de paso de integración

export function defaultCompartmentParams(): CompartmentParams {
  const p = FISIOLOGIA.params;
  return {
    pviMl: p.pviMl.value,
    csfFormationMlMin: p.csfFormationMlMin.value,
    csfOutflowResistance: p.csfOutflowResistanceMmHgMinMl.value,
    csfDisplaceableMl: p.csfDisplaceableMl.value,
    icp0MmHg: p.icpMmHg.value,
    icpCapMmHg: p.icpCapMmHg.value,
  };
}

/** PIC de la curva de Marmarou para un volumen neto añadido. */
export function icpForVolume(p: CompartmentParams, netVolumeMl: number): number {
  return Math.min(p.icpCapMmHg, p.icp0MmHg * Math.pow(10, netVolumeMl / p.pviMl));
}

/** Volumen neto necesario para una PIC (inversa de la curva). */
export function volumeForIcp(p: CompartmentParams, icpMmHg: number): number {
  return p.pviMl * Math.log10(Math.max(1e-3, icpMmHg) / p.icp0MmHg);
}

/** Compliance local dV/dP (mL/mmHg) en una PIC dada. */
export function complianceMlPerMmHg(p: CompartmentParams, icpMmHg: number): number {
  return p.pviMl / (Math.LN10 * Math.max(1e-3, icpMmHg));
}

/**
 * Volumen de lesión que sostiene una PIC en estado estacionario: la reserva
 * de LCR agotada en el sentido correspondiente más el volumen residual de la
 * curva. PIC = PIC₀ ⇒ 0.
 */
export function steadyLesionVolumeForIcp(p: CompartmentParams, icpMmHg: number): number {
  const residual = volumeForIcp(p, icpMmHg);
  if (Math.abs(residual) < 1e-9) return 0;
  return residual + Math.sign(residual) * p.csfDisplaceableMl;
}

export class IntracranialCompartment {
  private state: CompartmentState;
  readonly sinusMmHg: number;

  constructor(
    readonly params: CompartmentParams = defaultCompartmentParams(),
    initial?: Partial<CompartmentState>,
  ) {
    this.sinusMmHg = params.icp0MmHg - params.csfFormationMlMin * params.csfOutflowResistance;
    this.state = {
      t: initial?.t ?? 0,
      lesionVolumeMl: initial?.lesionVolumeMl ?? 0,
      csfDisplacedMl: initial?.csfDisplacedMl ?? 0,
    };
  }

  /** Estado estacionario para una PIC objetivo (casos clínicos): reserva agotada + residual. */
  static steadyForIcp(
    icpMmHg: number,
    base: CompartmentParams = defaultCompartmentParams(),
  ): IntracranialCompartment {
    // Un caso puede declarar una PIC por encima de la saturación (parada
    // circulatoria): la curva se extiende hasta ella para que sea estacionaria.
    const params = icpMmHg > base.icpCapMmHg ? { ...base, icpCapMmHg: icpMmHg } : base;
    const lesion = steadyLesionVolumeForIcp(params, icpMmHg);
    const displaced = Math.max(-params.csfDisplaceableMl, Math.min(params.csfDisplaceableMl, lesion));
    return new IntracranialCompartment(params, { lesionVolumeMl: lesion, csfDisplacedMl: displaced });
  }

  get current(): CompartmentState {
    return this.state;
  }

  netVolumeAt(t: number): number {
    const s = this.stateAt(t);
    return s.lesionVolumeMl - s.csfDisplacedMl;
  }

  icpAt(t: number): number {
    return icpForVolume(this.params, this.netVolumeAt(t));
  }

  /** PIC a la que tiende la configuración actual si se deja evolucionar. */
  steadyIcp(): number {
    const { lesionVolumeMl } = this.state;
    const d = this.params.csfDisplaceableMl;
    if (Math.abs(lesionVolumeMl) <= d) return this.params.icp0MmHg;
    return icpForVolume(this.params, lesionVolumeMl - Math.sign(lesionVolumeMl) * d);
  }

  /** Reserva compensatoria restante (mL) en el sentido de la lesión actual. */
  reserveMlAt(t: number): number {
    const s = this.stateAt(t);
    const dir = s.lesionVolumeMl >= 0 ? 1 : -1;
    return this.params.csfDisplaceableMl - dir * s.csfDisplacedMl;
  }

  complianceAt(t: number): number {
    return complianceMlPerMmHg(this.params, this.icpAt(t));
  }

  /** Cambia el volumen de lesión en `atS` (escalón); el LCR parte de su estado en ese instante. */
  setLesionVolume(lesionVolumeMl: number, atS: number): void {
    const s = this.stateAt(atS);
    this.state = { t: atS, lesionVolumeMl, csfDisplacedMl: s.csfDisplacedMl };
  }

  /** Integra el balance de LCR desde el último evento hasta `t` (paso fijo de 1 s). */
  stateAt(t: number): CompartmentState {
    const s = this.state;
    if (t <= s.t) return s;
    const p = this.params;
    const minutes = (t - s.t) / 60;
    const steps = Math.ceil(minutes / DT_MIN);
    const dt = minutes / steps;
    let displaced = s.csfDisplacedMl;
    for (let i = 0; i < steps; i++) {
      const icp = icpForVolume(p, s.lesionVolumeMl - displaced);
      const outflow = (icp - this.sinusMmHg) / p.csfOutflowResistance - p.csfFormationMlMin; // mL/min netos que salen
      displaced = Math.max(-p.csfDisplaceableMl, Math.min(p.csfDisplaceableMl, displaced + outflow * dt));
    }
    return { t, lesionVolumeMl: s.lesionVolumeMl, csfDisplacedMl: displaced };
  }

  /** Consolida el estado integrado hasta `t` (evita reintegrar largos periodos). */
  advanceTo(t: number): void {
    this.state = this.stateAt(t);
  }
}
