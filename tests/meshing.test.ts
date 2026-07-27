import { describe, expect, it } from 'vitest';
import { buildChunkMesh } from '@infrastructure/meshing/ChunkMeshBuilder';
import {
  PADDED_SIZE,
  PADDED_VOLUME,
  paddedIndex,
} from '@application/ports/ChunkMesher';
import type { MeshGeometry } from '@application/ports/ChunkMesher';
import { BlockId } from '@domain/world/BlockType';
import { CHUNK_HEIGHT, CHUNK_SIZE } from '@domain/world/WorldConstants';

function emptyVolume(): Uint8Array {
  return new Uint8Array(PADDED_VOLUME);
}

/** Writes a block in chunk-local coordinates (padding applied automatically). */
function put(volume: Uint8Array, x: number, y: number, z: number, block: number): void {
  volume[paddedIndex(x + 1, y, z + 1)] = block;
}

const quadCount = (geometry: MeshGeometry | null): number =>
  geometry === null ? 0 : geometry.indices.length / 6;

/** Vertex positions of a geometry, as [x, y, z] triples. */
function vertices(geometry: MeshGeometry): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < geometry.positions.length; i += 3) {
    out.push([geometry.positions[i], geometry.positions[i + 1], geometry.positions[i + 2]]);
  }
  return out;
}

describe('buildChunkMesh', () => {
  it('produces nothing for an empty chunk', () => {
    const result = buildChunkMesh(emptyVolume());
    expect(result.opaque).toBeNull();
    expect(result.transparent).toBeNull();
  });

  it('emits exactly six faces for an isolated block', () => {
    const volume = emptyVolume();
    put(volume, 8, 20, 8, BlockId.Stone);

    const result = buildChunkMesh(volume);
    expect(quadCount(result.opaque)).toBe(6);
    expect(result.transparent).toBeNull();
    expect(result.opaque!.positions.length).toBe(6 * 4 * 3);
    expect(result.opaque!.uvs.length).toBe(6 * 4 * 2);
    expect(result.opaque!.layers.length).toBe(6 * 4);
    expect(result.opaque!.lights.length).toBe(6 * 4);
  });

  it('culls the shared face between two adjacent blocks', () => {
    const volume = emptyVolume();
    put(volume, 8, 20, 8, BlockId.Stone);
    put(volume, 9, 20, 8, BlockId.Stone);

    expect(quadCount(buildChunkMesh(volume).opaque)).toBe(10);
  });

  it('culls faces against blocks in the neighbour skirt', () => {
    const volume = emptyVolume();
    // Block on the chunk's -X edge, with a neighbour block in the padding.
    put(volume, 0, 20, 8, BlockId.Stone);
    volume[paddedIndex(0, 20, 9)] = BlockId.Stone;

    // The -X face is hidden by the neighbouring chunk, so five faces remain.
    expect(quadCount(buildChunkMesh(volume).opaque)).toBe(5);
  });

  it('separates translucent geometry from opaque geometry', () => {
    const volume = emptyVolume();
    put(volume, 4, 10, 4, BlockId.Stone);
    put(volume, 6, 10, 4, BlockId.Water);

    const result = buildChunkMesh(volume);
    expect(quadCount(result.opaque)).toBe(6);
    expect(quadCount(result.transparent)).toBe(6);
  });

  it('hides interior faces within a body of the same translucent block', () => {
    const volume = emptyVolume();
    put(volume, 4, 10, 4, BlockId.Water);
    put(volume, 5, 10, 4, BlockId.Water);

    // A water volume is a shell, not a stack of overlapping surfaces.
    expect(quadCount(buildChunkMesh(volume).transparent)).toBe(10);
  });

  it('draws translucent faces against a different translucent block', () => {
    const volume = emptyVolume();
    put(volume, 4, 10, 4, BlockId.Water);
    put(volume, 5, 10, 4, BlockId.Glass);

    expect(quadCount(buildChunkMesh(volume).transparent)).toBe(12);
  });

  it('does not draw faces of a block enclosed by opaque neighbours', () => {
    const volume = emptyVolume();
    put(volume, 8, 20, 8, BlockId.Stone);
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      put(volume, 8 + dx, 20 + dy, 8 + dz, BlockId.Stone);
    }

    // Only the outer shell of the plus shape is visible; the centre contributes
    // nothing, which is what keeps buried terrain free.
    const result = buildChunkMesh(volume);
    expect(quadCount(result.opaque)).toBe(30);
  });

  it('keeps every vertex inside the chunk bounds', () => {
    const volume = emptyVolume();
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        put(volume, x, 0, z, BlockId.Stone);
        put(volume, x, 1, z, BlockId.Grass);
      }
    }

    const geometry = buildChunkMesh(volume).opaque!;
    for (const [x, y, z] of vertices(geometry)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(CHUNK_SIZE);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(CHUNK_SIZE);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(CHUNK_HEIGHT);
    }
  });

  it('indexes only vertices that exist', () => {
    const volume = emptyVolume();
    for (let i = 0; i < 40; i++) {
      put(volume, i % CHUNK_SIZE, 30 + (i % 7), (i * 5) % CHUNK_SIZE, BlockId.Cobblestone);
    }

    const geometry = buildChunkMesh(volume).opaque!;
    const vertexCount = geometry.positions.length / 3;
    for (const index of geometry.indices) {
      expect(index).toBeLessThan(vertexCount);
    }
    expect(geometry.indices.length % 3).toBe(0);
  });

  it('darkens vertices that sit in a corner', () => {
    const volume = emptyVolume();
    // A floor with a wall along +X, so the floor's top face is occluded on
    // one side and open on the other.
    for (let x = 0; x < 4; x++) {
      for (let z = 0; z < 4; z++) put(volume, x, 10, z, BlockId.Stone);
    }
    for (let z = 0; z < 4; z++) put(volume, 4, 11, z, BlockId.Stone);

    const geometry = buildChunkMesh(volume).opaque!;
    const lights = Array.from(geometry.lights);
    const brightest = Math.max(...lights);
    const darkest = Math.min(...lights);

    // Ambient occlusion must actually vary, otherwise the shading is flat.
    expect(darkest).toBeLessThan(brightest);
    expect(darkest).toBeGreaterThan(0);
    expect(brightest).toBeLessThanOrEqual(1);
  });

  it('assigns face-appropriate texture layers to a grass block', () => {
    const volume = emptyVolume();
    put(volume, 8, 20, 8, BlockId.Grass);

    const geometry = buildChunkMesh(volume).opaque!;
    const layers = new Set(geometry.layers);
    // Grass uses three distinct textures: top, side and bottom.
    expect(layers.size).toBe(3);
  });

  it('chooses an index type that can address every vertex', () => {
    const volume = emptyVolume();
    // A checkerboard maximises exposed surface area and vertex count.
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          if ((x + y + z) % 2 === 0) put(volume, x, y, z, BlockId.Stone);
        }
      }
    }

    const geometry = buildChunkMesh(volume).opaque!;
    const vertexCount = geometry.positions.length / 3;
    if (vertexCount > 65535) {
      expect(geometry.indices).toBeInstanceOf(Uint32Array);
    } else {
      expect(geometry.indices).toBeInstanceOf(Uint16Array);
    }
    for (const index of geometry.indices) expect(index).toBeLessThan(vertexCount);
  });

  it('tolerates unknown block ids without crashing', () => {
    const volume = emptyVolume();
    put(volume, 5, 5, 5, 250);
    expect(() => buildChunkMesh(volume)).not.toThrow();
  });

  it('reads the whole padded volume without going out of bounds', () => {
    const volume = new Uint8Array(PADDED_VOLUME).fill(BlockId.Stone);
    expect(volume.length).toBe(PADDED_SIZE * CHUNK_HEIGHT * PADDED_SIZE);

    // The skirt hides every side face, leaving only the world's floor and
    // ceiling — the volume is otherwise solid.
    const result = buildChunkMesh(volume);
    expect(quadCount(result.opaque)).toBe(CHUNK_SIZE * CHUNK_SIZE * 2);
  });
});

