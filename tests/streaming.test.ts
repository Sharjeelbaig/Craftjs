import { describe, expect, it } from 'vitest';
import { ChunkStreamer } from '@application/services/ChunkStreamer';
import { WorldEditor } from '@application/services/WorldEditor';
import { buildChunkMesh } from '@infrastructure/meshing/ChunkMeshBuilder';
import { InMemoryWorldRepository } from '@infrastructure/persistence/InMemoryWorldRepository';
import type {
  ChunkMesher,
  ChunkMeshData,
  MeshRequest,
  MeshResponse,
} from '@application/ports/ChunkMesher';
import type { CameraPose, GameRenderer, RenderStats } from '@application/ports/GameRenderer';
import { TerrainGenerator } from '@domain/generation/TerrainGenerator';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { World } from '@domain/world/World';
import { BlockId } from '@domain/world/BlockType';
import { CHUNK_SIZE } from '@domain/world/WorldConstants';
import { Player } from '@domain/player/Player';

/** Meshes on the spot, but still through the async port contract. */
class ImmediateMesher implements ChunkMesher {
  readonly capacity = 4;
  submissions = 0;
  readonly meshedKeys: string[] = [];

  submit(request: MeshRequest): Promise<MeshResponse> {
    this.submissions++;
    this.meshedKeys.push(request.coord.key);
    return Promise.resolve({
      coord: request.coord,
      revision: request.revision,
      data: buildChunkMesh(request.paddedVolume),
    });
  }

  dispose(): void {}
}

class RecordingRenderer implements GameRenderer {
  readonly uploads = new Map<string, number>();
  readonly removals: string[] = [];

  updateChunk(coord: ChunkCoord, _data: ChunkMeshData): void {
    this.uploads.set(coord.key, (this.uploads.get(coord.key) ?? 0) + 1);
  }

  removeChunk(coord: ChunkCoord): void {
    this.removals.push(coord.key);
    this.uploads.delete(coord.key);
  }

  syncEntities(): void {}
  setBlockHighlight(): void {}
  setBreakProgress(): void {}
  setSubmerged(): void {}
  setSky(): void {}
  setRenderDistance(): void {}
  render(_camera: CameraPose): void {}
  getStats(): RenderStats {
    return { drawCalls: 0, triangles: 0, chunkMeshes: this.uploads.size, entities: 0 };
  }
  dispose(): void {}
}

interface Harness {
  world: World;
  streamer: ChunkStreamer;
  renderer: RecordingRenderer;
  mesher: ImmediateMesher;
  repository: InMemoryWorldRepository;
  generator: TerrainGenerator;
  errors: string[];
}

function harness(renderDistance = 2, repository = new InMemoryWorldRepository()): Harness {
  const world = new World();
  const generator = new TerrainGenerator(4242);
  const mesher = new ImmediateMesher();
  const renderer = new RecordingRenderer();
  const errors: string[] = [];

  const streamer = new ChunkStreamer({
    world,
    generator,
    mesher,
    renderer,
    repository,
    settings: {
      renderDistance,
      loadMargin: 1,
      unloadMargin: 1,
      maxConcurrentFetches: 64,
      // Tests are not frame-bound; let each pass do as much as it can.
      generationBudgetMs: 1000,
      maxUploadsPerFrame: 64,
    },
    onError: (error, context) => errors.push(`${context}: ${String(error)}`),
  });

  return { world, streamer, renderer, mesher, repository, generator, errors };
}

