import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

describe('índice documental', () => {
  it('está actualizado', () => {
    execFileSync(process.execPath, [resolve(process.cwd(), 'scripts/docs-index.mjs'), '--check'], {
      stdio: 'pipe',
    });
  });
});
