/**
 * Escena submandibular (DEC-58): geometría de la ACI/ACE/yugular respecto a
 * la sonda, caudal de la ACI coherente con Willis y clasificación de tejidos.
 */
import { describe, expect, it } from 'vitest';
import { buildReferenceCase } from '../src/domain/referenceCase';
import { caseById } from '../src/domain/cases';
import {
  classifyNeck,
  HIGH_RESISTANCE_SHAPE_MEAN,
  NECK_ECA_EDV_CMS,
  NECK_ECA_PSV_CMS,
  NECK_ICA_RADIUS_MM,
  neckIcaFlowMlMin,
  neckLocal,
  neckPoint,
} from '../src/anatomy/neck';
import { highResistanceShape, vesselVelocityCms } from '../src/physiology/flow';
import { currentPose, submandibularPose } from '../src/app/poses';
import { neckDopplerScene } from '../src/app/renderRequest';
import { insonationAngles } from '../src/doppler/insonation';
import { beamDirAt, elevAxis, imageToPatient } from '../src/ultrasound/probe';
import { dot, normalize } from '../src/core/vec3';
import type { Side } from '../src/domain/contracts';

const sim = buildReferenceCase();
const SIDES: readonly Side[] = ['der', 'izq'];

describe('cuello: geometría de vasos', () => {
  for (const side of SIDES) {
    const neck = sim.neck[side];
    const vessel = (prefix: string) => neck.vessels.find((v) => v.id === `${prefix}-${side}`)!;

    it(`${side}: expone ACI, ACE con ramas y yugular interna con radios plausibles`, () => {
      const ids = neck.vessels.map((v) => v.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          `aci-${side}`,
          `ace-${side}`,
          `ace-facial-${side}`,
          `ace-lingual-${side}`,
          `vyi-${side}`,
        ]),
      );
      expect(vessel('aci').radiusMm).toBe(NECK_ICA_RADIUS_MM);
      expect(vessel('aci').radiusMm).toBeGreaterThanOrEqual(2);
      expect(vessel('aci').radiusMm).toBeLessThanOrEqual(2.8);
      expect(vessel('ace').radiusMm).toBeLessThan(vessel('aci').radiusMm);
      expect(vessel('vyi').radiusMm).toBeGreaterThan(vessel('aci').radiusMm);
      expect(vessel('vyi').venous).toBe(true);
      expect(vessel('ace').waveform).toBe('alta');
      expect(vessel('aci').waveform ?? 'baja').toBe('baja');
    });

    it(`${side}: la ACI cruza el haz central entre 30 y 55 mm y queda en el plano`, () => {
      const local = vessel('aci').points.map((p) => neckLocal(neck.frame, p));
      // Tramo insonado: 30–55 mm de profundidad a lo largo del haz por defecto.
      const insonated = local.filter((q) => q[0] >= 30 && q[0] <= 55);
      expect(insonated.length).toBeGreaterThan(20);
      for (const q of insonated) {
        expect(Math.abs(q[1])).toBeLessThanOrEqual(2.5); // dentro del haz central (±radio)
        expect(Math.abs(q[2])).toBeLessThanOrEqual(1); // en el plano de imagen
      }
      // Cruce de la línea central (lat = 0) dentro de 30–55 mm.
      const crossing = local.find((q, i) => i > 0 && local[i - 1]![1] > 0 && q[1] <= 0);
      expect(crossing).toBeDefined();
      expect(crossing![0]).toBeGreaterThanOrEqual(30);
      expect(crossing![0]).toBeLessThanOrEqual(55);
    });

    it(`${side}: ACE medial-anterior, yugular lateral-anterior, ACI hacia el sifón`, () => {
      const at = (prefix: string, d: number) => {
        const local = vessel(prefix).points.map((p) => neckLocal(neck.frame, p));
        return local.reduce((best, q) => (Math.abs(q[0] - d) < Math.abs(best[0] - d) ? q : best));
      };
      for (const d of [20, 35, 50]) {
        const ica = at('aci', d);
        const eca = at('ace', d);
        const ijv = at('vyi', d);
        expect(eca[1]).toBeLessThan(ica[1] - 4); // medial
        expect(eca[2]).toBeGreaterThan(ica[2]); // anterior
        expect(ijv[1]).toBeGreaterThan(ica[1] + 4); // lateral
        expect(ijv[2]).toBeGreaterThan(ica[2]); // anterior (anterolateral)
      }
      // Continuidad plausible: el último punto de la ACI cervical llega a
      // ≤ 6 mm del inicio del sifón intracraneal del mismo lado.
      const siphon = sim.head.vessels.find((v) => v.id === `ica-${side}`)!;
      const last = vessel('aci').points.at(-1)!;
      const first = siphon.points[0]!;
      expect(Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2])).toBeLessThan(6);
      // Flujo: la ACI sube (se aleja de la sonda), la yugular baja (hacia la sonda).
      const dir = (prefix: string) => {
        const pts = vessel(prefix).points;
        const mid = Math.floor(pts.length / 3);
        return normalize([
          pts[mid + 1]![0] - pts[mid]![0],
          pts[mid + 1]![1] - pts[mid]![1],
          pts[mid + 1]![2] - pts[mid]![2],
        ]);
      };
      expect(dot(dir('aci'), neck.frame.beam)).toBeGreaterThan(0.9);
      expect(dot(dir('vyi'), neck.frame.beam)).toBeLessThan(-0.9);
    });
  }
});