describe('sub-unit block height', () => {
  it('flattens a rail into its cell instead of filling it', () => {
    const volume = emptyVolume();
    put(volume, 4, 8, 4, BlockId.Stone);
    put(volume, 4, 9, 4, BlockId.Rail);

    const geometry = buildChunkMesh(volume).opaque as MeshGeometry;
    const railTop = vertices(geometry)
      .filter(([x, , z]) => x >= 4 && x <= 5 && z >= 4 && z <= 5)
      .map(([, y]) => y)
      .filter((y) => y > 9);

    expect(railTop.length).toBeGreaterThan(0);
    // The rail's own top sits a fraction above its floor, not a whole block.
    for (const y of railTop) {
      expect(y).toBeGreaterThan(9);
      expect(y).toBeLessThan(9.2);
    }
  });

  it('still builds full-height cubes for ordinary blocks', () => {
    const volume = emptyVolume();
    put(volume, 4, 8, 4, BlockId.Stone);

    const geometry = buildChunkMesh(volume).opaque as MeshGeometry;
    const ys = new Set(vertices(geometry).map(([, y]) => y));
    expect(ys).toEqual(new Set([8, 9]));
  });

  it('joins adjacent rails without drawing a wall between them', () => {
    const volume = emptyVolume();
    for (const x of [4, 5]) {
      put(volume, x, 8, 4, BlockId.Stone);
      put(volume, x, 9, 4, BlockId.Rail);
    }

    const single = emptyVolume();
    put(single, 4, 8, 4, BlockId.Stone);
    put(single, 4, 9, 4, BlockId.Rail);

    // Two joined rails cost fewer than twice one rail: the shared faces are
    // culled, which is what makes a long line cheap to draw.
    const pair = quadCount(buildChunkMesh(volume).opaque);
    const lone = quadCount(buildChunkMesh(single).opaque);
    expect(pair).toBeLessThan(lone * 2);
  });

  it('emits every ore block as solid geometry', () => {
    for (const ore of [BlockId.CoalOre, BlockId.IronOre, BlockId.GoldOre, BlockId.DiamondOre]) {
      const volume = emptyVolume();
      put(volume, 4, 8, 4, ore);
      expect(quadCount(buildChunkMesh(volume).opaque), `ore ${ore}`).toBe(6);
    }
  });
});
