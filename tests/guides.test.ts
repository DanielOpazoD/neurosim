import { describe, expect, it } from 'vitest';
import {
  advance,
  completedSince,
  currentStep,
  GUIDE_HINT_DELAY_MS,
  GUIDE_HOLD_MS,
  guideForStation,
  guideSummary,
  hintVisible,
  isGuideDone,
  nextStep,
  ONSD_GUIDE,
  pauseGuide,
  prevStep,
  resetGuide,
  resumeGuide,
  startGuide,
  TCD_GUIDE,
  type GuideContext,
  type GuideMeasurement,
  type GuideProgress,
  type GuideStep,
  type GuideTruth,
} from '../src/domain/guides';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { createInitialState } from '../src/app/state';
import { eyeNerveImageU, guideTruth, measurementRetroOffsetMm } from '../src/app/guideContext';
import { fromEyeLocal, nerveCenterline, sheathRadiiAt } from '../src/anatomy/eye';
import { add, scale } from '../src/core/vec3';
import { DebriefLog, guideSections } from '../src/app/debrief';
import type { Measurement } from '../src/domain/contracts';

function ctx(overrides: Partial<GuideContext> = {}): GuideContext {
  return {
    station: 'ojo',
    side: 'der',
    tiltDeg: 0,
    rotDeg: 0,
    offsetMm: 0,
    offsetVMm: 0,
    depthMm: 45,
    gainDb: 6,
    colorOn: false,
    pwOn: false,
    frozen: false,
    gate: { depthMm: 52, uMm: 0, dominantVesselId: null, bloodFraction: 0 },
    insonationRealDeg: null,
    mca: null,
    measurements: [],
    onsdSlots: [],
    nerveImageUMm: 0,
    ...overrides,
  };
}

const dvno = (side: 'der' | 'izq', rotDeg: number, value = 4.6, offsetMm = 3): GuideMeasurement => ({
  kind: 'dvno',
  value,
  side,
  referenceOffsetMm: 3,
  offsetMm,
  rotDeg,
});

const step = (guide: typeof ONSD_GUIDE, id: string): GuideStep => guide.steps.find((s) => s.id === id)!;

const M1 = { depthMm: 55, uMm: 0.12, dominantVesselId: 'm1-der', bloodFraction: 0.6 };
const MCA = { psvCms: 90, edvCms: 40, pi: 0.85, taMaxCms: 60, beats: 3 };

