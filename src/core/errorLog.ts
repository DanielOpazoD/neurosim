/**
 * Registro circular de errores y advertencias del simulador.
 * No conoce el DOM; la UI decide cómo presentar y exportar sus entradas.
 */
export interface ErrorLogEntry {
  readonly t: number;
  readonly scope: string;
  readonly message: string;
  readonly data?: unknown;
}

type ErrorListener = (entry: ErrorLogEntry) => void;

const CAPACITY = 200;
const buffer: ErrorLogEntry[] = [];
const listeners = new Set<ErrorListener>();

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ? `${err.message}\n${err.stack}` : err.message;
  }
  return typeof err === 'string' ? err : String(err);
}

function append(scope: string, err: unknown, data?: unknown): void {
  const entry: ErrorLogEntry = { t: Date.now(), scope, message: messageOf(err), data };
  if (buffer.length >= CAPACITY) buffer.shift();
  buffer.push(entry);
  for (const listener of listeners) listener(entry);
}

export function logError(scope: string, err: unknown, data?: unknown): void {
  append(scope, err, data);
}

export function logWarn(scope: string, err: unknown, data?: unknown): void {
  append(scope, err, data);
}

export function errors(): readonly ErrorLogEntry[] {
  return buffer.slice();
}

export function clearErrors(): void {
  buffer.length = 0;
}

export function onError(listener: ErrorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
