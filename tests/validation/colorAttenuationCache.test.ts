import { expect, it, vi } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { defaultTemporalSettings } from '../../src/domain/settings';
import { COLOR_COLS, COLOR_ROWS, renderColorDoppler } from '../../src/doppler/color';
import { buildScan } from '../../src/ultrasound/probe';
import { temporalPose } from './helpers';

it('cada fila y grupo lateral adquiere su propia atenuación sin colisiones', () => {
  const sim = buildReferenceCase(),
    settings = defaultTemporalSettings(),
    pose = temporalPose(sim, 'der');
  const attenuationDb = vi.fn(() => 0);
  const scene = {
    ...sim.head,
    vessels: [
      {
        ...sim.head.vessels[0]!,
        radiusMm: 10000,
        aabb: {
          min: [-10000, -10000, -10000] as [number, number, number],
          max: [10000, 10000, 10000] as [number, number, number],
        },
      },
    ],
    attenuationDb,
  };
  renderColorDoppler(
    scene,
    sim.flow,
    buildScan(pose, 'sector', 64),
    pose,
    settings,
    sim.patient.seed,
    0.2,
    settings.colorBox,
  );
  expect(attenuationDb).toHaveBeenCalledTimes(COLOR_ROWS * Math.ceil(COLOR_COLS / 4));
});
