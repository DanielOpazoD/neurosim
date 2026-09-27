/**
 * Buffer de cine: conserva cuadros, limita su tamaño y reproduce índices.
 * Las funciones mutan únicamente el estado recibido.
 */
import type { AppState, CineItem } from './state';

const MAX_CINE = 64;

export function pushCine(s: AppState, item: CineItem): void {
  s.cine.push(item);
  if (s.cine.length > MAX_CINE) s.cine.shift();
}

export function clearCine(s: AppState): void {
  s.cine.length = 0;
  s.cineIdx = 0;
  s.cinePlaying = false;
}

export function nextCine(s: AppState): CineItem | null {
  if (!s.cine.length) return null;
  s.cineIdx = (s.cineIdx + 1) % s.cine.length;
  return s.cine[s.cineIdx]!;
}
