import { describe, expect, it } from 'vitest';
import { MATERIALS, type MaterialId } from '../../src/anatomy/materials';
import type { AcquisitionSettings, ProbePose } from '../../src/domain/contracts';
import { defaultEyeSettings } from '../../src/domain/settings';
import { renderBMode } from '../../src/ultrasound/bmode';
import { buildScan } from '../../src/ultrasound/probe';
import { FISICA_US } from '../../src/ultrasound/params';

const pose: ProbePose = {
  origin: [0, 0, 0],
  forward: [0, 0, 1],
  lateral: [1, 0, 0],
  markerAngleRad: 0,
  contactPressure: 0,
};

function settings(depthMm = 60, focusMm = 15): AcquisitionSettings {
  return { ...defaultEyeSettings(), depthMm, focusMm, frequencyMhz: 7.5 };
}

function frameFor(classify: (p: [number, number, number]) => MaterialId, s: AcquisitionSettings) {
  const scan = buildScan(pose, 'linear', 65);
  return renderBMode({ classify }, scan, s, 'focal-lateral-validation', {
    axialStepMm: 0.1,
    speckle: false,
    electronicNoise: false,
  });
}

function peakAt(frame: ReturnType<typeof frameFor>, line: number, targetMm: number, windowMm = 0.4): number {
  const row = Math.round((targetMm / frame.depthMm) * (frame.height - 1));
  const radius = Math.max(1, Math.round((windowMm / frame.depthMm) * frame.height));
  let best = -Infinity;
  for (let zi = Math.max(0, row - radius); zi <= Math.min(frame.height - 1, row + radius); zi++) {
    best = Math.max(best, frame.db[zi * frame.width + line]!);
  }
  return best;
}

describe('DEC-64 · ganancia de zona focal e interfaces laterales', () => {
  it('la misma interfaz es más brillante cuando el foco cae sobre ella', () => {
    const classify = (p: [number, number, number]) => (p[2] < 15 ? 'vitrio' : 'esclera');
    const line = Math.floor(buildScan(pose, 'linear', 65).lineCount / 2);
    const nearFocus = peakAt(frameFor(classify, settings(60, 15)), line, 15);
    const farFocus = peakAt(frameFor(classify, settings(60, 45)), line, 15);
    // Pico lorentziano: en el foco ≈ +txFocusGainDb; a 30 mm de la zona ≈ 0.
    expect(nearFocus - farFocus).toBeGreaterThan(FISICA_US.params.txFocusGainDb.value - 2);
  });

  it('una pared paralela al haz produce eco en sus bordes laterales', () => {
    // Muro de esclera |x| < 0.8 mm en vítreo: sin cambio axial de material el
    // interior no da eco; la frontera |x| ≈ 0.8 sí (interfaz lateral).
    const frame = frameFor((p) => (Math.abs(p[0]) < 0.8 ? 'esclera' : 'vitrio'), settings(60, 15));
    const scan = frame.scan;
    const xs = scan.lines.map((l) => l.origin[0]);
    const center = xs.reduce((b, x, i) => (Math.abs(x) < Math.abs(xs[b]!) ? i : b), 0);
    const edge = xs.reduce(
      (b, x, i) => (Math.abs(Math.abs(x) - 0.8) < Math.abs(Math.abs(xs[b]!) - 0.8) ? i : b),
      0,
    );
    const interior = peakAt(frame, center, 30, 2);
    const wall = peakAt(frame, edge, 30, 2);
    // La esclera contra vítreo tiene rc ≈ 0.078: el borde queda >15 dB sobre
    // el interior sin speckle (solo fondo de escena).
    expect(wall - interior).toBeGreaterThan(15);
  });

  it('el coeficiente de reflexión usado en bordes laterales es simétrico', () => {
    const a = MATERIALS.esclera;
    const b = MATERIALS.vitrio;
    expect(Math.abs((a.zMrayl - b.zMrayl) / (a.zMrayl + b.zMrayl))).toBeGreaterThan(0.05);
  });
});
