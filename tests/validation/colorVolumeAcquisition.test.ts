import { expect, it } from 'vitest';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import { defaultTemporalSettings } from '../../src/domain/settings';
import { temporalPose } from './helpers';
import { renderColorDoppler } from '../../src/doppler/color';
import { buildScan } from '../../src/ultrasound/probe';
it('la misma adquisición física conserva mapas al cambiar el eje de referencia sectorial', () => {
  const sim = buildReferenceCase(),
    settings = defaultTemporalSettings(),
    basePose = temporalPose(sim, 'der'),
    angle = 0.2;
  const rotated = {
    ...basePose,
    forward: basePose.forward.map((v, i) => v * Math.cos(angle) + basePose.lateral[i]! * Math.sin(angle)) as [
      number,
      number,
      number,
    ],
    lateral: basePose.lateral.map((v, i) => v * Math.cos(angle) - basePose.forward[i]! * Math.sin(angle)) as [
      number,
      number,
      number,
    ],
  };
  const run = (p: typeof basePose, center: number) =>
    renderColorDoppler(sim.head, sim.flow, buildScan(p, 'sector', 64), p, settings, sim.patient.seed, 0.2, {
      ...settings.colorBox,
      uCenter: center,
    });
  const a = run(basePose, settings.colorBox.uCenter),
    b = run(rotated, settings.colorBox.uCenter - angle);
  let count = 0;
  for (let i = 0; i < a.vel.length; i++) {
    expect(Number.isFinite(b.vel[i])).toBe(Number.isFinite(a.vel[i]));
    if (Number.isFinite(a.vel[i])) {
      count++;
      expect(Math.abs(a.vel[i]! - b.vel[i]!)).toBeLessThan(1e-3);
      expect(Math.abs(a.pow[i]! - b.pow[i]!)).toBeLessThan(1e-5);
    }
  }
  expect(count).toBeGreaterThan(10);
});
