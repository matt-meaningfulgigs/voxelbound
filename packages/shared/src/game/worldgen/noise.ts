// ---------------------------------------------------------------------------
// Seeded RNG + coordinate noise. Everything procedural in the world derives
// from a single integer world seed so the world is stable across reloads and
// map transitions (no more teleporting trees).
// ---------------------------------------------------------------------------

/** Deterministic, fast 32-bit PRNG (mulberry32). Stateful stream. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = (seed >>> 0) || 1;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick a random element. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }

  /** Fisher-Yates in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }

  /** Gaussian-ish via summed uniforms (Irwin-Hall, n=3), centered on 0. */
  gauss(spread = 1): number {
    return ((this.next() + this.next() + this.next()) / 3 - 0.5) * 2 * spread;
  }
}

/** Mix several integers into one 32-bit seed (order-sensitive). */
export function hashSeed(...nums: number[]): number {
  let h = 0x811c9dc5;
  for (const n of nums) {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic hash of an integer lattice point -> [0, 1). */
function hash2(ix: number, iy: number, seed: number): number {
  let h = seed ^ Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smooth value noise in [0, 1] at continuous (x, y). */
export function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

export interface FbmOptions {
  octaves?: number;
  frequency?: number;
  lacunarity?: number;
  gain?: number;
}

/** Fractal Brownian motion (summed octaves of value noise) in [0, 1]. */
export function fbm2D(x: number, y: number, seed: number, opts: FbmOptions = {}): number {
  const { octaves = 4, frequency = 1, lacunarity = 2, gain = 0.5 } = opts;
  let amp = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2D(x * freq, y * freq, hashSeed(seed, o + 1));
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Ridged noise (sharp ridges, good for rock/mountains) in [0, 1]. */
export function ridge2D(x: number, y: number, seed: number, opts: FbmOptions = {}): number {
  const n = fbm2D(x, y, seed, opts);
  return 1 - Math.abs(n * 2 - 1);
}
