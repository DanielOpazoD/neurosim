import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const provenancePath = join(root, 'docs/PROVENANCE.md');
const text = readFileSync(provenancePath, 'utf8');
const rows = [...text.matchAll(/^\|\s*`([^`]+)`\s*\|.*?\|\s*([0-9a-f]+)\s*\|\s*MIT\s*\|/gim)];
const errors = [];

for (const [, file, sha] of rows) {
  const path = join(root, file);
  if (!existsSync(path)) {
    errors.push(`${file}: no existe`);
    continue;
  }
  const header = readFileSync(path, 'utf8').split(/\r?\n/).slice(0, 12).join('\n');
  if (!header.includes(sha) || !header.includes('MIT')) {
    errors.push(`${file}: la cabecera no contiene SHA ${sha} y MIT`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`provenance:check OK (${rows.length} archivos)`);
