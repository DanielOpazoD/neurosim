import { beforeEach, describe, expect, it } from 'vitest';
import { clearErrors, errors, logError, logWarn, onError } from '../src/core/errorLog';

describe('registro de errores', () => {
  beforeEach(() => clearErrors());

  it('conserva como máximo 200 entradas y descarta las más antiguas', () => {
    for (let i = 0; i < 205; i++) logWarn('test', `warning-${i}`);
    expect(errors()).toHaveLength(200);
    expect(errors()[0]!.message).toBe('warning-5');
    expect(errors().at(-1)!.message).toBe('warning-204');
  });

  it('preserva el orden y notifica las nuevas entradas', () => {
    const seen: string[] = [];
    const unsubscribe = onError((entry) => seen.push(`${entry.scope}:${entry.message}`));
    logError('a', 'uno');
    logWarn('b', 'dos');
    unsubscribe();
    logError('c', 'tres');
    expect(seen).toEqual(['a:uno', 'b:dos']);
    expect(errors().map((entry) => entry.message)).toEqual(['uno', 'dos', 'tres']);
  });

  it('incluye mensaje y stack al registrar un Error', () => {
    const error = new Error('fallo de prueba');
    logError('test', error);
    expect(errors()[0]!.message).toContain('fallo de prueba');
    expect(errors()[0]!.message).toContain('Error: fallo de prueba');
  });
});
