import { describe, expect, it } from 'vitest';
import { SimulationClock } from '../src/core/clock';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { defaultTemporalSettings } from '../src/domain/settings';
import { createInitialState, type AppState } from '../src/app/state';
import { PwController, type PwTransport } from '../src/app/pwController';
import { packColumns, type PwMessage, type PwReply } from '../src/app/pwProtocol';
import { currentPose } from '../src/app/poses';
import { patientToImage } from '../src/ultrasound/probe';
import { exportPayload } from '../src/app/exporter';
import { buildGuideContext } from '../src/app/guideContext';
import { buildDebrief } from '../src/app/debrief';
import { submandibularState } from './validation/helpers';

function fixture(station: 'temporal' | 'submandibular' = 'temporal') {
  const sim = buildReferenceCase();
  const s = station === 'submandibular' ? submandibularState(sim, 'der') : createInitialState();
  if (station === 'temporal') {
    s.station = station;
    s.settings = defaultTemporalSettings();
    const target = sim.head.vessels.find((v) => v.id === 'm1-der')!.points[2]!;
    const image = patientToImage(currentPose(sim, s), 'sector', target);
    s.gateUMm = image.u;
    s.gateDepthMm = image.z;
  }
  s.pwOn = true;
  const posted: PwMessage[] = [];
  const transport: PwTransport = {
    onReply: null,
    onFailure: null,
    post: (m) => {
      posted.push(m);
    },
  };
  const pw = new PwController(sim, s, transport);
  pw.nowMs = () => 0;
  const clock = new SimulationClock();
  pw.step(clock, 0.064);
  const reply = (start = 0): PwReply => {
    const powerDb = new Float32Array(128).fill(-80);
    for (let i = 4; i <= 18; i++) powerDb[64 + i] = -20;
    const cols = Array.from({ length: 400 }, (_, i) => ({
      t: start + i / 100,
      stepS: 0.01,
      powerDb,
      prfHz: s.settings.prfHz,
    }));
    return {
      type: 'block',
      configVersion: posted.at(-1)!.configVersion,
      sceneKey: `${s.station}-${s.side}`,
      fftSize: 128,
      ...packColumns(cols, 128),
      iqRe: new Float32Array(),
      iqIm: new Float32Array(),
      iqPrfHz: s.settings.prfHz,
      composition: {
        bloodFraction: 0.8,
        bloodWeight: 1,
        dominantVesselFraction: 1,
        dominantVesselId: `${s.station === 'temporal' ? 'm1' : 'aci'}-${s.side}`,
      },
    };
  };
  const deliver = (r = reply()) => transport.onReply!(r);
  return { sim, s, pw, clock, reply, deliver, posted };
}

const mutations: [string, (s: AppState) => void][] = [
  [
    'frecuencia',
    (s) => {
      s.settings = { ...s.settings, frequencyMhz: 3 };
    },
  ],
  [
    'PRF',
    (s) => {
      s.settings = { ...s.settings, prfHz: 7000 };
    },
  ],
  [
    'filtro',
    (s) => {
      s.settings = { ...s.settings, wallFilterHz: 200 };
    },
  ],
  [
    'puerta',
    (s) => {
      s.gateDepthMm += 1;
    },
  ],
  [
    'tamaño de puerta',
    (s) => {
      s.settings = { ...s.settings, gateMm: 2 };
    },
  ],
  [
    'sonda',
    (s) => {
      s.tiltDeg += 5;
    },
  ],
  [
    'desplazamiento',
    (s) => {
      s.offsetMm += 2;
    },
  ],
  [
    'lado',
    (s) => {
      s.side = 'izq';
    },
  ],
];

