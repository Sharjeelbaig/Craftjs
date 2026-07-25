import * as THREE from 'three';
import { TEXTURE_COUNT, TextureId } from '@domain/world/BlockType';
import { createRandom } from '@domain/generation/Noise';

/** Edge length of one block texture, in pixels. */
export const TILE_SIZE = 16;

const CHANNELS = 4;
const TILE_BYTES = TILE_SIZE * TILE_SIZE * CHANNELS;

type Painter = (tile: Uint8Array, random: () => number) => void;

function setPixel(tile: Uint8Array, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const offset = (y * TILE_SIZE + x) * CHANNELS;
  tile[offset] = r;
  tile[offset + 1] = g;
  tile[offset + 2] = b;
  tile[offset + 3] = a;
}

/** Flat fill with per-pixel brightness jitter, the basis of most block looks. */
function noisyFill(
  tile: Uint8Array,
  random: () => number,
  r: number,
  g: number,
  b: number,
  jitter: number,
): void {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const delta = (random() - 0.5) * 2 * jitter;
      setPixel(
        tile,
        x,
        y,
        clampByte(r + delta),
        clampByte(g + delta),
        clampByte(b + delta),
      );
    }
  }
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

const painters: Record<number, Painter> = {
  [TextureId.Stone]: (tile, random) => {
    noisyFill(tile, random, 128, 128, 132, 16);
    scatterSpecks(tile, random, 26, 104, 104, 108);
  },
  [TextureId.Dirt]: (tile, random) => {
    noisyFill(tile, random, 134, 96, 67, 18);
    scatterSpecks(tile, random, 30, 108, 76, 52);
  },
  [TextureId.GrassTop]: (tile, random) => {
    noisyFill(tile, random, 106, 158, 74, 20);
    scatterSpecks(tile, random, 34, 88, 138, 60);
  },
  [TextureId.GrassSide]: (tile, random) => {
    noisyFill(tile, random, 134, 96, 67, 18);
    // Grass fringe hanging over the dirt, ragged so it does not read as a band.
    for (let x = 0; x < TILE_SIZE; x++) {
      const depth = 3 + Math.floor(random() * 3);
      for (let y = 0; y < depth; y++) {
        const shade = (random() - 0.5) * 26;
        setPixel(tile, x, y, clampByte(106 + shade), clampByte(158 + shade), clampByte(74 + shade));
      }
    }
  },
  [TextureId.Sand]: (tile, random) => {
    noisyFill(tile, random, 214, 200, 148, 14);
    scatterSpecks(tile, random, 20, 196, 180, 128);
  },
  [TextureId.Water]: (tile, random) => {
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const ripple = Math.sin((x + y) * 0.9) * 8 + (random() - 0.5) * 10;
        setPixel(tile, x, y, clampByte(52 + ripple), clampByte(108 + ripple), clampByte(196 + ripple), 190);
      }
    }
  },
  [TextureId.LogSide]: (tile, random) => {
    noisyFill(tile, random, 108, 82, 50, 10);
    // Vertical grain.
    for (let x = 0; x < TILE_SIZE; x++) {
      if (random() > 0.34) continue;
      const shade = -22 - random() * 16;
      for (let y = 0; y < TILE_SIZE; y++) {
        const offset = (y * TILE_SIZE + x) * CHANNELS;
        tile[offset] = clampByte(tile[offset] + shade);
        tile[offset + 1] = clampByte(tile[offset + 1] + shade);
        tile[offset + 2] = clampByte(tile[offset + 2] + shade);
      }
    }
  },
  [TextureId.LogTop]: (tile, random) => {
    noisyFill(tile, random, 158, 126, 82, 10);
    // Concentric growth rings.
    const centre = (TILE_SIZE - 1) / 2;
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const distance = Math.hypot(x - centre, y - centre);
        const ring = Math.sin(distance * 2.2) * 20;
        const offset = (y * TILE_SIZE + x) * CHANNELS;
        tile[offset] = clampByte(tile[offset] + ring);
        tile[offset + 1] = clampByte(tile[offset + 1] + ring);
        tile[offset + 2] = clampByte(tile[offset + 2] + ring);
      }
    }
  },
  [TextureId.Leaves]: (tile, random) => {
    // Opaque rather than alpha-tested: cutout foliage needs mip-aware alpha
    // handling to avoid dissolving at distance, which is not worth the cost.
    noisyFill(tile, random, 62, 118, 48, 26);
    scatterSpecks(tile, random, 60, 44, 90, 34);
    scatterSpecks(tile, random, 26, 86, 142, 62);
  },
  [TextureId.Planks]: (tile, random) => {
    noisyFill(tile, random, 168, 132, 82, 10);
    for (let y = 0; y < TILE_SIZE; y++) {
      if (y % 4 !== 0) continue;
      for (let x = 0; x < TILE_SIZE; x++) {
        setPixel(tile, x, y, 132, 100, 60);
      }
    }
  },
  [TextureId.Cobblestone]: (tile, random) => {
    noisyFill(tile, random, 118, 118, 122, 12);
    // Mortar grid, jittered so the pattern does not tile visibly.
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const cellX = (x + (Math.floor(y / 5) % 2) * 2) % 5;
        const cellY = y % 5;
        if (cellX === 0 || cellY === 0) {
          const shade = -34 + random() * 12;
          setPixel(tile, x, y, clampByte(118 + shade), clampByte(118 + shade), clampByte(122 + shade));
        }
      }
    }
  },
  [TextureId.Glass]: (tile, random) => {
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const edge = x === 0 || y === 0 || x === TILE_SIZE - 1 || y === TILE_SIZE - 1;
        const tint = (random() - 0.5) * 8;
        setPixel(
          tile,
          x,
          y,
          clampByte(198 + tint),
          clampByte(224 + tint),
          clampByte(236 + tint),
          edge ? 210 : 46,
        );
      }
    }
  },
  [TextureId.Bedrock]: (tile, random) => {
    noisyFill(tile, random, 62, 62, 66, 22);
    scatterSpecks(tile, random, 46, 30, 30, 34);
  },
  [TextureId.Snow]: (tile, random) => {
    noisyFill(tile, random, 240, 244, 250, 8);
    scatterSpecks(tile, random, 14, 218, 226, 238);
  },
  [TextureId.Brick]: (tile, random) => {
    noisyFill(tile, random, 150, 78, 62, 12);
    for (let y = 0; y < TILE_SIZE; y++) {
      const isMortarRow = y % 4 === 0;
      for (let x = 0; x < TILE_SIZE; x++) {
        const stagger = Math.floor(y / 4) % 2 === 0 ? 0 : 4;
        const isMortarColumn = (x + stagger) % 8 === 0;
        if (isMortarRow || isMortarColumn) {
          const shade = (random() - 0.5) * 10;
          setPixel(tile, x, y, clampByte(196 + shade), clampByte(190 + shade), clampByte(182 + shade));
        }
      }
    }
  },
};

