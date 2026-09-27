import type { BModeFrame } from '../../src/ultrasound/bmode';
import type { SpectralColumn } from '../../src/doppler/spectral';

function fnv1a(values: Iterable<number>): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const word = value >>> 0;
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (word >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

export function hashBMode(frame: BModeFrame): string {
  return fnv1a(Array.from(frame.db, (db) => Math.round(db * 10)));
}

export function hashSpectral(columns: readonly SpectralColumn[]): string {
  return fnv1a(columns.flatMap((column) => Array.from(column.powerDb, (v) => Math.round(v * 1000))));
}
