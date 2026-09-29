import { describe, expect, it } from 'vitest';
import { classifyEye, fromEyeLocal, nerveCenterline, trueOnsdMm } from '../../src/anatomy/eye';
import { insideInnerTable, vesselDistance } from '../../src/anatomy/head';
import { add, dot, dist, normalize, sub, type Vec3 } from '../../src/core/vec3';
import type { MaterialId } from '../../src/anatomy/materials';
import { SeededRandom } from '../../src/core/random';
import { buildReferenceCase, REFERENCE_SEED } from '../../src/domain/referenceCase';
import { defaultEyeSettings, defaultTemporalSettings } from '../../src/domain/settings';
import { arterialShape } from '../../src/physiology/flow';
import { eyeScene, headScene, renderRequest } from '../../src/app/renderRequest';
import { currentPose, HAND_MAX_RETREAT_MM, handMotionDisplacementMm } from '../../src/app/poses';
import { hashBMode } from './hash';

const sim = buildReferenceCase(REFERENCE_SEED);

describe('movimiento dinámico', () => {
  it('la presión no altera la DVNO: vaina a s=3 mm es invariante', () => {
    const eye = sim.eyes.der;
    const c3 = nerveCenterline(eye, 3);
    const seqFor = (press: number): string[] => {
      const scene = eyeScene(eye, `seed-${sim.patient.seed}-der`, { press, cardiacPhase: 0.2 });
      const out: string[] = [];
      for (let x = -4; x <= 4; x += 0.4) {
        const p = fromEyeLocal(eye, add(c3, [x, 0, 0]));
        out.push(classifyEye(eye, scene.warp!(p)));
      }
      return out;
    };
    const base = seqFor(0);
    expect(seqFor(0.5)).toEqual(base);
    expect(seqFor(1)).toEqual(base);
    expect(trueOnsdMm(eye, 3, 'interno')).toBeCloseTo(trueOnsdMm(eye, 3, 'interno'), 10);
  });

  it('a presión máxima el polo anterior se hunde ≥1,2 mm', () => {
    const eye = sim.eyes.der;
    const boundaryZ = (press: number): number => {
      const scene = eyeScene(eye, `seed-${sim.patient.seed}-der`, { press, cardiacPhase: 0.2 });
      for (let z = eye.globeRadiusMm + 5; z > eye.globeRadiusMm - 6; z -= 0.05) {
        const p = fromEyeLocal(eye, [0, 0, z]);
        const id = classifyEye(eye, scene.warp!(p));
        if (id !== 'aire' && id !== 'gel' && id !== 'piel') return z;
      }
      return Number.NaN;
    };
    expect(boundaryZ(0) - boundaryZ(1)).toBeGreaterThanOrEqual(1.2);
  });

  it('a presión alta el globo y el cristalino siguen clasificándose bien', () => {
    const eye = sim.eyes.der;
    const r = eye.globeRadiusMm;
    for (const press of [0.75, 1]) {
      const scene = eyeScene(eye, `seed-${sim.patient.seed}-der`, { press, cardiacPhase: 0.2 });
      const globo = classifyEye(eye, scene.warp!(fromEyeLocal(eye, [0, 0, 0])));
      expect(globo).toBe('vitrio');
      // El cristalino aparece desplazado posterior por el empuje; su centro
      // material (z = r − 6) sigue clasificándose `cristalino` donde se pinta.
      let lente: MaterialId | null = null;
      for (let z = r - 9; z <= r - 3; z += 0.05) {
        if (classifyEye(eye, scene.warp!(fromEyeLocal(eye, [0, 0, z]))) === 'cristalino') {
          lente = 'cristalino';
          break;
        }
      }
      expect(lente).toBe('cristalino');
    }
  });

  it('la cabeza se mueve ≤1 mm dentro de la tabla y nada fuera', () => {
    const rng = new SeededRandom('motion-head');
    const rng2 = new SeededRandom('motion-head');
    const pts: Vec3[] = [];
    while (pts.length < 200) {
      const p: Vec3 = [
        sim.head.skullCenter[0] + (rng.float() * 2 - 1) * sim.head.skullRadii[0],
        sim.head.skullCenter[1] + (rng.float() * 2 - 1) * sim.head.skullRadii[1],
        sim.head.skullCenter[2] + (rng.float() * 2 - 1) * sim.head.skullRadii[2],
      ];
      if (insideInnerTable(sim.head, p)) pts.push(p);
    }
    for (let ph = 0; ph < 8; ph++) {
      const scene = headScene(sim.head, 'x', { cardiacPhase: ph / 8, respiratoryPhase: 0.35 });
      for (const p of pts) {
        expect(dist(scene.warp!(p), p)).toBeLessThanOrEqual(1.0);
      }
    }
    const scene = headScene(sim.head, 'x', { cardiacPhase: 0.15, respiratoryPhase: 0.35 });
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [
        sim.head.skullCenter[0] + (rng2.float() * 2 - 1) * sim.head.skullRadii[0] * 1.5,
        sim.head.skullCenter[1] + (rng2.float() * 2 - 1) * sim.head.skullRadii[1] * 1.5,
        sim.head.skullCenter[2] + (rng2.float() * 2 - 1) * sim.head.skullRadii[2] * 1.5,
      ];
      if (insideInnerTable(sim.head, p)) continue;
      expect(scene.warp!(p)).toEqual(p);
    }
  });

  it('en sístole la pared de M1 empuja el tejido hacia fuera', () => {
    const m1 = sim.head.vessels.find((v) => v.id === 'm1-der')!;
    const mid = m1.points[Math.floor(m1.points.length / 2)]!;
    // Pico de arterialShape (fase del máximo).
    let peak = 0;
    let peakV = -Infinity;
    for (let i = 0; i < 200; i++) {
      const v = arterialShape(i / 200);
      if (v > peakV) {
        peakV = v;
        peak = i / 200;
      }
    }
    const p = add(mid, [0, m1.radiusMm + 1, 0]);
    expect(vesselDistance(m1, p)).toBeGreaterThan(0);
    const scene = headScene(sim.head, 'x', { cardiacPhase: peak, respiratoryPhase: 0.5 });
    const u = sub(p, scene.warp!(p));
    const radial = normalize(sub(p, mid));
    expect(dot(u, radial)).toBeGreaterThan(0);
  });

  it('la mano mueve la sonda ≤1,5 mm y conserva la normal unitaria', () => {
    const base = { side: 'der' as const, station: 'temporal' as const, tiltDeg: 0, offsetMm: 0 };
    const rest = currentPose(sim, base);
    for (const tSec of [0, 0.5, 1]) {
      const pose = currentPose(sim, { ...base, tSec, handMotion: true });
      expect(dist(pose.origin, rest.origin)).toBeLessThanOrEqual(1.5);
      expect(Math.hypot(...pose.forward)).toBeCloseTo(1, 6);
    }
    const still = currentPose(sim, base);
    expect(still.origin).toEqual(rest.origin);
    expect(still.forward).toEqual(rest.forward);
  });

  it('ojo: la deriva de mano no despega la sonda del párpado (DEC-55)', () => {
    const base = { side: 'der' as const, station: 'ojo' as const, tiltDeg: 0, offsetMm: 0 };
    const rest = currentPose(sim, base);
    let oldWorst = 0;
    let oldWorstT = 0;
    for (let i = 0; i < 200; i += 1) {
      const tSec = (60 * i) / 199;
      const pose = currentPose(sim, { ...base, tSec, handMotion: true });
      const retreat = -dot(sub(pose.origin, rest.origin), rest.forward);
      expect(retreat).toBeLessThanOrEqual(HAND_MAX_RETREAT_MM + 1e-9);
      // Retroceso que producía el código anterior (desplazamiento sin cota).
      const oldRetreat = -dot(handMotionDisplacementMm(tSec, sim.patient.seed), rest.forward);
      if (oldRetreat > oldWorst) {
        oldWorst = oldRetreat;
        oldWorstT = tSec;
      }
    }
    // El escenario del fallo existe: la deriva bruta retrocedía >0,5 mm.
    expect(oldWorst).toBeGreaterThan(0.5);
    // Misma cota en la ventana temporal (gel sobre el cuero cabelludo).
    const tBase = { ...base, station: 'temporal' as const };
    const tRest = currentPose(sim, tBase);
    for (let i = 0; i < 200; i += 1) {
      const pose = currentPose(sim, { ...tBase, tSec: (60 * i) / 199, handMotion: true });
      expect(-dot(sub(pose.origin, tRest.origin), tRest.forward)).toBeLessThanOrEqual(
        HAND_MAX_RETREAT_MM + 1e-9,
      );
    }
    const settings = { ...defaultEyeSettings(), lineDensity: 'baja' as const };
    const meanDb = (t: number): number => {
      const { bmode } = renderRequest(
        {
          id: 1,
          seed: REFERENCE_SEED,
          side: 'der',
          station: 'ojo',
          settings,
          tiltDeg: 0,
          offsetMm: 0,
          t,
          cardiacPhase: 0,
          respiratoryPhase: 0,
          handMotion: true,
          flowModulation: 1,
          color: false,
        },
        sim,
      );
      let acc = 0;
      for (const v of bmode.db) acc += v;
      return acc / bmode.db.length;
    };
    expect(Math.abs(meanDb(oldWorstT) - meanDb(0))).toBeLessThan(1);
  });

  it('misma solicitud → mismo fotograma (determinista)', () => {
    const settings = defaultTemporalSettings();
    const req = {
      id: 1,
      seed: REFERENCE_SEED,
      side: 'der' as const,
      station: 'temporal' as const,
      settings,
      tiltDeg: 0,
      offsetMm: 0,
      rotDeg: 0,
      press: 0.3,
      t: 1.234,
      cardiacPhase: 0.37,
      respiratoryPhase: 0.61,
      handMotion: true,
      flowModulation: 1,
      color: false,
    };
    const a = renderRequest(req, sim);
    const b = renderRequest(req, sim);
    expect(hashBMode(a.bmode)).toBe(hashBMode(b.bmode));
  });
});
