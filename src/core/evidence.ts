// Portado de DanielOpazoD/lus-sim @ 8ed8a6de918a — src/core/evidence.ts (MIT).
// Adaptación local: neurosono-sim. Ver docs/PROVENANCE.md.

/**
 * Evidencia de los parámetros del modelo (decisión 4).
 *
 * Todo número que entra en la anatomía, la física o la clínica se declara con `defineParameters`: valor,
 * unidad, rango plausible, tipo de evidencia y fuentes (claves de `docs/REFERENCES.md`). Así «¿de dónde
 * sale este número?» se responde leyendo el código, y la suite (`src/validation/evidence.test.ts`)
 * comprueba que cada fuente existe en la bibliografía y que lo estimado figura en
 * `docs/APPROXIMATIONS.md` con su plan de calibración.
 *
 * Tipos de evidencia:
 *  - `documentado`: medido en un estudio. Fuente obligatoria.
 *  - `consenso`: guía o consenso de expertos. Fuente obligatoria.
 *  - `derivado`: calculado a partir de valores documentados. Fuente obligatoria; el cálculo va en `note`.
 *  - `estimado`: valor razonable sin medición directa. Rango obligatorio; se calibra.
 *  - `extrapolacion`: extrapolación propia fuera de lo medido. Rango obligatorio; se calibra.
 *
 * El código portado de VExUS conserva sus etiquetas en comentario (`[ESTIMADO …]`,
 * `[EXTRAPOLACIÓN PROPIA]`, `NEEDS_CALIBRATION`) para no divergir de su origen (decisión 3); lo propio
 * de lus-sim usa este registro.
 */
export type Evidence = 'documentado' | 'consenso' | 'derivado' | 'estimado' | 'extrapolacion';

export const EVIDENCE_KINDS: readonly Evidence[] = [
  'documentado',
  'consenso',
  'derivado',
  'estimado',
  'extrapolacion',
];

export interface Parameter {
  /** Valor que usa el modelo, en `unit`. */
  readonly value: number;
  /** Unidad del motor (mm, s, dB, dB/cm/MHz, m/s, fracción…). */
  readonly unit: string;
  /** Intervalo plausible [mín, máx] en la misma unidad; contiene a `value`. */
  readonly range?: readonly [number, number];
  readonly evidence: Evidence;
  /** Claves de `docs/REFERENCES.md` (p. ej. `volpicelli-consenso-2012`). */
  readonly sources: readonly string[];
  /** Población, localización en la fuente, cálculo de un valor derivado o plan de calibración. */
  readonly note?: string;
}

/** Evidencias que exigen al menos una fuente. */
export const NEEDS_SOURCE: ReadonlySet<Evidence> = new Set<Evidence>(['documentado', 'consenso', 'derivado']);
/** Evidencias que exigen rango (y entrada en APPROXIMATIONS.md, que comprueba la suite). */
export const NEEDS_RANGE: ReadonlySet<Evidence> = new Set<Evidence>(['estimado', 'extrapolacion']);

/** Formato de una clave bibliográfica: minúsculas, dígitos y guiones (`autor-tema-año`). */
export const SOURCE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Problemas de un parámetro; lista vacía si es válido. `id` solo sirve para el mensaje. */
export function parameterProblems(id: string, p: Parameter): string[] {
  const out: string[] = [];
  if (!Number.isFinite(p.value)) out.push(`${id}: valor no finito (${p.value})`);
  if (p.unit.trim() === '') out.push(`${id}: sin unidad`);
  if (!EVIDENCE_KINDS.includes(p.evidence)) out.push(`${id}: evidencia desconocida «${String(p.evidence)}»`);
  if (NEEDS_SOURCE.has(p.evidence) && p.sources.length === 0)
    out.push(`${id}: evidencia «${p.evidence}» sin fuente`);
  if (NEEDS_RANGE.has(p.evidence) && !p.range) out.push(`${id}: evidencia «${p.evidence}» sin rango`);
  for (const s of p.sources) if (!SOURCE_KEY.test(s)) out.push(`${id}: clave de fuente mal formada «${s}»`);
  if (p.range) {
    const [lo, hi] = p.range;
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi))
      out.push(`${id}: rango inválido [${lo}, ${hi}]`);
    else if (p.value < lo || p.value > hi)
      out.push(`${id}: valor ${p.value} fuera de su rango [${lo}, ${hi}]`);
  }
  if (p.evidence === 'derivado' && !p.note) out.push(`${id}: valor derivado sin el cálculo en la nota`);
  return out;
}

/** Un conjunto de parámetros con nombre: lo que registra `src/validation/parameterSets.ts`. */
export interface ParameterSet<K extends string = string> {
  readonly name: string;
  readonly params: Readonly<Record<K, Parameter>>;
}

/**
 * Declara un conjunto de parámetros y lo valida al cargar el módulo: un parámetro sin evidencia válida
 * rompe la importación (y con ella la suite y el build), no se descubre en producción.
 */
export function defineParameters<K extends string>(
  name: string,
  params: Record<K, Parameter>,
): ParameterSet<K> {
  const problems = Object.entries<Parameter>(params).flatMap(([id, p]) =>
    parameterProblems(`${name}.${id}`, p),
  );
  if (problems.length > 0) throw new Error(`Parámetros sin evidencia válida:\n${problems.join('\n')}`);
  return Object.freeze({ name, params: Object.freeze({ ...params }) });
}
