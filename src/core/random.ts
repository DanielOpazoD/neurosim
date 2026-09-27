// Portado de DanielOpazoD/vexus-sim @ 59fb7b18e9c1 — src/core/random.ts (MIT).
// Adaptación local: neurosono-sim. Ver docs/PROVENANCE.md.

/**
 * Generador pseudoaleatorio determinista (guía §20): misma semilla → misma
 * secuencia. Se usa para dispersores Doppler, ruido electrónico, variabilidad
 * de RR y cualquier otra fuente estocástica del motor.
 *
 * sfc32 (Chris Doty-Humphrey), dominio público; periodo ~2^128.
 */
export class SeededRandom {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    // Mezcla inicial (splitmix-like) para separar semillas cercanas.
    let x = (s ^ 0x9e3779b9) >>> 0;
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.uint32();
  }

  uint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniforme en [0, 1). */
  float(): number {
    return this.uint32() / 4294967296;
  }

  /** Uniforme en [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  /** Normal estándar (Box–Muller). */
  gaussian(): number {
    let u = 0;
    while (u === 0) u = this.float();
    const v = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Deriva un generador hijo independiente y reproducible. */
  fork(label: string): SeededRandom {
    return new SeededRandom((this.uint32() ^ hashString(label)) >>> 0);
  }
}

export function hashString(s: string): number {
  // FNV-1a 32 bits
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Hash espacial 3D → [0,1). Misma función que en GLSL (`hash3`): los dispersores
 * del modo B y los del Doppler viven en el mismo campo material.
 */
export function hash3(x: number, y: number, z: number, salt = 0): number {
  let h =
    Math.imul((x | 0) * 73856093, 1) ^
    Math.imul((y | 0) * 19349663, 1) ^
    Math.imul((z | 0) * 83492791, 1) ^
    (salt | 0);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}
