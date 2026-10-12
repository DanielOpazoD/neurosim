import { expect, it } from 'vitest';
import { colorSampleGeometry } from '../../src/doppler/color';
import { beamDirAt, buildScan } from '../../src/ultrasound/probe';
const pose = {
  origin: [0, 0, 0] as [number, number, number],
  forward: [0, 0, 1] as [number, number, number],
  lateral: [1, 0, 0] as [number, number, number],
  markerAngleRad: 0,
  contactPressure: 0,
};
it('convierte apertura angular a milímetros y crece con profundidad', () => {
  const scan = buildScan(pose, 'sector', 64);
  const a = colorSampleGeometry(scan, pose, 0.3, 40, 0.02),
    b = colorSampleGeometry(scan, pose, 0.3, 80, 0.02);
  expect(a.lateralHalf).toBeCloseTo(40 * Math.tan(0.01), 10);
  expect(b.lateralHalf).toBeCloseTo(2 * a.lateralHalf, 10);
});
it('la base tangencial es perpendicular al haz fuera del eje', () => {
  const scan = buildScan(pose, 'sector', 64),
    u = 0.4;
  const g = colorSampleGeometry(scan, pose, u, 50, 0.02),
    axial = beamDirAt(pose, 'sector', u);
  expect(g.lateral.reduce((s, x, i) => s + x * axial[i]!, 0)).toBeCloseTo(0, 10);
  expect(Math.hypot(...g.lateral)).toBeCloseTo(1, 10);
});
it('conserva la anchura física y base de una sonda lineal', () => {
  const scan = buildScan(pose, 'linear', 64),
    g = colorSampleGeometry(scan, pose, 4, 50, 2);
  expect(g.lateralHalf).toBe(1);
  expect(g.lateral).toEqual([1, 0, 0]);
});
