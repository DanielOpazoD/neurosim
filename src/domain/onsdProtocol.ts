import type { Measurement, Side } from './contracts';
import { FISIOLOGIA } from '../physiology/params';

export type OnsdPlane = 'transversal' | 'sagital';
export interface OnsdSlot {
  readonly side: Side;
  readonly plane: OnsdPlane;
}
export type OnsdKey = `${Side}-${OnsdPlane}`;

export interface OnsdProtocolState {
  readonly slots: ReadonlyArray<OnsdSlot>;
  readonly dvno: Partial<Record<OnsdKey, Measurement>>;
  readonly dte: Partial<Record<Side, Measurement>>;
}

export interface OnsdReport {
  perSide: Record<Side, { dvnoMeanMm?: number; dvnoValuesMm: number[]; dteMm?: number; ratio?: number }>;
  bilateralMeanMm?: number;
  asymmetryMm?: number;
  complete: boolean;
  flags: string[];
}

export const ONSD_SLOTS: readonly OnsdSlot[] = [
  { side: 'der', plane: 'transversal' },
  { side: 'der', plane: 'sagital' },
  { side: 'izq', plane: 'transversal' },
  { side: 'izq', plane: 'sagital' },
];

export function createOnsdProtocolState(): OnsdProtocolState {
  return { slots: ONSD_SLOTS, dvno: {}, dte: {} };
}

export function planeForRotation(rotDeg: number): OnsdPlane {
  const mod = ((rotDeg % 180) + 180) % 180;
  return mod < 45 || mod >= 135 ? 'transversal' : 'sagital';
}

export function nextSlot(state: OnsdProtocolState): OnsdSlot | null {
  return state.slots.find((slot) => !state.dvno[`${slot.side}-${slot.plane}`]) ?? null;
}

export function addProtocolMeasurement(
  state: OnsdProtocolState,
  slot: OnsdSlot,
  measurement: Measurement,
): OnsdProtocolState {
  return {
    ...state,
    dvno: { ...state.dvno, [`${slot.side}-${slot.plane}`]: measurement },
  };
}

function valuesFor(state: OnsdProtocolState, side: Side): number[] {
  return state.slots
    .filter((slot) => slot.side === side)
    .map((slot) => state.dvno[`${slot.side}-${slot.plane}`]?.value)
    .filter((value): value is number => Number.isFinite(value));
}

export function buildReport(state: OnsdProtocolState): OnsdReport {
  const perSide = {} as OnsdReport['perSide'];
  for (const side of ['der', 'izq'] as const) {
    const dvnoValuesMm = valuesFor(state, side);
    const dvnoMeanMm = dvnoValuesMm.length
      ? dvnoValuesMm.reduce((sum, value) => sum + value, 0) / dvnoValuesMm.length
      : undefined;
    const dteMm = state.dte[side]?.value;
    perSide[side] = {
      dvnoValuesMm,
      dvnoMeanMm,
      dteMm,
      ratio: dvnoMeanMm !== undefined && dteMm !== undefined ? dvnoMeanMm / dteMm : undefined,
    };
  }

  const means = (['der', 'izq'] as const)
    .map((side) => perSide[side].dvnoMeanMm)
    .filter((value): value is number => value !== undefined);
  const bilateralMeanMm = means.length === 2 ? (means[0]! + means[1]!) / 2 : undefined;
  const asymmetryMm = means.length === 2 ? Math.abs(means[0]! - means[1]!) : undefined;
  const complete =
    state.slots.every((slot) => state.dvno[`${slot.side}-${slot.plane}`] !== undefined) &&
    (['der', 'izq'] as const).every((side) => state.dte[side] !== undefined);
  const flags: string[] = [];
  if (bilateralMeanMm !== undefined && bilateralMeanMm > FISIOLOGIA.params.onsdCutoffMm.value)
    flags.push('dvno-elevado');
  if (
    (['der', 'izq'] as const).some(
      (side) => (perSide[side].ratio ?? 0) > FISIOLOGIA.params.onsdEtdRatioCutoff.value,
    )
  )
    flags.push('ratio-elevado');
  if (asymmetryMm !== undefined && asymmetryMm > 0.5) flags.push('asimetria');
  if (!state.slots.every((slot) => state.dvno[`${slot.side}-${slot.plane}`] !== undefined))
    flags.push('plano-incompleto');
  if (
    (['der', 'izq'] as const).some((side) => {
      const value = perSide[side].dteMm;
      return value !== undefined && (value < 20 || value > 26);
    })
  )
    flags.push('dte-fuera-de-rango');
  return { perSide, bilateralMeanMm, asymmetryMm, complete, flags };
}
