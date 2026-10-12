import { expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { defaultTemporalSettings } from '../../src/domain/settings';
import { renderColorDoppler } from '../../src/doppler/color';
import { buildScan } from '../../src/ultrasound/probe';
import { temporalPose } from './helpers';

it('una pérdida de transmisión severa degrada coherencia y precisión, sin atenuar el ruido receptor', () => {
  const sim = buildReferenceCase(),
    settings = defaultTemporalSettings(),
    pose = temporalPose(sim, 'der');
  const render = (loss: number) =>
    renderColorDoppler(
      { ...sim.head, attenuationDb: () => loss },
      sim.flow,
      buildScan(pose, 'sector', 64),
      pose,
      settings,
      sim.patient.seed,
      0.2,
      settings.colorBox,
    );
  const high = render(0),
    low = render(120);
  let count = 0,
    varianceHigh = 0,
    varianceLow = 0,
    velocityError = 0;
  for (let i = 0; i < high.vel.length; i++)
    if (Number.isFinite(high.vel[i]) && Number.isFinite(low.vel[i])) {
      count++;
      varianceHigh += high.variance[i]!;
      varianceLow += low.variance[i]!;
      velocityError += Math.abs(high.vel[i]! - low.vel[i]!);
    }
  expect(count).toBeGreaterThan(10);
  expect(varianceLow / count).toBeGreaterThan(varianceHigh / count + 0.1);
  expect(velocityError / count).toBeGreaterThan(5);
});
