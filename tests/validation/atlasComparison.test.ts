import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWillisVessels } from '../../src/anatomy/willis';
import {
  compareWithAtlas,
  envelope,
  fixtureMetrics,
  inEnvelope,
  type AtlasDocument,
} from '../../src/anatomy/atlas';

/**
 * DEC-77: el atlas derivado de TopCoW es una referencia externa de geometría
 * del polígono de Willis. Las pruebas verifican (1) la integridad y
 * orientación del derivado y (2) qué métricas del fixture sintético quedan
 * fuera de la envolvente observada. Las desviaciones conocidas se declaran en
 * LIM-36; una desviación nueva o una ya resuelta hace fallar la prueba para
 * obligar a actualizar la documentación.
 */
const ATLASES = ['data/atlas/topcow-cta-largeia.json', 'data/atlas/topcow-mra-ixi-hh.json'] as const;

function load(path: string): AtlasDocument {
  return JSON.parse(readFileSync(path, 'utf8')) as AtlasDocument;
}

/**
 * Métricas del fixture fuera de la envolvente del atlas (LIM-36). Vacío desde
 * DEC-78: terminales de ACI, punta basilar y P2 se ajustaron a las medianas.
 */
const DOCUMENTED_DEVIATIONS: Readonly<Record<string, readonly string[]>> = {
  'data/atlas/topcow-cta-largeia.json': [],
  'data/atlas/topcow-mra-ixi-hh.json': [],
};

describe('atlas TopCoW derivado (DEC-77)', () => {
  it('envolvente: mín/mediana/máx y pertenencia', () => {
    const e = envelope([3, 1, 2, 10]);
    expect(e).toEqual({ n: 4, min: 1, median: 2.5, max: 10 });
    expect(inEnvelope(2.5, e)).toBe(true);
    expect(inEnvelope(10.1, e)).toBe(false);
    expect(() => envelope([NaN])).toThrow();
  });

  for (const path of ATLASES) {
    describe(path, () => {
      const doc = load(path);

      it('declara procedencia, licencia y marco', () => {
        expect(doc.schemaVersion).toBe(1);
        expect(doc.source.doi).toBe('10.5281/zenodo.15692630');
        expect(doc.source.zipSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(doc.source.licence).toContain('TopCoW');
        expect(doc.frame.output).toContain('[-R, S, A]');
        expect(doc.cases.length).toBeGreaterThanOrEqual(10);
      });

      it('cada caso respeta lateralidad y ejes del marco del simulador', () => {
        for (const c of doc.cases) {
          expect(c.orientation).toBe('LPS');
          const r = c.segments['R-ICA'];
          const l = c.segments['L-ICA'];
          expect(r && l, `${c.id}: faltan ACI`).toBeTruthy();
          expect(r!.endMm[0]).toBeLessThan(0);
          expect(l!.endMm[0]).toBeGreaterThan(0);
          const ba = c.segments['BA'];
          if (ba) expect(ba.endMm[1]).toBeGreaterThan(ba.startMm[1]);
          for (const k of ['R-ACA', 'L-ACA']) {
            const s = c.segments[k];
            if (s) expect(s.endMm[2], `${c.id} ${k}`).toBeGreaterThan(s.startMm[2]);
          }
          for (const s of Object.values(c.segments)) {
            expect(s.radiusMedianMm).toBeGreaterThan(0.3);
            expect(s.radiusMedianMm).toBeLessThan(4);
            expect(s.lengthMm).toBeGreaterThan(0);
          }
        }
      });

      it('la topología declarada (yml) coincide con las etiquetas presentes', () => {
        for (const c of doc.cases) {
          if (!c.edges) continue;
          for (const k of ['Acom', 'R-Pcom', 'L-Pcom']) {
            expect(c.labelsPresent.includes(k), `${c.id} ${k}`).toBe(c.edges[k] === 1);
            expect(Boolean(c.segments[k]), `${c.id} ${k} segmento`).toBe(c.edges[k] === 1);
          }
        }
      });

      it('las desviaciones del fixture respecto al atlas son exactamente las documentadas (LIM-36)', () => {
        const fx = fixtureMetrics(buildWillisVessels('normal'));
        const rows = compareWithAtlas(doc, fx);
        const table = rows
          .map(
            (r) =>
              `${r.inside ? ' ' : '!'} ${r.metric.padEnd(20)} fixture=${r.fixture.toFixed(2).padStart(7)}  atlas=[${r.atlas.min.toFixed(2)}, ${r.atlas.median.toFixed(2)}, ${r.atlas.max.toFixed(2)}] n=${r.atlas.n}`,
          )
          .join('\n');
        const outside = rows.filter((r) => !r.inside).map((r) => r.metric);
        expect(outside, table).toEqual([...DOCUMENTED_DEVIATIONS[path]!]);
      });
    });
  }
});