describe('contexto adquirido PW (R03)', () => {
  it.each(mutations)('no reutiliza ni mezcla capturas tras cambiar %s', (_, change) => {
    const f = fixture();
    f.deliver();
    expect(f.pw.latestMcaMeasure()).not.toBeNull();
    const previous = f.reply(4);
    change(f.s);
    expect(f.pw.latestCapture()?.status).toBe('contexto-incompatible');
    expect(f.pw.latestMcaMeasure()).toBeNull();
    const count = f.pw.columns.length;
    f.deliver(previous);
    expect(f.pw.columns).toHaveLength(count);
    f.pw.step(f.clock, 0.064);
    expect(f.pw.columns).toHaveLength(0);
    f.deliver(previous);
    expect(f.pw.columns).toHaveLength(0);
    f.deliver(f.reply(4));
    expect(f.pw.columns[0]!.t).toBe(4);
  });

  it.each(['mapMmHg', 'icpMmHg', 'paco2MmHg', 'heartRateBpm'] as const)(
    'invalida por %s incluso al volver al valor anterior',
    (key) => {
      const f = fixture();
      f.deliver();
      const old = { ...f.sim.patient.physiology };
      f.sim.setPhysiology({ ...old, [key]: old[key] + 5 });
      f.sim.setPhysiology(old);
      expect(f.pw.latestCapture()?.status).toBe('contexto-incompatible');
      expect(f.pw.latestMcaMeasure()).toBeNull();
    },
  );

  it('congelar no acepta columnas ni composición tardías del worker', () => {
    const f = fixture();
    f.deliver();
    const before = f.pw.latestCapture();
    const rev = f.pw.revision;
    f.s.frozen = true;
    f.deliver({ ...f.reply(4), composition: null });
    expect(f.pw.revision).toBe(rev);
    expect(f.pw.latestCapture()).toEqual(before);
  });

  it.each([0, 0.1, Number.NaN])(
    'rechaza fracción de sangre %s aunque la onda sea cuantificable',
    (fraction) => {
      const f = fixture();
      const reply = f.reply();
      f.deliver({ ...reply, composition: { ...reply.composition!, bloodFraction: fraction } });
      expect(f.pw.latestCapture()?.status).toBe('puerta-no-fiable');
      expect(f.pw.latestMcaMeasure()).toBeNull();
      expect(f.pw.lindegaard()).toBeNull();
    },
  );

  it('identidad de todos los bloques: una última columna buena no rehabilita una ventana mixta', () => {
    const f = fixture();
    const wrong = f.reply();
    f.deliver({ ...wrong, composition: { ...wrong.composition!, dominantVesselId: 'm1-izq' } });
    f.deliver(f.reply(4));
    // La ventana final ya no incluye los bloques anteriores.
    expect(f.pw.latestCapture()?.status).toBe('valida');
    f.deliver({ ...f.reply(8), composition: { ...wrong.composition!, dominantVesselId: 'aca-der' } });
    expect(f.pw.lindegaard()).toBeNull();
  });

  it('no rehabilita una ventana mixta aunque el último bloque identifique M1', () => {
    const f = fixture();
    const wrong = f.reply();
    f.deliver({ ...wrong, composition: { ...wrong.composition!, dominantVesselId: 'm1-izq' } });
    expect(f.pw.lindegaard()).toBeNull();
    const next = f.reply(4);
    f.deliver({
      ...next,
      count: 50,
      times: next.times.slice(0, 50),
      prfHz: next.prfHz.slice(0, 50),
      steps: next.steps.slice(0, 50),
      power: next.power.slice(0, 50 * next.fftSize),
    });
    expect(f.pw.latestCapture()?.status).toBe('puerta-no-fiable');
    expect(f.pw.latestMcaMeasure()).toBeNull();
  });

  it('un nuevo intento ACI inválido no reutiliza silenciosamente el anterior válido', () => {
    const f = fixture('submandibular');
    f.deliver();
    f.pw.latestMcaMeasure();
    const previous = f.s.icaMeasured.der!.capture;
    const next = f.reply(4);
    f.deliver({ ...next, composition: { ...next.composition!, bloodFraction: 0.1 } });
    expect(f.pw.latestMcaMeasure()).toBeNull();
    expect(f.pw.icaValidity()).toBe('calidad-insuficiente');
    expect(f.s.icaMeasured.der!.capture).toEqual(previous);
    expect(f.s.icaMeasured.der!.lastFailedAttempt?.status).toBe('puerta-no-fiable');
    f.deliver(f.reply(8));
    expect(f.pw.latestMcaMeasure()).not.toBeNull();
    expect(f.pw.icaValidity()).toBe('vigente');
  });

  it.each([61, 90, Number.NaN])('no calcula índices con corrección angular %s', (angleCorrectionDeg) => {
    const f = fixture();
    f.deliver();
    f.s.settings = { ...f.s.settings, angleCorrectionDeg };
    expect(f.pw.latestMcaMeasure()).toBeNull();
    expect(f.pw.lindegaard()).toBeNull();
  });

  it('ACI de otro lado/estación o del futuro no es válida; no caduca por un plazo clínico inventado', () => {
    const f = fixture('submandibular');
    f.deliver();
    f.pw.latestMcaMeasure();
    const saved = f.s.icaMeasured.der!;
    expect(f.pw.icaValidity('der', 10000)).toBe('vigente');
    expect(f.pw.icaValidity('der', 1)).toBe('tiempo-incompatible');
    f.s.icaMeasured.der = {
      ...saved,
      capture: { ...saved.capture, context: { ...saved.capture.context, side: 'izq' } },
    };
    expect(f.pw.icaValidity()).toBe('identidad-incompatible');
    f.s.icaMeasured.der = {
      ...saved,
      capture: { ...saved.capture, context: { ...saved.capture.context, station: 'temporal' } },
    };
    expect(f.pw.icaValidity()).toBe('identidad-incompatible');
    f.s.icaMeasured.der = {
      ...saved,
      capture: { ...saved.capture, context: { ...saved.capture.context, caseId: 'otro-caso' } },
    };
    expect(f.pw.icaValidity()).toBe('contexto-incompatible');
  });

  it('una ACI incompatible se conserva como historial, no se sustituye por referencia', () => {
    const f = fixture('submandibular');
    f.deliver();
    expect(f.pw.latestMcaMeasure()).not.toBeNull();
    const ica = f.s.icaMeasured.der!;
    expect(f.pw.icaValidity()).toBe('vigente');
    expect(ica.capture.context.station).toBe('submandibular');
    f.sim.setPhysiology({ ...f.sim.patient.physiology, icpMmHg: 30 });
    expect(f.pw.icaValidity()).toBe('contexto-incompatible');
    expect(f.pw.measuredIca()).toBeNull();
    expect(f.s.icaMeasured.der).toBe(ica);
    const other = fixture();
    other.s.icaMeasured.der = ica;
    other.sim.setPhysiology({ ...other.sim.patient.physiology, icpMmHg: 30 });
    other.pw.step(other.clock, 0.064);
    other.deliver(other.reply(4));
    expect(other.pw.lindegaard()).toMatchObject({ icaSource: 'medida', ratio: Number.NaN });
    expect(other.pw.lindegaard()?.invalidReason).toContain('estado fisiológico');
    expect(buildGuideContext(f.sim, f.s, f.pw, new WeakMap()).icaMeasuredCms?.der).toBeNull();
  });

  it('exporta la captura congelada sin sustituir su fisiología/equipo por los actuales', () => {
    const f = fixture();
    f.s.teachingMode = true;
    f.deliver();
    f.s.frozen = true;
    const capture = f.pw.latestCapture()!;
    f.s.debrief.record('freeze', 'congelar', { frozen: true, pwStatus: capture.status }, capture);
    const before = JSON.stringify((exportPayload(f.sim, f.s) as { pwDetalle: unknown }).pwDetalle);
    f.sim.setPhysiology({ ...f.sim.patient.physiology, icpMmHg: 30 });
    f.s.settings = { ...f.s.settings, frequencyMhz: 3 };
    const after = JSON.stringify((exportPayload(f.sim, f.s) as { pwDetalle: unknown }).pwDetalle);
    expect(after).toBe(before);
    expect(after).toContain('frequencyMhz');
    expect(after).toContain('icpMmHg');
  });

  it('la exportación de alumno omite fisiología latente y ángulo real también en capturas anidadas', () => {
    const f = fixture('submandibular');
    f.deliver();
    f.pw.latestMcaMeasure();
    const ica = f.s.icaMeasured.der!;
    f.s.debrief.record('freeze', 'congelar', { frozen: true, pwStatus: 'valida' }, ica.capture, ica.capture);
    f.s.icaMeasured.der = { ...ica, lastFailedAttempt: ica.capture };
    for (const report of [
      exportPayload(f.sim, f.s),
      buildDebrief(f.s.debrief, f.sim, f.s, f.sim.physStateAt(0).hemo),
    ]) {
      const json = JSON.stringify(report);
      expect(json).not.toContain('icpMmHg');
      expect(json).not.toContain('realDeg');
    }
    expect(f.s.debrief.events()[0]!.pwCapture?.context.physiology.icpMmHg).toBe(10);
  });

  it.each(['contexto-incompatible', 'puerta-no-fiable', 'angulo-invalido'] as const)(
    'debrief/export conservan %s sin índices automáticos',
    (status) => {
      const f = fixture();
      f.s.debrief.record('freeze', 'congelar', {
        frozen: true,
        pwStatus: status,
        lindegaardSource: 'referencia',
        mcaTaMaxCms: 200,
        icaTaMaxCms: 40,
        pi: 5,
      });
      const report = buildDebrief(f.s.debrief, f.sim, f.s, f.sim.physStateAt(0).hemo);
      expect(report.findings.some((item) => item.code === 'pw-contexto-invalido')).toBe(true);
      expect(report.findings.some((item) => item.code === 'pi-vs-esperado')).toBe(false);
      expect(exportPayload(f.sim, f.s)).toMatchObject({ lindegaard: null, pwDetalle: { estado: status } });
    },
  );

  it('el evento conserva la ACI asociada aunque después se mida otra', () => {
    const f = fixture('submandibular');
    f.deliver();
    f.pw.latestMcaMeasure();
    const ica = f.s.icaMeasured.der!;
    f.s.debrief.record('freeze', 'congelar', { frozen: true, pwStatus: 'valida' }, ica.capture, ica.capture);
    f.deliver(f.reply(4));
    f.s.frozen = true;
    f.pw.latestMcaMeasure();
    expect(f.s.icaMeasured.der!.tSec).toBeGreaterThan(ica.tSec);
    expect(exportPayload(f.sim, f.s)).toMatchObject({
      lindegaardDetalle: { aciCapturada: { tEnd: ica.tSec } },
    });
  });
});
