import { expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { defaultTemporalSettings } from '../../src/domain/settings';
import { renderColorDoppler } from '../../src/doppler/color';
import { buildScan } from '../../src/ultrasound/probe';
import { temporalPose } from './helpers';

it('la ganancia cambia potencia y aceptación, sin cambiar velocidad ni varianza comunes', () => {
  const sim = buildReferenceCase();
  const pose = temporalPose(sim, 'der');
  const settings = defaultTemporalSettings();
  const render = (dopplerGainDb: number) =>
    renderColorDoppler(
      { ...sim.head, attenuationDb: () => 70 },
      sim.flow,
      buildScan(pose, 'sector', 64),
      pose,
      { ...settings, dopplerGainDb },
      sim.patient.seed,
      0.2,
      settings.colorBox,
    );
  const low = render(-10),
    high = render(0);
  let common = 0,
    changed = 0;
  for (let i = 0; i < low.pow.length; i++) {
    if (Number.isFinite(low.vel[i]) && Number.isFinite(high.vel[i])) {
      common++;
      expect(high.vel[i]).toBe(low.vel[i]);
      expect(high.variance[i]).toBe(low.variance[i]);
      expect(high.pow[i]).toBeCloseTo(Math.min(1, low.pow[i]! * 10), 5);
      if (high.pow[i]! > low.pow[i]! + 0.01) changed++;
    }
  }
  expect(common).toBeGreaterThan(10);
  expect(changed).toBeGreaterThan(10);
  expect(high.vel.filter(Number.isFinite).length).toBeGreaterThan(low.vel.filter(Number.isFinite).length);
});