function scatterSpecks(
  tile: Uint8Array,
  random: () => number,
  count: number,
  r: number,
  g: number,
  b: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(random() * TILE_SIZE);
    const y = Math.floor(random() * TILE_SIZE);
    setPixel(tile, x, y, r, g, b);
  }
}

/**
 * Builds the block texture array procedurally.
 *
 * Generating textures in code keeps the build free of binary assets: nothing
 * to load over the network, nothing to 404, no decode step before the first
 * frame, and the atlas can never drift out of sync with the block registry.
 *
 * A `DataArrayTexture` rather than a packed atlas means each block texture is
 * its own layer, so filtering can never bleed one block's pixels into another
 * along a shared edge — the classic voxel atlas seam.
 */
export function createBlockTextureArray(seed = 0x5eed): THREE.DataArrayTexture {
  const data = new Uint8Array(TILE_BYTES * TEXTURE_COUNT);

  for (let layer = 0; layer < TEXTURE_COUNT; layer++) {
    const tile = new Uint8Array(TILE_BYTES);
    tile.fill(255);

    const painter = painters[layer];
    if (painter !== undefined) {
      // A per-layer seed keeps every texture stable across reloads.
      painter(tile, createRandom(seed + layer * 7919));
    }

    data.set(tile, layer * TILE_BYTES);
  }

  const texture = new THREE.DataArrayTexture(data, TILE_SIZE, TILE_SIZE, TEXTURE_COUNT);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  // Nearest magnification preserves the crisp block look when close up.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return texture;
}
