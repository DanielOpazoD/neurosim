import { describe, expect, it } from 'vitest';
import type { MaterialId } from '../../src/anatomy/materials';
import { defaultTemporalSettings } from '../../src/domain/settings';
import { renderBMode, type SceneQuery } from '../../src/ultrasound/bmode';
import { buildScan } from '../../src/ultrasound/probe';

const scan = buildScan(
  { origin: [0, 0, 0], forward: [0, 0, 1], lateral: [1, 0, 0], markerAngleRad: 0, contactPressure: 0 },
  'sector',
  1,
);
const dz = 0.025;
const render = (scene: SceneQuery, frequencyMhz = 2, speckle = false) =>
  renderBMode(
    scene,
    scan,
    { ...defaultTemporalSettings(), frequencyMhz, depthMm: 50, outputPowerDb: 0 },
    'recorridos-artefactos',
    { axialStepMm: dz, speckle, electronicNoise: false, lateralInterfaces: false, txFocusGain: false },
  );
const lossBetween = (a: number, b: number) => -20 * Math.log10(Math.abs(b / a));
const signalRows = (frame: ReturnType<typeof render>) =>
  Array.from({ length: frame.height }, (_, z) => z).filter((z) => Math.abs(frame.iq[z * 2]!) > 1e-12);

describe('recorridos y pérdidas de artefactos B-mode (DEC-84)', () => {
  for (const frequency of [2, 4]) {
    it(`reverberación a ${frequency} MHz: cada retorno repite toda la pérdida primaria`, () => {
      const make = (extraDb: number) =>
        render(
          {
            classify: (p) => (p[2] < 10 ? 'vitrio' : 'hueso'),
            interfaceLossDb: () => extraDb,
          },
          frequency,
        );
      const base = make(0);
      const weak = make(10);
      const primary = signalRows(base)[0]!;
      for (const order of [1, 2, 3]) {
        const row = primary * order;
        expect(Math.abs(base.iq[row * 2]!)).toBeGreaterThan(1e-8);
        expect(lossBetween(base.iq[row * 2]!, weak.iq[row * 2]!)).toBeCloseTo(10 * order, 5);
      }
    });
  }

  it('el espejo conserva la señal primaria y absorbe dos veces el tramo fuente–reflector', () => {
    const make = (extraDb: number) =>
      render(
        {
          classify: (p) => (p[2] < 20 ? 'vitrio' : 'hueso'),
          scatterScale: (p) => (p[2] > 10 && p[2] < 11 ? 1 : 0),
          interfaceLossDb: () => extraDb,
        },
        2,
        true,
      );
    const base = make(0);
    const weak = make(10);
    let count = 0;
    for (let row = 0; row < base.height; row++) {
      if (Math.abs(base.iq[row * 2 + 1]!) < 1e-10) continue;
      const displayedMm = row * dz;
      if (displayedMm < 15) {
        expect(weak.iq[row * 2 + 1]).toBe(base.iq[row * 2 + 1]);
      } else {
        expect(lossBetween(base.iq[row * 2 + 1]!, weak.iq[row * 2 + 1]!)).toBeCloseTo(20, 5);
        count++;
      }
    }
    expect(count).toBeGreaterThan(10);
  });

  for (const thickness of [0.5, 1]) {
    it(`cola de cometa: separación por tiempo de tránsito en lámina de ${thickness} mm`, () => {
      const scene: SceneQuery = {
        classify: (p): MaterialId => (p[2] < 10 || p[2] >= 10 + thickness ? 'vitrio' : 'hueso'),
      };
      const frame = render(scene);
      const [entry, exit, ...tail] = signalRows(frame).filter((z) => z * dz < 15);
      expect(entry).toBeDefined();
      expect(exit).toBeDefined();
      const spacing = exit! - entry!;
      expect(tail).toEqual(Array.from({ length: 6 }, (_, n) => exit! + (n + 1) * spacing));
    });

    it(`cola de cometa de ${thickness} mm: absorción primaria y de cada vuelta interna`, () => {
      const make = (entryDb: number, exitDb: number) =>
        render({
          classify: (p): MaterialId => (p[2] < 10 || p[2] >= 10 + thickness ? 'vitrio' : 'hueso'),
          interfaceLossDb: (_p, _from, to) => (to === 'hueso' ? entryDb : exitDb),
        });
      const base = make(0, 0);
      const frontLoss = make(6, 0);
      const layerLoss = make(0, 10);
      const [entry, exit] = signalRows(base);
      const spacing = exit! - entry!;
      for (let n = 1; n <= 6; n++) {
        const row = exit! + n * spacing;
        expect(Math.abs(base.iq[row * 2]!)).toBeGreaterThan(1e-8);
        expect(lossBetween(base.iq[row * 2]!, frontLoss.iq[row * 2]!)).toBeCloseTo(6, 5);
        expect(lossBetween(base.iq[row * 2]!, layerLoss.iq[row * 2]!)).toBeCloseTo(10 * (n + 1), 5);
      }
    });
  }
});
