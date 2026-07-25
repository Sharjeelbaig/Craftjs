/**
 * Deterministic, allocation-free noise.
 *
 * Terrain must be reproducible from a seed alone: the same coordinates always
 * yield the same value, in any order, on any machine. That lets chunks be
 * generated lazily and independently, and keeps saves tiny (only edits are
 * stored — the base terrain is recomputed).
 */

/** 32-bit integer hash of a 2D lattice point. Returns a uint32. */
export function hash2(x: number, z: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h ^ (z | 0), 0x165667b1);
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of a 2D lattice point mapped to [0, 1). */
export function random2(x: number, z: number, seed: number): number {
  return hash2(x, z, seed) / 4294967296;
}

/** Smoothstep — C1-continuous interpolation weight. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise in [0, 1). Cheaper than gradient noise and, once layered into
 * fbm, visually sufficient for terrain height fields.
 */
export function valueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);

  const n00 = random2(x0, z0, seed);
  const n10 = random2(x0 + 1, z0, seed);
  const n01 = random2(x0, z0 + 1, seed);
  const n11 = random2(x0 + 1, z0 + 1, seed);

  const top = n00 + (n10 - n00) * fx;
  const bottom = n01 + (n11 - n01) * fx;
  return top + (bottom - top) * fz;
}

export interface FbmOptions {
  readonly octaves: number;
  readonly frequency: number;
  readonly lacunarity?: number;
  readonly persistence?: number;
}

/**
 * Fractal Brownian motion over value noise, normalised to [0, 1].
 */
export function fbm2(x: number, z: number, seed: number, options: FbmOptions): number {
  const lacunarity = options.lacunarity ?? 2;
  const persistence = options.persistence ?? 0.5;

  let frequency = options.frequency;
  let amplitude = 1;
  let total = 0;
  let normalisation = 0;

  for (let octave = 0; octave < options.octaves; octave++) {
    // Offsetting the seed per octave keeps layers decorrelated.
    total += valueNoise2(x * frequency, z * frequency, (seed + octave * 0x9e3779b1) | 0) * amplitude;
    normalisation += amplitude;
    frequency *= lacunarity;
    amplitude *= persistence;
  }

  return normalisation > 0 ? total / normalisation : 0;
}

/**
 * Small deterministic PRNG (mulberry32) for sequential draws from one seed.
 * Used where a stream of values is needed, e.g. texture generation.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derives a stable 32-bit seed from arbitrary user text. */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
