import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docsRoot = join(root, 'docs');
const governingDocs = [
  'ARCHITECTURE.md',
  'CONVENTIONS.md',
  'INDEX.md',
  'DECISIONS.md',
  'LIMITATIONS.md',
  'APPROXIMATIONS.md',
  'PROVENANCE.md',
  'REFERENCES.md',
  'TESTING.md',
];

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function firstLine(path) {
  if (!existsSync(join(root, path))) return '# Índice documental';
  return (
    read(path)
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0) ?? ''
  );
}

function filesUnder(dir) {
  const result = [];
  const visit = (path) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) visit(full);
      else result.push(relative(root, full).replaceAll('\\', '/'));
    }
  };
  visit(join(root, dir));
  return result;
}

function citations(id) {
  return filesUnder('src')
    .concat(filesUnder('tests'))
    .filter((path) => read(path).includes(id));
}

function parseIds(path, prefix) {
  const pattern = new RegExp(`^[-\\d.\\s]*\\*\\*(${prefix}-\\d+) · ([^*]+)\\*\\*:`, 'gm');
  return [...read(path).matchAll(pattern)].map((match) => ({
    id: match[1],
    title: match[2].trim(),
    files: citations(match[1]),
  }));
}

function parameterCounts() {
  const counts = [];
  for (const path of filesUnder('src').filter((file) => file.endsWith('/params.ts'))) {
    const text = read(path);
    const pattern = /defineParameters\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\n\}\);/g;
    for (const match of text.matchAll(pattern)) {
      const keys = match[2].match(/^\x20{2}[a-z][A-Za-z0-9]*:\s*\{/gm) ?? [];
      counts.push({ name: match[1], count: keys.length });
    }
  }
  return counts;
}

function formatFiles(files) {
  return files.length ? files.map((file) => `\`${file}\``).join(', ') : '—';
}

function markdownTable(headers, rows, alignments = []) {
  const allRows = [headers, ...rows];
  const widths = headers.map(
    (_, column) => Math.max(...allRows.map((row) => String(row[column] ?? '').length)) + 2,
  );
  const formatRow = (row) =>
    `| ${row
      .map((value, column) => {
        const text = String(value ?? '');
        const width = widths[column] - 2;
        return alignments[column] === 'right' ? text.padStart(width) : text.padEnd(width);
      })
      .join(' | ')} |`;
  const separator = widths.map((width, column) =>
    column < alignments.length && alignments[column] === 'right'
      ? `${'-'.repeat(width - 3)}:`
      : '-'.repeat(width - 2),
  );
  return [formatRow(headers), formatRow(separator), ...rows.map(formatRow)];
}

function render() {
  const limitations = parseIds('docs/LIMITATIONS.md', 'LIM');
  const decisions = [...read('docs/DECISIONS.md').matchAll(/^\d+\. \*\*(DEC-\d+)\*\* — ([^\n]+)/gm)].map(
    (match) => ({
      id: match[1],
      title: match[2].trim(),
      files: citations(match[1]),
    }),
  );
  const lines = [
    '# Índice documental',
    '',
    'Índice generado por `npm run docs:index`; no editar manualmente.',
    '',
    '## Documentos rectores',
    '',
    ...markdownTable(
      ['Documento', 'Primera línea'],
      governingDocs.map((doc) => [`\`docs/${doc}\``, firstLine(`docs/${doc}`)]),
    ),
    '',
    '## IDs de limitaciones',
    '',
    ...markdownTable(
      ['ID', 'Título', 'Citas en `src/` y `tests/`'],
      limitations.map((item) => [item.id, item.title, formatFiles(item.files)]),
    ),
    '',
    '## IDs de decisiones',
    '',
    ...markdownTable(
      ['ID', 'Título', 'Citas en `src/` y `tests/`'],
      decisions.map((item) => [item.id, item.title, formatFiles(item.files)]),
    ),
    '',
    '## Parámetros registrados',
    '',
    ...markdownTable(
      ['Conjunto', 'Parámetros'],
      parameterCounts().map((item) => [`\`${item.name}\``, item.count]),
      ['left', 'right'],
    ),
    '',
  ];
  return `${lines.join('\n')}`;
}

const outputPath = join(docsRoot, 'INDEX.md');
const generated = render();
if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== generated) {
    console.error('docs/INDEX.md está desactualizado; ejecuta npm run docs:index');
    process.exit(1);
  }
} else {
  writeFileSync(outputPath, generated);
}