describe('guías: selección', () => {
  it('elige la guía por examen', () => {
    expect(guideForStation('ojo').id).toBe('vaina');
    expect(guideForStation('temporal').id).toBe('dtc');
    expect(ONSD_GUIDE.exam).toBe('vaina');
    expect(TCD_GUIDE.exam).toBe('dtc');
    expect(ONSD_GUIDE.steps).toHaveLength(7);
    expect(TCD_GUIDE.steps).toHaveLength(7);
  });

  it('cada paso tiene instrucción breve en español e id único', () => {
    for (const guide of [ONSD_GUIDE, TCD_GUIDE]) {
      expect(new Set(guide.steps.map((s) => s.id)).size).toBe(guide.steps.length);
      for (const s of guide.steps) {
        expect(s.instruction.length).toBeGreaterThan(20);
        expect(s.instruction.split(/[.!?]\s/).length).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('guía vaina: comprobaciones', () => {
  it('1) Ojo D', () => {
    const check = step(ONSD_GUIDE, 'ojo-d').check;
    expect(check(ctx())).toBe(true);
    expect(check(ctx({ side: 'izq' }))).toBe(false);
    expect(check(ctx({ station: 'temporal' }))).toBe(false);
  });

  it('2) profundidad en [38, 52] mm', () => {
    const check = step(ONSD_GUIDE, 'profundidad').check;
    expect(check(ctx({ depthMm: 38 }))).toBe(true);
    expect(check(ctx({ depthMm: 52 }))).toBe(true);
    expect(check(ctx({ depthMm: 35 }))).toBe(false);
    expect(check(ctx({ depthMm: 55 }))).toBe(false);
  });

  it('3) centrar: |offset| ≤ 3 y nervio a ≤ 4 mm del centro', () => {
    const check = step(ONSD_GUIDE, 'centrar').check;
    expect(check(ctx({ offsetMm: 2, nerveImageUMm: -1 }))).toBe(true);
    expect(check(ctx({ offsetMm: 4, nerveImageUMm: 0 }))).toBe(false);
    expect(check(ctx({ offsetMm: 0, nerveImageUMm: 4.5 }))).toBe(false);
    expect(check(ctx({ nerveImageUMm: null }))).toBe(false);
  });

  it('3) centrado en el caso de referencia: offset 0 pasa, offset 8 no', () => {
    const sim = buildReferenceCase();
    const check = step(ONSD_GUIDE, 'centrar').check;
    const s = createInitialState();
    for (const side of ['der', 'izq'] as const) {
      s.side = side;
      s.offsetMm = 0;
      const u0 = eyeNerveImageU(sim, s);
      expect(u0).not.toBeNull();
      expect(Math.abs(u0!)).toBeLessThanOrEqual(4);
      expect(check(ctx({ side, offsetMm: 0, nerveImageUMm: u0 }))).toBe(true);
      s.offsetMm = 8;
      const u8 = eyeNerveImageU(sim, s);
      expect(Math.abs(u8!)).toBeGreaterThan(4);
      expect(check(ctx({ side, offsetMm: 8, nerveImageUMm: u8 }))).toBe(false);
    }
    s.station = 'temporal';
    expect(eyeNerveImageU(sim, s)).toBeNull();
  });

  it('4) congelar', () => {
    const check = step(ONSD_GUIDE, 'congelar').check;
    expect(check(ctx({ frozen: true }))).toBe(true);
    expect(check(ctx())).toBe(false);
  });

  it('5) DVNO der a 3 ± 0,5 mm', () => {
    const check = step(ONSD_GUIDE, 'dvno-transversal').check;
    expect(check(ctx({ measurements: [dvno('der', 0)] }))).toBe(true);
    expect(check(ctx({ measurements: [dvno('der', 0, 4.6, 3.4)] }))).toBe(true);
    expect(check(ctx({ measurements: [dvno('der', 0, 4.6, 4.2)] }))).toBe(false);
    expect(check(ctx({ measurements: [dvno('izq', 0)] }))).toBe(false);
    expect(check(ctx({ measurements: [{ kind: 'distancia', value: 4.6, side: 'der' }] }))).toBe(false);
    // Sin distancia medida se usa la referencia declarada.
    expect(
      check(ctx({ measurements: [{ kind: 'dvno', value: 4.6, side: 'der', referenceOffsetMm: 3 }] })),
    ).toBe(true);
  });

  it('6) plano sagital: DVNO der medida con |rot| ≥ 80°', () => {
    const check = step(ONSD_GUIDE, 'dvno-sagital').check;
    expect(check(ctx({ measurements: [dvno('der', 0), dvno('der', 90, 3.7)] }))).toBe(true);
    expect(check(ctx({ measurements: [dvno('der', -85, 3.7)] }))).toBe(true);
    expect(check(ctx({ measurements: [dvno('der', 60, 3.7)] }))).toBe(false);
    expect(check(ctx({ rotDeg: 90, measurements: [dvno('der', 0)] }))).toBe(false);
    expect(check(ctx({ onsdSlots: ['der-sagital'] }))).toBe(true);
  });

  it('7) Ojo I: ambos planos de izq', () => {
    const check = step(ONSD_GUIDE, 'ojo-i').check;
    expect(check(ctx({ measurements: [dvno('izq', 0, 4.7), dvno('izq', 90, 3.8)] }))).toBe(true);
    expect(check(ctx({ measurements: [dvno('izq', 0, 4.7)] }))).toBe(false);
    expect(check(ctx({ onsdSlots: ['izq-transversal', 'izq-sagital'] }))).toBe(true);
    expect(check(ctx({ measurements: [dvno('der', 0), dvno('der', 90)] }))).toBe(false);
  });
});

describe('guía DTC: comprobaciones', () => {
  const t = (o: Partial<GuideContext> = {}) => ctx({ station: 'temporal', ...o });

  it('1) Temporal D', () => {
    const check = step(TCD_GUIDE, 'temporal-d').check;
    expect(check(t())).toBe(true);
    expect(check(t({ side: 'izq' }))).toBe(false);
    expect(check(ctx())).toBe(false);
  });

  it('2) plano mesencefálico ±3°', () => {
    const check = step(TCD_GUIDE, 'mesencefalico').check;
    expect(check(t({ tiltDeg: 3 }))).toBe(true);
    expect(check(t({ tiltDeg: -2 }))).toBe(true);
    expect(check(t({ tiltDeg: 10 }))).toBe(false);
  });

  it('3) color activo', () => {
    const check = step(TCD_GUIDE, 'color').check;
    expect(check(t({ colorOn: true }))).toBe(true);
    expect(check(t())).toBe(false);
  });

  it('4) puerta PW en M1 con ≥ 20 % de sangre', () => {
    const check = step(TCD_GUIDE, 'puerta-m1').check;
    expect(check(t({ pwOn: true, gate: M1 }))).toBe(true);
    expect(check(t({ pwOn: false, gate: M1 }))).toBe(false);
    expect(check(t({ pwOn: true, gate: { ...M1, bloodFraction: 0.1 } }))).toBe(false);
    expect(check(t({ pwOn: true, gate: { ...M1, dominantVesselId: 'a1-der' } }))).toBe(false);
    expect(check(t({ pwOn: true, gate: { ...M1, dominantVesselId: null } }))).toBe(false);
  });

  it('5) ángulo real ≤ 30°', () => {
    const check = step(TCD_GUIDE, 'angulo').check;
    expect(check(t({ pwOn: true, insonationRealDeg: 22 }))).toBe(true);
    expect(check(t({ pwOn: true, insonationRealDeg: 35 }))).toBe(false);
    expect(check(t({ pwOn: true, insonationRealDeg: null }))).toBe(false);
  });

  it('6) medida con ≥ 2 latidos en M1 der', () => {
    const check = step(TCD_GUIDE, 'medir-der').check;
    expect(check(t({ pwOn: true, gate: M1, mca: MCA }))).toBe(true);
    expect(check(t({ pwOn: true, gate: M1, mca: { ...MCA, beats: 1 } }))).toBe(false);
    expect(check(t({ pwOn: true, gate: M1, mca: null }))).toBe(false);
    expect(check(t({ pwOn: true, gate: { ...M1, bloodFraction: 0 }, mca: MCA }))).toBe(false);
  });

  it('7) Temporal I con M1 medida', () => {
    const check = step(TCD_GUIDE, 'temporal-i').check;
    const gate = { ...M1, dominantVesselId: 'm1-izq' };
    expect(check(t({ side: 'izq', pwOn: true, gate, mca: MCA }))).toBe(true);
    expect(check(t({ side: 'der', pwOn: true, gate: M1, mca: MCA }))).toBe(false);
    expect(check(t({ side: 'izq', pwOn: true, gate, mca: null }))).toBe(false);
  });
});

describe('reductor advance (histéresis)', () => {
  const pass = ctx(); // paso 1 de la vaina: Ojo D
  const fail = ctx({ side: 'izq' });

  it('avanza solo si la comprobación se mantiene 600 ms', () => {
    let g = startGuide('vaina', 0);
    g = advance(g, pass, 0);
    expect(g.stepIndex).toBe(0);
    expect(g.passingSinceMs).toBe(0);
    g = advance(g, pass, GUIDE_HOLD_MS - 1);
    expect(g.stepIndex).toBe(0);
    const before = g;
    g = advance(g, pass, GUIDE_HOLD_MS);
    expect(g.stepIndex).toBe(1);
    expect(g.records['ojo-d']).toEqual({
      completedAtMs: GUIDE_HOLD_MS,
      durationMs: GUIDE_HOLD_MS,
      manual: false,
    });
    expect(completedSince(before, g)).toEqual([
      { guideId: 'vaina', stepId: 'ojo-d', stepIndex: 0, durationMs: GUIDE_HOLD_MS, manual: false },
    ]);
  });

  it('un fallo intermedio reinicia el contador', () => {
    let g = startGuide('vaina', 0);
    g = advance(g, pass, 0);
    g = advance(g, fail, 400);
    expect(g.passingSinceMs).toBeNull();
    g = advance(g, pass, 500);
    g = advance(g, pass, 900);
    expect(g.stepIndex).toBe(0);
    g = advance(g, pass, 1100);
    expect(g.stepIndex).toBe(1);
  });

  it('devuelve el mismo objeto si nada cambia', () => {
    const g = startGuide('vaina', 0);
    expect(advance(g, fail, 10)).toBe(g);
    const p = advance(g, pass, 0);
    expect(advance(p, pass, 100)).toBe(p);
  });

  it('Siguiente/Anterior/Reiniciar manuales', () => {
    let g = startGuide('vaina', 0);
    g = nextStep(g, 1000, fail);
    expect(g.stepIndex).toBe(1);
    expect(g.records['ojo-d']!.manual).toBe(true);
    g = prevStep(g, 2000);
    expect(g.stepIndex).toBe(0);
    expect(g.records['ojo-d']).toBeUndefined();
    // Tras volver atrás no se auto-avanza aunque la comprobación pase…
    g = advance(g, pass, 2100);
    g = advance(g, pass, 5000);
    expect(g.stepIndex).toBe(0);
    // …hasta que falle una vez.
    g = advance(g, fail, 5100);
    g = advance(g, pass, 5200);
    g = advance(g, pass, 5200 + GUIDE_HOLD_MS);
    expect(g.stepIndex).toBe(1);
    g = resetGuide(g, 9000);
    expect(g.stepIndex).toBe(0);
    expect(g.records).toEqual({});
  });

  it('Siguiente con la comprobación cumplida cuenta como completado', () => {
    const g = nextStep(startGuide('vaina', 0), 300, pass);
    expect(g.records['ojo-d']!.manual).toBe(false);
  });

  it('pausa: no avanza ni cuenta tiempo; pista tras 20 s activos', () => {
    let g = startGuide('vaina', 0);
    g = nextStep(g, 0, pass); // paso 2 (con pista)
    expect(currentStep(g)!.id).toBe('profundidad');
    expect(hintVisible(g, GUIDE_HINT_DELAY_MS - 1)).toBe(false);
    g = pauseGuide(g, 5000);
    expect(advance(g, ctx({ depthMm: 45 }), 6000)).toBe(g);
    g = resumeGuide(g, 65_000);
    expect(hintVisible(g, 65_000 + GUIDE_HINT_DELAY_MS - 5000 - 1)).toBe(false);
    expect(hintVisible(g, 65_000 + GUIDE_HINT_DELAY_MS - 5000)).toBe(true);
    g = advance(g, ctx({ depthMm: 45 }), 70_000);
    g = advance(g, ctx({ depthMm: 45 }), 70_000 + GUIDE_HOLD_MS);
    expect(g.records['profundidad']!.durationMs).toBe(70_000 + GUIDE_HOLD_MS - 60_000);
  });

  it('una guía completa termina en el resumen y captura los datos del paso', () => {
    let g: GuideProgress = startGuide('dtc', 0);
    const full = ctx({
      station: 'temporal',
      side: 'der',
      colorOn: true,
      pwOn: true,
      gate: M1,
      insonationRealDeg: 20,
      mca: MCA,
    });
    let now = 0;
    for (let i = 0; i < 6; i += 1) {
      g = advance(g, full, now);
      now += GUIDE_HOLD_MS;
      g = advance(g, full, now);
    }
    expect(g.stepIndex).toBe(6);
    expect(g.captures['medir-der']).toMatchObject({ side: 'der', psvCms: 90, pi: 0.85 });
    const izq = {
      ...full,
      side: 'izq' as const,
      gate: { ...M1, dominantVesselId: 'm1-izq' },
      mca: { ...MCA, psvCms: -50 },
    };
    g = advance(g, izq, now);
    g = advance(g, izq, now + GUIDE_HOLD_MS);
    expect(isGuideDone(g)).toBe(true);
    expect(currentStep(g)).toBeNull();
    expect(advance(g, izq, now + 5000)).toBe(g);
    const summary = guideSummary(g, izq, { onsdMm: TRUTH.onsdMm, icaTamaxCms: 45 });
    expect(summary.values.psvIzqCms).toBe(50);
    expect(summary.values.asimetriaPsv).toBeCloseTo(40 / 90, 6);
    expect(summary.rows.find((r) => r.label === 'Asimetría PSV')!.flag).toBe('warn');
    expect(summary.interpretation.join(' ')).toContain('> 30 %');
    expect(summary.values.lindegaardD).toBeCloseTo(60 / 45, 6);
  });
});

const TRUTH: GuideTruth = {
  onsdMm: { der: { transversal: 4.6, sagital: 3.7 }, izq: { transversal: 4.7, sagital: 3.8 } },
  icaTamaxCms: 45,
  caseLabel: 'Adulto de referencia',
};

describe('resumen de la vaina', () => {
  const progress = { ...startGuide('vaina', 0), stepIndex: 7 };

  it('media bilateral frente al modelo: precisa si el error ≤ 0,3 mm', () => {
    const measurements = [
      dvno('der', 0, 4.7),
      dvno('der', 90, 3.6),
      dvno('izq', 0, 4.6),
      dvno('izq', 90, 3.9),
    ];
    const summary = guideSummary(progress, ctx({ measurements }), TRUTH);
    expect(summary.values.dvnoBilateralMm).toBeCloseTo(4.2, 6);
    expect(summary.values.dvnoModeloMm).toBeCloseTo(4.2, 6);
    expect(summary.rows.find((r) => r.label === 'Precisión')!.value).toContain('precisa');
    expect(summary.interpretation[0]).toContain('no sugiere PIC elevada');
  });

  it('DVNO > 5,8 mm: compatible con PIC elevada, no diagnóstico', () => {
    const hic: GuideTruth = {
      ...TRUTH,
      onsdMm: { der: { transversal: 6.4, sagital: 6.2 }, izq: { transversal: 6.5, sagital: 6.3 } },
    };
    const measurements = [
      dvno('der', 0, 6.4),
      dvno('der', 90, 6.2),
      dvno('izq', 0, 6.4),
      dvno('izq', 90, 6.3),
    ];
    const summary = guideSummary(progress, ctx({ measurements }), hic);
    expect(summary.interpretation[0]).toContain('compatible con PIC elevada');
    expect(summary.interpretation[0]).toContain('no diagnóstico');
    // Medida normal en un caso con vaina dilatada: se señala la discrepancia.
    const low = [dvno('der', 0, 5.0), dvno('izq', 0, 5.1)];
    const wrong = guideSummary(progress, ctx({ measurements: low }), hic);
    expect(wrong.interpretation.join(' ')).toContain('cambia la conclusión');
    expect(wrong.rows.find((r) => r.label === 'Precisión')!.flag).toBe('warn');
  });

  it('sin mediciones de un ojo no hay media bilateral', () => {
    const summary = guideSummary(progress, ctx({ measurements: [dvno('der', 0)] }), TRUTH);
    expect(summary.values.dvnoBilateralMm).toBeNull();
  });
});

describe('contexto de la guía en el caso de referencia', () => {
  it('la distancia retroglobo de una DVNO en la línea de 3 mm ≈ 3 mm', () => {
    const sim = buildReferenceCase();
    const eye = sim.eyes.der;
    const c = nerveCenterline(eye, 3);
    const r = sheathRadiiAt(eye, 3).major - eye.duraMm;
    const m: Measurement = {
      kind: 'dvno',
      frameTSeconds: 0,
      side: 'der',
      pointsMm: [
        fromEyeLocal(eye, add(c, scale([1, 0, 0], -r))),
        fromEyeLocal(eye, add(c, scale([1, 0, 0], r))),
      ],
      value: 2 * r,
      unit: 'mm',
      referenceOffsetMm: 3,
    };
    // El nervio se curva: los bordes caen a ~2,9 mm de la línea central.
    expect(Math.abs(measurementRetroOffsetMm(sim, m) - 3)).toBeLessThan(0.15);
  });

  it('verdad por plano: sagital = excentricidad × transversal', () => {
    const sim = buildReferenceCase();
    const truth = guideTruth(sim);
    expect(truth.onsdMm.der.transversal).toBeCloseTo(4.6, 1);
    expect(truth.onsdMm.der.sagital / truth.onsdMm.der.transversal).toBeCloseTo(sim.eyes.der.sheathEcc, 6);
  });

  it('el debriefing agrupa los tiempos por paso (el reinicio descarta)', () => {
    const log = new DebriefLog(0);
    log.record('guide', 'x', {
      guideId: 'vaina',
      stepId: 'ojo-d',
      stepIndex: 0,
      durationS: 9,
      manual: false,
    });
    log.record('guide', 'x', { guideId: 'vaina', reset: true });
    log.record('guide', 'x', {
      guideId: 'vaina',
      stepId: 'ojo-d',
      stepIndex: 0,
      durationS: 2,
      manual: false,
    });
    log.record('guide', 'x', {
      guideId: 'vaina',
      stepId: 'profundidad',
      stepIndex: 1,
      durationS: 5,
      manual: true,
    });
    log.record('guide', 'x', {
      guideId: 'dtc',
      stepId: 'temporal-d',
      stepIndex: 0,
      durationS: 1,
      manual: false,
    });
    const sections = guideSections(log.events());
    expect(sections.map((s) => s.guideId)).toEqual(['vaina', 'dtc']);
    expect(sections[0]!.steps).toEqual([
      { stepId: 'ojo-d', title: 'Seleccionar Ojo D', durationS: 2, manual: false },
      { stepId: 'profundidad', title: 'Profundidad y ganancia', durationS: 5, manual: true },
    ]);
    expect(sections[0]!.totalS).toBe(7);
    expect(sections[0]!.completed).toBe(false);
  });
});
