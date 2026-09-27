import { describe, expect, it } from 'vitest';
import type { MaterialId } from '../src/anatomy/materials';
import type { Vec3 } from '../src/core/vec3';
import { interfaceNormal } from '../src/ultrasound/bmode';

const cosDeg = (degrees: number): number => Math.cos((degrees * Math.PI) / 180);

describe('normal de interfaz B-mode', () => {
  it('estima la normal de un plano z en el eje y fuera del centro', () => {
    const scene = {
      classify: (p: Vec3): MaterialId => (p[2] < 0 ? 'vitrio' : 'paredGlobo'),
    };

    for (const point of [
      [0, 0, 0],
      [3, -2, 0],
    ] as Vec3[]) {
      const normal = interfaceNormal(scene, point, 'vitrio');
      expect(normal).not.toBeNull();
      expect(Math.abs(normal![2])).toBeGreaterThan(cosDeg(5));
    }
  });

  it('estima la normal de un plano oblicuo a 45 grados', () => {
    const scene = {
      classify: (p: Vec3): MaterialId => (p[0] + p[2] < 0 ? 'vitrio' : 'paredGlobo'),
    };
    const expected: Vec3 = [1 / Math.sqrt(2), 0, 1 / Math.sqrt(2)];
    const normal = interfaceNormal(scene, [3, 0, -3], 'vitrio');

    expect(normal).not.toBeNull();
    expect(
      Math.abs(normal![0] * expected[0] + normal![1] * expected[1] + normal![2] * expected[2]),
    ).toBeGreaterThan(cosDeg(5));
  });

  it('estima normales de una esfera en ejes y diagonal', () => {
    const scene = {
      classify: (p: Vec3): MaterialId =>
        p[0] * p[0] + p[1] * p[1] + p[2] * p[2] < 100 ? 'cristalino' : 'vitrio',
    };
    const directions: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
    ];

    for (const radial of directions) {
      const point: Vec3 = [radial[0] * 10, radial[1] * 10, radial[2] * 10];
      const normal = interfaceNormal(scene, point, 'cristalino');

      expect(normal).not.toBeNull();
      expect(
        Math.abs(normal![0] * radial[0] + normal![1] * radial[1] + normal![2] * radial[2]),
      ).toBeGreaterThan(cosDeg(15));
    }
  });

  it('mantiene la normal del plano x en el eje x', () => {
    const scene = {
      classify: (p: Vec3): MaterialId => (p[0] < 0 ? 'vitrio' : 'paredGlobo'),
    };
    const normal = interfaceNormal(scene, [0, 3, -2], 'vitrio');

    expect(normal).not.toBeNull();
    expect(Math.abs(normal![0])).toBeGreaterThan(cosDeg(5));
  });
});
