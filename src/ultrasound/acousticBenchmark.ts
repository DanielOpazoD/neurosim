/**
 * Banco acústico independiente (DEC-79): compara el modelo gaussiano de haz
 * (`beam.ts`) con la PSF de un dispersor puntual simulada offline por PyMUST
 * (`scripts/acoustic/pymust_psf.py` → `data/acoustic/pymust-psf.json`).
 *
 * El motor externo es una segunda implementación de la acústica lineal, no
 * verdad clínica: sirve para acotar el sesgo del modelo y preregistrar
 * tolerancias antes de ajustarlo.
 */
import type { TransducerKind } from '../domain/contracts';
import { axialFwhmMm, lateralFwhmMm, txLateralFwhmMm, type BeamSpec } from './beam';
import { SPEED_OF_SOUND_M_S } from '../core/units';

export interface BenchmarkPoint {
  readonly depthMm: number;
  readonly steerDeg: number;
  readonly lateralFwhmMm: number;
  readonly axialFwhmMm: number;
  readonly txOneWayFwhmMm: number | null;
  readonly sidelobeDb: number | null;
  readonly peakOffsetMm: readonly [number, number];
}

export interface BenchmarkPreset {
  readonly id: string;
  readonly transducer: TransducerKind;
  readonly frequencyMhz: number;
  readonly apertureMm: number;
  readonly focusMm: number;
  readonly elements: number;
  readonly pitchMm: number;
  readonly points: readonly BenchmarkPoint[];
}

export interface BenchmarkDocument {
  readonly schemaVersion: number;
  readonly engine: {
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly url: string;
    readonly reference: string;
  };
  readonly method: Readonly<Record<string, string | number>>;
  readonly presets: readonly BenchmarkPreset[];
}

export interface BeamComparison {
  readonly presetId: string;
  readonly depthMm: number;
  readonly steerDeg: number;
  /** Ida y vuelta: modelo `lateralFwhmMm` frente a PSF del motor. */
  readonly modelTwoWayMm: number;
  readonly engineTwoWayMm: number;
  readonly twoWayRatio: number;
  /** Solo transmisión: `txLateralFwhmMm` frente a `pfield` (null si el haz desborda la línea medida). */
  readonly modelTxMm: number;
  readonly engineTxMm: number | null;
  readonly txRatio: number | null;
  readonly modelAxialMm: number;
  readonly engineAxialMm: number;
  readonly axialRatio: number;
}

export function presetBeamSpec(preset: BenchmarkPreset): BeamSpec {
  return {
    apertureMm: preset.apertureMm,
    elevationApertureMm: preset.apertureMm,
    focusMm: preset.focusMm,
    elevationFocusMm: preset.focusMm,
    frequencyMhz: preset.frequencyMhz,
    soundSpeedMs: SPEED_OF_SOUND_M_S,
  };
}

export function compareBeamModel(doc: BenchmarkDocument): BeamComparison[] {
  const rows: BeamComparison[] = [];
  for (const preset of doc.presets) {
    const spec = presetBeamSpec(preset);
    for (const pt of preset.points) {
      const modelTwoWayMm = lateralFwhmMm(spec, pt.depthMm);
      const modelTxMm = txLateralFwhmMm(spec, pt.depthMm);
      const modelAxialMm = axialFwhmMm(spec);
      rows.push({
        presetId: preset.id,
        depthMm: pt.depthMm,
        steerDeg: pt.steerDeg,
        modelTwoWayMm,
        engineTwoWayMm: pt.lateralFwhmMm,
        twoWayRatio: modelTwoWayMm / pt.lateralFwhmMm,
        modelTxMm,
        engineTxMm: pt.txOneWayFwhmMm,
        txRatio: pt.txOneWayFwhmMm === null ? null : modelTxMm / pt.txOneWayFwhmMm,
        modelAxialMm,
        engineAxialMm: pt.axialFwhmMm,
        axialRatio: modelAxialMm / pt.axialFwhmMm,
      });
    }
  }
  return rows;
}

export function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) throw new Error('Mediana sin valores');
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}
