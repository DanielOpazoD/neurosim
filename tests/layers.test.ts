import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), 'src');

const allowed = {
  core: new Set<string>(),
  anatomy: new Set(['core', 'domain']),
  physiology: new Set(['core', 'anatomy', 'domain']),
  ultrasound: new Set(['core', 'anatomy', 'domain']),
  doppler: new Set(['core', 'anatomy', 'physiology', 'ultrasound', 'domain']),
  domain: new Set(['core', 'anatomy', 'physiology', 'ultrasound', 'doppler']),
  app: new Set(['core', 'anatomy', 'physiology', 'ultrasound', 'doppler', 'domain']),
  ui: new Set(['core', 'anatomy', 'physiology', 'ultrasound', 'doppler', 'domain', 'app']),
} as const;

const anatomyPhysiologyDataModule = 'physiology/params.ts';

function filesUnder(path: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(path)) {
    const full = resolve(path, entry);
    if (statSync(full).isDirectory()) result.push(...filesUnder(full));
    else if (full.endsWith('.ts')) result.push(full);
  }
  return result;
}

function firstLayer(path: string): string {
  return relative(root, path).split('/')[0]!;
}

function resolveImport(source: string, specifier: string): string | null {
  const base = resolve(dirname(source), specifier);
  const candidates = [base, `${base}.ts`, resolve(base, 'index.ts')];
  return candidates.find((candidate) => filesUnder(resolve(candidate, '..')).includes(candidate)) ?? null;
}

function importsOf(source: string): Array<{ specifier: string; typeOnly: boolean }> {
  const text = readFileSync(source, 'utf8');
  const imports: Array<{ specifier: string; typeOnly: boolean }> = [];
  const staticPattern = /\bimport\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"](\.\.?\/[^'"]+)['"]/g;
  for (const match of text.matchAll(staticPattern)) {
    imports.push({ specifier: match[2]!, typeOnly: Boolean(match[1]) });
  }
  const dynamicPattern = /\bimport\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
  for (const match of text.matchAll(dynamicPattern)) {
    imports.push({ specifier: match[1]!, typeOnly: false });
  }
  return imports;
}

function edges(): Array<{
  from: string;
  to: string;
  file: string;
  destination: string;
  typeOnly: boolean;
}> {
  const result = [];
  for (const file of filesUnder(root)) {
    for (const imported of importsOf(file)) {
      const destination = resolveImport(file, imported.specifier);
      if (destination) {
        result.push({
          from: firstLayer(file),
          to: firstLayer(destination),
          file: relative(resolve(root, '..'), file),
          destination: relative(root, destination),
          typeOnly: imported.typeOnly,
        });
      }
    }
  }
  return result;
}

describe('fronteras de capas', () => {
  it('respeta la matriz de dependencias documentada', () => {
    const violations = edges().filter(({ from, to, file, destination, typeOnly }) => {
      if (from === to) return false;
      if (from === 'anatomy' && to === 'domain' && !typeOnly) return true;
      if (from === 'anatomy' && to === 'physiology') {
        return !(file === 'src/anatomy/head.ts' && destination === anatomyPhysiologyDataModule);
      }
      if (allowed[from as keyof typeof allowed].has(to)) return false;
      return true;
    });
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it('reserva las referencias al entorno del navegador para src/ui', () => {
    const browserReference =
      /(?<![\w.])(?:document|window)\s*(?:\.|\[)|\bHTMLCanvasElement\b|\bCanvasRenderingContext2D\b|\bOffscreenCanvas\b|\bImageData\b|\bnavigator\b|\blocalStorage\b|\brequestAnimationFrame\b/;
    const violations = filesUnder(root)
      .filter((file) => browserReference.test(readFileSync(file, 'utf8')))
      .filter((file) => firstLayer(file) !== 'ui');
    expect(violations).toEqual([]);
  });
});
