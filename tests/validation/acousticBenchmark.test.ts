import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareBeamModel,
  median,
  presetBeamSpec,
  type BenchmarkDocument,
} from '../../src/ultrasound/acousticBenchmark';
import { probeBeamSpec } from '../../src/ultrasound/beam';
import { defaultEyeSettings, defaultTemporalSettings } from '../../src/domain/settings';

const FILE = 'data/acoustic/pymust-psf.json';
const root = resolve(__dirname, '../..');
const raw = readFileSync(resolve(root, FILE), 'utf8');
const doc = JSON.parse(raw) as BenchmarkDocument;
const provenance = readFileSync(resolve(root, 'docs/PROVENANCE.md'), 'utf8');

describe('banco acústico PyMUST (DEC-79): integridad', () => {
  it('motor, versión fijada, licencia y SHA-256 en PROVENANCE', () => {
    expect(doc.schemaVersion).toBe(1);
    expect(doc.engine.name).toBe('PyMUST');
    expect(doc.engine.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(doc.engine.license).toBe('LGPL-3.0');
    expect(doc.engine.reference).toContain('SIMUS');
    const sha = createHash('sha256').update(raw).digest('hex');
    expect(provenance).toContain(sha);
    expect(provenance).toContain(`\`${FILE}\``);
  });

  it('los presets reproducen apertura, frecuencia y foco de probeBeamSpec', () => {
    const eye = defaultEyeSettings();
    const temporal = defaultTemporalSettings();
    const byId = new Map(doc.presets.map((p) => [p.id, p]));
    for (const [id, settings] of [
      ['ocular-lineal', eye],
      ['temporal-sectorial', temporal],
    ] as const) {
      const preset = byId.get(id)!;
      const spec = probeBeamSpec(settings.transducer, settings);
      expect(preset.transducer).toBe(settings.transducer);
      expect(preset.frequencyMhz).toBe(spec.frequencyMhz);
      expect(preset.apertureMm).toBe(spec.apertureMm);
      expect(preset.focusMm).toBe(spec.focusMm);
      expect(presetBeamSpec(preset).apertureMm).toBe(spec.apertureMm);
      expect(preset.points.length).toBeGreaterThanOrEqual(7);
    }
  });

  it('cada punto: PSF centrada en el dispersor, anchuras positivas, lóbulos < −15 dB', () => {
    for (const preset of doc.presets) {
      for (const pt of preset.points) {
        expect(pt.lateralFwhmMm).toBeGreaterThan(0);
        expect(pt.axialFwhmMm).toBeGreaterThan(0);
        expect(Math.abs(pt.peakOffsetMm[0])).toBeLessThan(0.5);
        expect(Math.abs(pt.peakOffsetMm[1])).toBeLessThan(0.5);
        if (pt.sidelobeDb !== null) expect(pt.sidelobeDb).toBeLessThan(-15);
      }
    }
  });
});

describe('banco acústico PyMUST (DEC-79): modelo de haz frente al motor', () => {
  const rows = compareBeamModel(doc);
  // Tolerancias preregistradas (LIM-37) a partir de la primera corrida, ANTES de
  // ajustar el modelo. Si se recalibra beam.ts (R10) hay que mover estas bandas
  // a conciencia y anotar la decisión; no relajarlas para que pase.
  const TWO_WAY_RATIO = [0.5, 0.9] as const;
  const TWO_WAY_MEDIAN = [0.65, 0.78] as const;
  const TX_RATIO = [0.6, 1.8] as const;
  const TX_MEDIAN = [0.95, 1.25] as const;
  const AXIAL_RATIO = [3, 4.5] as const;

  it('ida y vuelta: el modelo es sistemáticamente más estrecho que el motor (ratio 0,5–0,9; mediana ≈ 0,71)', () => {
    for (const r of rows) {
      expect(r.twoWayRatio, `${r.presetId} z${r.depthMm} s${r.steerDeg}`).toBeGreaterThanOrEqual(
        TWO_WAY_RATIO[0],
      );
      expect(r.twoWayRatio, `${r.presetId} z${r.depthMm} s${r.steerDeg}`).toBeLessThanOrEqual(
        TWO_WAY_RATIO[1],
      );
    }
    const m = median(rows.map((r) => r.twoWayRatio));
    expect(m).toBeGreaterThanOrEqual(TWO_WAY_MEDIAN[0]);
    expect(m).toBeLessThanOrEqual(TWO_WAY_MEDIAN[1]);
  });

  it('transmisión (pfield): acuerdo ±10 % en el foco y lejos de él; desviación máxima en el campo cercano', () => {
    const withTx = rows.filter((r) => r.txRatio !== null);
    expect(withTx.length).toBe(rows.length);
    for (const r of withTx) {
      expect(r.txRatio!, `${r.presetId} z${r.depthMm} s${r.steerDeg}`).toBeGreaterThanOrEqual(TX_RATIO[0]);
      expect(r.txRatio!, `${r.presetId} z${r.depthMm} s${r.steerDeg}`).toBeLessThanOrEqual(TX_RATIO[1]);
    }
    const m = median(withTx.map((r) => r.txRatio!));
    expect(m).toBeGreaterThanOrEqual(TX_MEDIAN[0]);
    expect(m).toBeLessThanOrEqual(TX_MEDIAN[1]);
    for (const r of withTx.filter(
      (x) => x.depthMm === doc.presets.find((p) => p.id === x.presetId)!.focusMm && x.steerDeg === 0,
    )) {
      expect(Math.abs(r.txRatio! - 1), `${r.presetId} en el foco`).toBeLessThanOrEqual(0.25);
    }
  });

  it('axial: el pulso heurístico (axialPulseMmMhz) es 3–4,5× más largo que el pulso de 70 % de ancho de banda', () => {
    for (const r of rows) {
      expect(r.axialRatio, `${r.presetId} z${r.depthMm}`).toBeGreaterThanOrEqual(AXIAL_RATIO[0]);
      expect(r.axialRatio, `${r.presetId} z${r.depthMm}`).toBeLessThanOrEqual(AXIAL_RATIO[1]);
    }
  });

  it('el ensanchamiento con la profundidad tiene el mismo sentido en modelo y motor (más allá del foco)', () => {
    for (const preset of doc.presets) {
      const beyond = rows
        .filter((r) => r.presetId === preset.id && r.steerDeg === 0 && r.depthMm >= preset.focusMm)
        .sort((a, b) => a.depthMm - b.depthMm);
      for (let i = 1; i < beyond.length; i++) {
        expect(beyond[i]!.modelTwoWayMm).toBeGreaterThanOrEqual(beyond[i - 1]!.modelTwoWayMm);
        expect(beyond[i]!.engineTwoWayMm).toBeGreaterThanOrEqual(beyond[i - 1]!.engineTwoWayMm);
      }
    }
  });
});
