/** How tall a cloud block is. Minecraft's proportion: under half its width. */
export const CLOUD_THICKNESS = 4;

/** Cells across one tile of the pattern. */
export const CLOUD_CELLS = 32;

/**
 * World units one cloud cell spans — the width of a single puff.
 *
 * What matters is the angle a puff subtends from the ground, not its absolute
 * size, so this is smaller than Minecraft's 12 to suit a lower deck.
 */
export const CELL_WORLD_SIZE = 10;

/** World units one full tile spans. */
export const TILE_WORLD_SIZE = CLOUD_CELLS * CELL_WORLD_SIZE;

/** World units the deck drifts per second, before each deck's own scaling. */
const WIND_SPEED = 0.6;

/** Extra coverage while it is raining, so a downpour comes with more cloud. */
const OVERCAST_BOOST = 0.22;

/**
 * A single deck of cloud.
 *
 * Stacking several at different heights is what gives the sky depth: decks
 * slide past each other at their own speeds, so one passes beneath another
 * rather than the whole sky moving as one sheet.
 *
 * Heights are bounded above by fog, not by the world — fog starts around 72
 * units out, so a deck much higher than the top one here dissolves into the
 * sky when looked at directly overhead.
 */
export interface CloudDeck {
  readonly height: number;
  /** Parallax: higher decks look slower because they are further away. */
  readonly driftScale: number;
  /** Fraction of cells that are cloud in fair weather. */
  readonly coverage: number;
  /** Shifts this deck's pattern so no two decks share a silhouette. */
  readonly seed: number;
}

export const CLOUD_DECKS: readonly CloudDeck[] = [
  { height: 112, driftScale: 1, coverage: 0.3, seed: 0 },
  { height: 130, driftScale: 0.74, coverage: 0.26, seed: 37 },
  { height: 150, driftScale: 0.52, coverage: 0.2, seed: 91 },
];

/**
 * Per-deck noise, kept as raw values rather than solid/empty flags.
 *
 * Storing the value means coverage becomes a threshold applied at read time,
 * so the overcast pattern is the fair-weather one with more cells passing —
 * clouds thicken in place instead of being replaced by an unrelated sky.
 */
const deckNoise = CLOUD_DECKS.map((deck) => buildNoise(deck.seed));

/** How far a deck has drifted at a given moment. */
export function deckDrift(deckIndex: number, elapsedSeconds: number): number {
  return elapsedSeconds * WIND_SPEED * CLOUD_DECKS[deckIndex].driftScale;
}

/** Whether a cell of a deck is cloud. Indices wrap, so each tile is a torus. */
export function isSolidCell(
  deckIndex: number,
  column: number,
  row: number,
  overcast: boolean,
): boolean {
  const values = deckNoise[deckIndex];
  const coverage = CLOUD_DECKS[deckIndex].coverage + (overcast ? OVERCAST_BOOST : 0);
  return values[wrapIndex(row) * CLOUD_CELLS + wrapIndex(column)] > 1 - coverage;
}

/**
 * Height of the lowest cloud over a world column, or null under open sky.
 *
 * Rain starts here rather than at a fixed altitude, so a drop falls from the
 * deck that actually produced it — under a gap in the low cloud, rain from the
 * deck above still reaches the ground, and from further up.
 */
export function cloudBaseAt(
  worldX: number,
  worldZ: number,
  elapsedSeconds: number,
  overcast: boolean,
): number | null {
  for (let deck = 0; deck < CLOUD_DECKS.length; deck++) {
    // Subtracting the drift is what makes the pattern move: a fixed world
    // column passes under different cells as time goes on.
    const patternX = worldX - deckDrift(deck, elapsedSeconds);
    const solid = isSolidCell(
      deck,
      Math.floor(patternX / CELL_WORLD_SIZE),
      Math.floor(worldZ / CELL_WORLD_SIZE),
      overcast,
    );
    // Decks are listed lowest first, so the first hit is the lowest base.
    if (solid) return CLOUD_DECKS[deck].height;
  }
  return null;
}

/**
 * Smoothed value noise, normalised to roughly [0, 1].
 *
 * Smoothing before thresholding is what makes cells join into connected blobs;
 * a per-cell random would scatter isolated specks with no silhouette.
 */
function buildNoise(seed: number): Float32Array {
  const size = CLOUD_CELLS;
  const values = new Float32Array(size * size);

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const u = column / size;
      const v = row / size;
      // Two octaves, both wrapping on the tile, so the pattern is seamless.
      values[row * size + column] =
        tileableNoise(u, v, 4, seed) * 0.65 + tileableNoise(u, v, 8, seed) * 0.35;
    }
  }

  return values;
}

function wrapIndex(value: number): number {
  return ((value % CLOUD_CELLS) + CLOUD_CELLS) % CLOUD_CELLS;
}

/** Value noise on a torus, so opposite edges of the tile always agree. */
function tileableNoise(u: number, v: number, frequency: number, seed: number): number {
  const x = u * frequency;
  const y = v * frequency;
  const xi = Math.floor(x);
  const yi = Math.floor(y);

  const wrap = (value: number): number => ((value % frequency) + frequency) % frequency;
  const corner = (cx: number, cy: number): number => hash(wrap(cx), wrap(cy), seed);

  const fx = smoothstep(x - xi);
  const fy = smoothstep(y - yi);

  const top = lerp(corner(xi, yi), corner(xi + 1, yi), fx);
  const bottom = lerp(corner(xi, yi + 1), corner(xi + 1, yi + 1), fx);
  return lerp(top, bottom, fy);
}

function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
