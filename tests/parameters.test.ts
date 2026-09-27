import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARAMETER_SETS } from '../src/domain/parameters';

const references = readFileSync(resolve(process.cwd(), 'docs/REFERENCES.md'), 'utf8');
const approximations = readFileSync(resolve(process.cwd(), 'docs/APPROXIMATIONS.md'), 'utf8');

describe('registro de parámetros', () => {
  it('carga todos los conjuntos por dominio', () => {
    expect(PARAMETER_SETS).toHaveLength(5);
    for (const set of PARAMETER_SETS) expect(set.params).toBeDefined();
  });

  it('mantiene todas las fuentes en la bibliografía', () => {
    for (const set of PARAMETER_SETS) {
      for (const [id, parameter] of Object.entries(set.params)) {
        for (const source of parameter.sources) {
          expect(references, `${set.name}.${id} → ${source}`).toContain(`**${source}**`);
        }
      }
    }
  });

  it('documenta cada aproximación', () => {
    for (const set of PARAMETER_SETS) {
      for (const [id, parameter] of Object.entries(set.params)) {
        if (parameter.evidence === 'estimado' || parameter.evidence === 'extrapolacion') {
          expect(approximations, `${set.name}.${id}`).toContain(`**${set.name}.${id}**`);
        }
      }
    }
  });

  it('no duplica ids entre conjuntos', () => {
    const ids = PARAMETER_SETS.flatMap((set) => Object.keys(set.params));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