/** Runs streaming passes until it settles, draining pending promises between. */
async function settle(streamer: ChunkStreamer, x: number, z: number, passes = 40): Promise<void> {
  for (let i = 0; i < passes; i++) {
    streamer.update(x, z);
    // Two turns of the microtask queue: one for the repository read, one for
    // the mesh result.
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe('ChunkStreamer', () => {
  it('loads the full load radius and renders the render radius', async () => {
    const { streamer, world, renderer, errors } = harness(2);
    await settle(streamer, 8, 8);

    // Load radius is renderDistance + loadMargin = 3 -> 7x7 chunks.
    expect(world.loadedChunkCount).toBe(7 * 7);
    // Render radius 2 -> 5x5 chunks meshed.
    expect(renderer.uploads.size).toBe(5 * 5);
    expect(errors).toEqual([]);
  });

  it('never meshes a chunk before all eight neighbours are resident', async () => {
    const { streamer, world, mesher } = harness(2);
    await settle(streamer, 8, 8);

    for (const key of mesher.meshedKeys) {
      const coord = ChunkCoord.parse(key)!;
      expect(world.hasAllNeighbours(coord)).toBe(true);
    }
  });

  it('meshes each chunk exactly once when nothing changes', async () => {
    const { streamer, renderer } = harness(2);
    await settle(streamer, 8, 8);
    const uploadsAfterLoad = new Map(renderer.uploads);

    // Extra idle passes must not schedule redundant work.
    await settle(streamer, 8, 8, 6);
    expect(renderer.uploads).toEqual(uploadsAfterLoad);
    for (const count of renderer.uploads.values()) expect(count).toBe(1);
  });

  it('unloads chunks left behind and releases their meshes', async () => {
    const { streamer, world, renderer } = harness(2);
    await settle(streamer, 8, 8);
    const initial = world.loadedChunkCount;

    // Walk far enough that none of the original chunks stay resident.
    await settle(streamer, 8 + CHUNK_SIZE * 20, 8);

    expect(world.loadedChunkCount).toBe(initial);
    expect(renderer.removals.length).toBeGreaterThan(0);
    expect(renderer.uploads.size).toBe(5 * 5);
    // Nothing that was unloaded may still be considered uploaded.
    for (const key of renderer.uploads.keys()) {
      const coord = ChunkCoord.parse(key)!;
      expect(world.hasChunk(coord)).toBe(true);
    }
  });

  it('does not grow unbounded while the player walks a long distance', async () => {
    const { streamer, world } = harness(2);
    for (let step = 0; step < 24; step++) {
      await settle(streamer, step * CHUNK_SIZE, 0, 4);
    }
    // Load radius 3 plus unload margin 1 bounds residency at a 9x9 window.
    expect(world.loadedChunkCount).toBeLessThanOrEqual(9 * 9);
  });

  it('rebuilds the neighbouring mesh when a block on a border changes', async () => {
    const { streamer, world, renderer } = harness(2);
    await settle(streamer, 8, 8);

    // Edit the first column of chunk (0,0): chunk (-1,0) sees it too.
    const change = world.setBlock(0, 40, 8, BlockId.Brick);
    expect(change).not.toBeNull();
    expect(change!.affectedChunks.map((c) => c.key).sort()).toEqual(['-1,0', '0,0']);
    for (const coord of change!.affectedChunks) streamer.invalidateMesh(coord);

    const before = new Map(renderer.uploads);
    await settle(streamer, 8, 8, 8);

    expect(renderer.uploads.get('0,0')).toBe((before.get('0,0') ?? 0) + 1);
    expect(renderer.uploads.get('-1,0')).toBe((before.get('-1,0') ?? 0) + 1);
    // An unrelated chunk must not be rebuilt.
    expect(renderer.uploads.get('1,1')).toBe(before.get('1,1'));
  });

  it('applies a player edit through the editor and schedules the rebuild', async () => {
    const { streamer, world, renderer } = harness(2);
    await settle(streamer, 8, 8);

    const editor = new WorldEditor(world, streamer);
    const player = new Player(8.5, world.surfaceHeightAt(8, 8) ?? 60, 8.5);
    // Look straight down at the block underfoot.
    player.pitch = -Math.PI / 2 + 0.01;

    const before = new Map(renderer.uploads);
    const result = editor.breakBlock(player);
    expect(result.ok).toBe(true);

    await settle(streamer, 8, 8, 8);
    expect(renderer.uploads.get('0,0')).toBe((before.get('0,0') ?? 0) + 1);
  });

  it('persists edits and restores them after an unload/reload cycle', async () => {
    const repository = new InMemoryWorldRepository();
    const first = harness(2, repository);
    await settle(first.streamer, 8, 8);

    first.world.setBlock(8, 70, 8, BlockId.Brick);
    await first.streamer.flush();

    const second = harness(2, repository);
    await settle(second.streamer, 8, 8);
    expect(second.world.getBlock(8, 70, 8)).toBe(BlockId.Brick);

    // A cell that was never edited must come back from the generator, not the
    // save file.
    expect(second.world.getBlock(9, 70, 8)).toBe(first.world.getBlock(9, 70, 8));
  });

  it('saves pending edits when a chunk is unloaded', async () => {
    const repository = new InMemoryWorldRepository();
    const { streamer, world } = harness(2, repository);
    await settle(streamer, 8, 8);

    world.setBlock(8, 70, 8, BlockId.Glass);
    // Walk away so chunk (0,0) is evicted.
    await settle(streamer, 8 + CHUNK_SIZE * 20, 8);

    const stored = await repository.loadChunkEdits(ChunkCoord.of(0, 0));
    expect(stored).not.toBeNull();
    expect(Array.from(stored!.blocks)).toContain(BlockId.Glass);
  });

  it('keeps working when the repository fails', async () => {
    const failing = new InMemoryWorldRepository();
    failing.loadChunkEdits = () => Promise.reject(new Error('disk on fire'));

    const world = new World();
    const errors: string[] = [];
    const renderer = new RecordingRenderer();
    const streamer = new ChunkStreamer({
      world,
      generator: new TerrainGenerator(1),
      mesher: new ImmediateMesher(),
      renderer,
      repository: failing,
      settings: { renderDistance: 1, generationBudgetMs: 1000, maxUploadsPerFrame: 64 },
      onError: (_error, context) => errors.push(context),
    });

    await settle(streamer, 0, 0);

    // Terrain still streams; only the saved delta is lost.
    expect(world.loadedChunkCount).toBeGreaterThan(0);
    expect(renderer.uploads.size).toBeGreaterThan(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('resubmits a mesh when the mesher rejects', async () => {
    const world = new World();
    const renderer = new RecordingRenderer();
    let failuresLeft = 3;

    const flaky: ChunkMesher = {
      capacity: 2,
      submit(request) {
        if (failuresLeft > 0) {
          failuresLeft--;
          return Promise.reject(new Error('worker died'));
        }
        return Promise.resolve({
          coord: request.coord,
          revision: request.revision,
          data: buildChunkMesh(request.paddedVolume),
        });
      },
      dispose() {},
    };

    const streamer = new ChunkStreamer({
      world,
      generator: new TerrainGenerator(5),
      mesher: flaky,
      renderer,
      repository: new InMemoryWorldRepository(),
      settings: { renderDistance: 1, generationBudgetMs: 1000, maxUploadsPerFrame: 64 },
      onError: () => {},
    });

    await settle(streamer, 0, 0, 20);
    // Every visible chunk recovers despite the early failures.
    expect(renderer.uploads.size).toBe(3 * 3);
  });
});

describe('terrain continuity across chunks', () => {
  it('assembles complete trees from independently generated chunks', () => {
    const generator = new TerrainGenerator(20260726);

    // Generate a 3x3 block of chunks and treat the union as one volume.
    const world = new World();
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        world.addChunk(generator.generate(ChunkCoord.of(cx, cz)));
      }
    }

    // Inside the interior chunk — far enough from the union's own edge that a
    // full tree must be present — every leaf needs a trunk nearby.
    let leaves = 0;
    let orphans = 0;
    for (let y = 1; y < 120; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          if (world.getBlock(x, y, z) !== BlockId.Leaves) continue;
          leaves++;
          if (!hasLogNear(world, x, y, z)) orphans++;
        }
      }
    }

    expect(orphans).toBe(0);
    // Guard against the assertion silently passing on a treeless seed.
    expect(leaves).toBeGreaterThan(0);
  });
});

function hasLogNear(world: World, x: number, y: number, z: number): boolean {
  for (let dy = -4; dy <= 2; dy++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (world.getBlock(x + dx, y + dy, z + dz) === BlockId.Log) return true;
      }
    }
  }
  return false;
}
