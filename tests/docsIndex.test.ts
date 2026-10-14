import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('índice documental', () => {
  it('incluye también las decisiones escritas como encabezados', () => {
    const decisions = readFileSync('docs/DECISIONS.md', 'utf8');
    const index = readFileSync('docs/INDEX.md', 'utf8');
    for (const [, id] of decisions.matchAll(/^## (DEC-\d+) · /gm)) {
      expect(index).toMatch(new RegExp(`\\|\\s*${id}\\s*\\|`));
    }
  });
  it('está actualizado', () => {
    execFileSync(process.execPath, [resolve(process.cwd(), 'scripts/docs-index.mjs'), '--check'], {
      stdio: 'pipe',
    });
  });
});
