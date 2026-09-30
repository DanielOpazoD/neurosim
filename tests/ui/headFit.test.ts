import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildReferenceCase } from '../../src/domain/referenceCase';
import {
  applyFit,
  fitHeadScan,
  fitReport,
  LEE_PERRY_SMITH_FIT,
  lidTarget,
  scanEyeCenters,
} from '../../src/ui/headFit';
import { EYE_PROBE_STANDOFF_MM } from '../../src/app/poses';

describe('ajuste de la cabeza escaneada (DEC-59)', () => {
  const sim = buildReferenceCase();

  it('los centros oculares del asset coinciden con sim.eyes.*.center; la sonda apoya en el párpado', () => {
    const fit = fitHeadScan(sim);
    const depth = (sim.eyes.der.globeRadiusMm + sim.eyes.izq.globeRadiusMm) / 2 + EYE_PROBE_STANDOFF_MM;
    const centers = scanEyeCenters(LEE_PERRY_SMITH_FIT, depth / fit.scale[2]);
    for (const side of ['der', 'izq'] as const) {
      const c = applyFit(fit, centers[side]);
      c.forEach((v, i) => expect(Math.abs(v - sim.eyes[side].center[i]!)).toBeLessThan(1e-9));
      // Párpado del asset frente al contacto de la sonda ocular del caso.
      const src = side === 'der' ? LEE_PERRY_SMITH_FIT.lidDer : LEE_PERRY_SMITH_FIT.lidIzq;
      const lid = applyFit(fit, src);
      const t = lidTarget(sim, side);
      lid.forEach((v, i) => expect(Math.abs(v - t[i]!)).toBeLessThan(0.1));
    }
  });

  it('semejanza: escala uniforme; la anisotropía opcional se limita al 10 %', () => {
    const fit = fitHeadScan(sim);
    expect(fit.scale[1]).toBe(fit.scale[0]);
    expect(fit.scale[2]).toBe(fit.scale[0]);
    const aniso = fitHeadScan(sim, LEE_PERRY_SMITH_FIT, 0.5);
    expect(aniso.scale[1] / aniso.scale[0]).toBeCloseTo(1.1, 12);
    const r = fitReport(sim, fit);
    // Documentado en DEC-59: los ojos mandan; el cráneo escaneado resulta más ancho.
    expect(r.caseWidthMm).toBe(sim.head.skullRadii[0] * 2 + 14);
    expect(r.ratio).toBeGreaterThan(1);
    expect(r.ratio).toBeLessThan(1.2);
  });

  it('el asset y su licencia están en public/models/head', () => {
    const dir = resolve(process.cwd(), 'public/models/head');
    for (const f of [
      'LeePerrySmith.glb',
      'Map-COL.jpg',
      'Infinite-Level_02_Tangent_SmoothUV.jpg',
      'LeePerrySmith_License.txt',
    ]) {
      expect(existsSync(resolve(dir, f)), f).toBe(true);
    }
    const licence = readFileSync(resolve(dir, 'LeePerrySmith_License.txt'), 'utf8');
    expect(licence).toContain('Creative Commons Attribution 3.0');
  });
});
