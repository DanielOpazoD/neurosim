import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
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

/*
 * Recursos binarios (DEC-59): | `ruta` | origen | SHA-256 | licencia | `archivo de licencia` | ...
 * Se comprueba que el archivo exista, que su SHA-256 coincida, que el archivo
 * de licencia exista y nombre la licencia declarada, y que no haya recursos
 * en public/models sin fila en la tabla.
 */
const LICENCES = { 'CC BY 3.0': 'Creative Commons Attribution 3.0' };
const assetRows = [
  ...text.matchAll(
    /^\|\s*`(public\/[^`]+)`\s*\|[^|]*\|\s*([0-9a-f]{64})\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/gim,
  ),
];
const listed = new Set();
for (const [, file, sha, licence, licenceFile] of assetRows) {
  listed.add(file);
  const path = join(root, file);
  if (!existsSync(path)) {
    errors.push(`${file}: no existe`);
    continue;
  }
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== sha) errors.push(`${file}: SHA-256 ${actual} ≠ ${sha}`);
  const expected = LICENCES[licence];
  if (!expected) {
    errors.push(`${file}: licencia no reconocida «${licence}»`);
    continue;
  }
  const licencePath = join(root, licenceFile);
  if (!existsSync(licencePath)) {
    errors.push(`${file}: falta el archivo de licencia ${licenceFile}`);
  } else if (!readFileSync(licencePath, 'utf8').includes(expected)) {
    errors.push(`${licenceFile}: no menciona «${expected}»`);
  }
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
for (const path of walk(join(root, 'public/models'))) {
  const file = relative(root, path).split('\\').join('/');
  const isLicence = assetRows.some(([, , , , licenceFile]) => licenceFile === file);
  if (!listed.has(file) && !isLicence && !file.endsWith('.DS_Store')) {
    errors.push(`${file}: recurso sin fila en docs/PROVENANCE.md`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`provenance:check OK (${rows.length} archivos, ${assetRows.length} recursos binarios)`);
