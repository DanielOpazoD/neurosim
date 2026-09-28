import { describe, expect, it } from 'vitest';
import { attenuationDbCm, MATERIALS } from '../../src/anatomy/materials';
import { buildReferenceHead, classifyHead } from '../../src/anatomy/head';
import { dist, type Vec3 } from '../../src/core/vec3';
import { SeededRandom } from '../../src/core/random';
import { skullAttenuationDb, transmissionTo } from '../../src/ultrasound/attenuation';

describe('validación de atenuación', () => {
  it('mantiene la atenuación de un trayecto cerebral homogéneo', () => {
    const head = buildReferenceHead(new SeededRandom('attenuation-validation'));
    const a: Vec3 = [head.midbrainCenter[0], head.midbrainCenter[1] - 5, head.midbrainCenter[2] - 20];
    const b: Vec3 = [head.midbrainCenter[0], head.midbrainCenter[1] + 5, head.midbrainCenter[2] - 20];
    const lengthMm = dist(a, b);
    const steps = Math.ceil(lengthMm / 0.1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      // Corteza y sustancia blanca comparten α₀ y n → trayecto homogéneo.
      expect(['tejidoCerebral', 'sustanciaBlanca']).toContain(classifyHead(head, p));
    }
    const measured = skullAttenuationDb(head, a, b, 2);
    const expected = 2 * attenuationDbCm(MATERIALS.tejidoCerebral, 2) * (lengthMm / 10);
    expect(measured).toBeCloseTo(expected, 1);
  });

  it('coincide con una suma fina a través de la ventana', () => {
    const head = buildReferenceHead(new SeededRandom('attenuation-validation'));
    const from = head.windowCenter.der;
    const to = head.midbrainCenter;
    const lengthMm = dist(from, to);
    const stepMm = 0.05;
    const steps = Math.ceil(lengthMm / stepMm);
    let oneWay = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const p: Vec3 = [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ];
      oneWay += 2 * attenuationDbCm(MATERIALS[classifyHead(head, p)], 2) * (lengthMm / steps / 10);
    }
    const expected = oneWay;
    const measured = skullAttenuationDb(head, from, to, 2);
    expect(measured).toBeGreaterThan(expected * 0.95);
    expect(measured).toBeLessThan(expected * 1.05);
    expect(transmissionTo(head, from, to, 2)).toBeCloseTo(10 ** (-measured / 20), 9);
  });
});
