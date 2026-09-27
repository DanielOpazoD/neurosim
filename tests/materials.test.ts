import { describe, expect, it } from 'vitest';
import { attenuationDbCm, MATERIALS } from '../src/anatomy/materials';
import { linesFor } from '../src/ultrasound/probe';

describe('materiales acústicos', () => {
  it('registra exponentes físicamente acotados', () => {
    for (const material of Object.values(MATERIALS)) {
      expect(material.attenuationExponent).toBeGreaterThanOrEqual(1);
      expect(material.attenuationExponent).toBeLessThanOrEqual(2.2);
    }
  });

  it('conserva la atenuación ósea de referencia a 2 MHz', () => {
    expect(attenuationDbCm(MATERIALS.hueso, 2)).toBeCloseTo(16, 10);
  });

  it('mapea densidad de líneas sin alterar la densidad media histórica', () => {
    expect(linesFor('baja')).toBe(128);
    expect(linesFor('media')).toBe(176);
    expect(linesFor('alta')).toBe(256);
  });
});