describe('cuello: caudal de la ACI = ramas intracraneales ipsilaterales', () => {
  const variants = ['normal', 'aplasiaA1Izq', 'pcaFetalDer'] as const;
  for (const variant of variants) {
    it(`variante ${variant}`, () => {
      const c = buildReferenceCase(undefined, variant);
      for (const side of SIDES) {
        const q = (id: string) => c.head.vessels.find((v) => v.id === id)?.flowMlMin ?? 0;
        const expected = q(`m1-${side}`) + q(`a1-${side}`) + q(`pcoa-${side}`);
        const ica = c.neck[side].vessels.find((v) => v.id === `aci-${side}`)!;
        expect(ica.flowMlMin).toBeCloseTo(expected, 6);
        expect(neckIcaFlowMlMin(c.head.vessels, side)).toBeCloseTo(expected, 6);
        // Igual que el sifón `ica-*` de Willis.
        expect(ica.flowMlMin).toBeCloseTo(q(`ica-${side}`), 6);
      }
    });
  }

  it('velocidades de referencia: TAMax 35–45, PSV ≈ 60, EDV ≈ 25 cm/s', () => {
    const ica = sim.neck.der.vessels[0]!;
    const hemo = sim.physStateAt(0).hemo;
    let ta = 0;
    for (let i = 0; i < 400; i++) ta += vesselVelocityCms(ica, i / 400, 1, hemo) / 400;
    expect(ta).toBeGreaterThanOrEqual(35);
    expect(ta).toBeLessThanOrEqual(45);
    expect(ica.psvCms).toBeGreaterThan(60 * 0.85);
    expect(ica.psvCms).toBeLessThan(60 * 1.15);
    expect(ica.edvCms).toBeGreaterThan(25 * 0.8);
    expect(ica.edvCms).toBeLessThan(25 * 1.2);
  });

  it('ACE: onda de alta resistencia con media coherente e incisura dicrota', () => {
    let acc = 0;
    for (let i = 0; i < 2000; i++) acc += highResistanceShape(i / 2000);
    expect(acc / 2000).toBeCloseTo(HIGH_RESISTANCE_SHAPE_MEAN, 2);
    const eca = sim.neck.der.vessels.find((v) => v.id === 'ace-der')!;
    expect(eca.meanCms).toBeCloseTo(
      NECK_ECA_EDV_CMS + (NECK_ECA_PSV_CMS - NECK_ECA_EDV_CMS) * HIGH_RESISTANCE_SHAPE_MEAN,
      6,
    );
    // Incisura: mínimo local entre el pico sistólico y el rebote.
    const v = (p: number) => vesselVelocityCms(eca, p);
    expect(v(0.24)).toBeLessThan(v(0.34));
    expect(v(0.24)).toBeLessThan(v(0.18));
    // La hemodinámica cerebral no la modula.
    const hyper = buildReferenceCase(undefined, 'normal', caseById('hipercapnia'));
    expect(vesselVelocityCms(eca, 0.12, 1, hyper.physStateAt(0).hemo)).toBeCloseTo(v(0.12), 9);
  });
});

describe('cuello: clasificación', () => {
  const neck = sim.neck.der;
  const f = neck.frame;
  const at = (d: number, lat: number, ant: number) => classifyNeck(neck, neckPoint(f, d, lat, ant));

  it('piel, subcutáneo y acoplamiento', () => {
    expect(at(-1, 0, 0)).toBe('gel');
    expect(at(-8, 0, 0)).toBe('aire');
    expect(at(0.8, 0, 0)).toBe('piel');
    expect(at(3, 0, 0)).toBe('grasaSubcutanea');
  });

  it('glándula, músculos, hueso, vaso y fondo', () => {
    const g = neck.gland.center;
    expect(at(g[0], g[1], g[2])).toBe('glandulaSubmandibular');
    const m = neck.digastric;
    expect(at((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2)).toBe('musculoCervical');
    expect(at(20, -24, 0)).toBe('musculoCervical'); // milohioideo medial
    expect(at(40, 20, 0)).toBe('hueso'); // rama mandibular lateral
    expect(at(45, 0, 0)).toBe('vaso'); // ACI
    expect(at(40, 10.5, 3.5)).toBe('vaso'); // yugular interna
    expect(at(65, -25, 0)).toBe('tejidoCervical');
  });
});

describe('ventana submandibular: pose e insonación', () => {
  for (const side of SIDES) {
    it(`${side}: haz ~30° de la vertical, ACI dominante a 45 mm con ángulo ≤ 30°`, () => {
      const s = { side, station: 'submandibular' as const, tiltDeg: 0, offsetMm: 0 };
      const pose = currentPose(sim, s);
      expect(pose).toEqual(submandibularPose(sim, s));
      const fromVertical = (Math.acos(pose.forward[1]) * 180) / Math.PI;
      expect(fromVertical).toBeGreaterThan(25);
      expect(fromVertical).toBeLessThan(35);
      expect(pose.forward[2]).toBeLessThan(0); // hacia posterior (base del cráneo)
      const center = imageToPatient(pose, 'sector', 0, 45);
      const angle = insonationAngles(
        neckDopplerScene(sim.neck[side]),
        center,
        beamDirAt(pose, 'sector', 0),
        pose.lateral,
        elevAxis(pose),
      );
      expect(angle.vesselId).toBe(`aci-${side}`);
      expect(angle.realDeg).toBeLessThanOrEqual(30);
      // Derecha de la imagen = lateral del paciente en ambos lados.
      expect(dot(pose.lateral, sim.neck[side].frame.lateral)).toBeGreaterThan(0.99);
    });
  }
});
