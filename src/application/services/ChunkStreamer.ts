import type { ChunkGenerator } from '@domain/generation/ChunkGenerator';
import type { Chunk, ChunkEdits } from '@domain/world/Chunk';
import { ChunkCoord, type ChunkKey } from '@domain/world/ChunkCoord';
import type { World } from '@domain/world/World';
import { CHUNK_HEIGHT, CHUNK_SIZE, voxelIndex } from '@domain/world/WorldConstants';
import {
  PADDED_SIZE,
  PADDED_VOLUME,
  paddedIndex,
  type ChunkMesher,
  type MeshResponse,
} from '../ports/ChunkMesher';
import type { GameRenderer } from '../ports/GameRenderer';
import type { WorldRepository } from '../ports/WorldRepository';

export interface StreamingSettings {
  /** Chunks rendered around the player. */
  readonly renderDistance: number;
  /**
   * Extra ring loaded but not rendered. Must be at least 1 so every visible
   * chunk has the neighbours it needs for correct face culling and AO.
   */
  readonly loadMargin: number;
  /** Extra ring kept resident before unloading, to damp hysteresis. */
  readonly unloadMargin: number;
  /** Repository reads allowed in flight at once. */
  readonly maxConcurrentFetches: number;
  /** Milliseconds per frame spent generating terrain. */
  readonly generationBudgetMs: number;
  /** Chunk meshes uploaded to the GPU per frame. */
  readonly maxUploadsPerFrame: number;
}

export const DEFAULT_STREAMING: StreamingSettings = Object.freeze({
  renderDistance: 8,
  loadMargin: 1,
  unloadMargin: 2,
  maxConcurrentFetches: 6,
  generationBudgetMs: 4,
  maxUploadsPerFrame: 2,
});

export interface StreamingStats {
  readonly loaded: number;
  readonly pendingGeneration: number;
  readonly meshesInFlight: number;
  readonly meshesQueued: number;
}

interface Dependencies {
  readonly world: World;
  readonly generator: ChunkGenerator;
  readonly mesher: ChunkMesher;
  readonly renderer: GameRenderer;
  readonly repository: WorldRepository;
  readonly settings?: Partial<StreamingSettings>;
  readonly onError?: (error: unknown, context: string) => void;
}

/**
 * Keeps the region around the player loaded, meshed and drawn.
 *
 * All work is bounded per frame — terrain generation by a time budget, mesh
 * jobs by the mesher's capacity, GPU uploads by a fixed count. That is what
 * keeps frame time flat while the player moves, instead of stuttering each
 * time a chunk boundary is crossed.
 */
export class ChunkStreamer {
  private readonly world: World;
  private readonly generator: ChunkGenerator;
  private readonly mesher: ChunkMesher;
  private readonly renderer: GameRenderer;
  private readonly repository: WorldRepository;
  private settings: StreamingSettings;
  private readonly onError: (error: unknown, context: string) => void;

  /** Chunk coords in load order (nearest first), rebuilt when the centre moves. */
  private desired: ChunkCoord[] = [];
  private centre: ChunkCoord | null = null;

  private readonly fetching = new Set<ChunkKey>();
  /**
   * Chunks whose persisted edits have arrived and now await generation.
   * Generation is deliberately deferred out of the promise callback so it can
   * be spread across frames under a time budget instead of landing all at once.
   */
  private readonly generationQueue: { coord: ChunkCoord; edits: ChunkEdits | null }[] = [];
  private readonly queuedForGeneration = new Set<ChunkKey>();

  private readonly meshInFlight = new Map<ChunkKey, number>();
  private readonly meshedRevision = new Map<ChunkKey, number>();
  private readonly meshDirty = new Set<ChunkKey>();
  private readonly readyMeshes: MeshResponse[] = [];

  private disposed = false;

  constructor(dependencies: Dependencies) {
    this.world = dependencies.world;
    this.generator = dependencies.generator;
    this.mesher = dependencies.mesher;
    this.renderer = dependencies.renderer;
    this.repository = dependencies.repository;
    this.settings = { ...DEFAULT_STREAMING, ...dependencies.settings };
    this.onError = dependencies.onError ?? (() => {});
  }

  get renderDistance(): number {
    return this.settings.renderDistance;
  }

  /**
   * Changes how far the world is drawn.
   *
   * Forces a replan so the new radius takes effect immediately: shrinking must
   * release memory now rather than waiting for the player to cross a chunk
   * boundary, which is exactly when a struggling machine can least afford it.
   */
  setRenderDistance(chunks: number): void {
    const next = Math.max(2, Math.round(chunks));
    if (next === this.settings.renderDistance) return;
    this.settings = { ...this.settings, renderDistance: next };

    const centre = this.centre;
    if (centre === null) return;
    this.rebuildDesired(centre);
    this.unloadDistant(centre);
  }

  private get loadRadius(): number {
    return this.settings.renderDistance + this.settings.loadMargin;
  }

  private get unloadRadius(): number {
    return this.loadRadius + this.settings.unloadMargin;
  }

  /** Forces a chunk's mesh to be rebuilt even if its revision is unchanged. */
  invalidateMesh(coord: ChunkCoord): void {
    this.meshDirty.add(coord.key);
  }

  /**
   * Loads the chunks around a point and blocks until they are ready.
   * Used once at start-up so the player never spawns inside unloaded space.
   */
  async preload(centre: ChunkCoord, radius: number): Promise<void> {
    const coords: ChunkCoord[] = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        coords.push(centre.offset(dx, dz));
      }
    }
    coords.sort(
      (a, b) => centre.chebyshevDistanceTo(a) - centre.chebyshevDistanceTo(b),
    );

    for (const coord of coords) {
      if (this.disposed) return;
      if (this.world.hasChunk(coord)) continue;
      const edits = await this.fetchEdits(coord);
      if (this.disposed) return;
      this.materialise(coord, edits);
    }
  }

  /** Advances streaming by one frame. */
  update(playerX: number, playerZ: number): void {
    if (this.disposed) return;

    const centre = ChunkCoord.fromWorld(Math.floor(playerX), Math.floor(playerZ));
    if (centre.key !== this.centre?.key) {
      this.centre = centre;
      this.rebuildDesired(centre);
      this.unloadDistant(centre);
    }

    this.pumpFetches();
    this.pumpGeneration();
    // Uploads run before dispatch so meshes that finished since the last frame
    // free their slot immediately; the other order idles the mesher for a
    // frame after every batch, halving effective throughput.
    this.pumpUploads();
    this.pumpMeshing();
  }

  stats(): StreamingStats {
    return {
      loaded: this.world.loadedChunkCount,
      pendingGeneration: this.generationQueue.length,
      meshesInFlight: this.meshInFlight.size,
      meshesQueued: this.readyMeshes.length,
    };
  }

  /** Persists every chunk holding unsaved edits. */
  async flush(): Promise<void> {
    const writes: Promise<void>[] = [];
    for (const chunk of this.world.loadedChunks()) {
      if (!chunk.hasUnsavedEdits) continue;
      writes.push(this.persist(chunk));
    }
    await Promise.allSettled(writes);
  }

  async dispose(flush = true): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (flush) await this.flush();
    this.generationQueue.length = 0;
    this.readyMeshes.length = 0;
    this.fetching.clear();
    this.queuedForGeneration.clear();
    this.meshInFlight.clear();
    this.meshedRevision.clear();
    this.meshDirty.clear();
  }

  // ---------------------------------------------------------------- planning

  private rebuildDesired(centre: ChunkCoord): void {
    const radius = this.loadRadius;
    const coords: ChunkCoord[] = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        coords.push(centre.offset(dx, dz));
      }
    }
    // Nearest-first so the player always sees the closest terrain appear first.
    coords.sort(
      (a, b) => centre.chebyshevDistanceTo(a) - centre.chebyshevDistanceTo(b),
    );
    this.desired = coords;
  }

  private unloadDistant(centre: ChunkCoord): void {
    const limit = this.unloadRadius;
    const doomed: ChunkCoord[] = [];

    // Collected first: removing while iterating the world's map is unsafe.
    for (const chunk of this.world.loadedChunks()) {
      if (centre.chebyshevDistanceTo(chunk.coord) > limit) doomed.push(chunk.coord);
    }

    for (const coord of doomed) {
      const chunk = this.world.removeChunk(coord);
      this.renderer.removeChunk(coord);
      this.meshedRevision.delete(coord.key);
      this.meshInFlight.delete(coord.key);
      this.meshDirty.delete(coord.key);
      if (chunk !== null && chunk.hasUnsavedEdits) {
        void this.persist(chunk);
      }
    }

    // Drop queued work that is no longer wanted.
    for (let i = this.generationQueue.length - 1; i >= 0; i--) {
      if (centre.chebyshevDistanceTo(this.generationQueue[i].coord) > limit) {
        this.queuedForGeneration.delete(this.generationQueue[i].coord.key);
        this.generationQueue.splice(i, 1);
      }
    }

    // Any mesh still waiting for a chunk that is gone is now meaningless.
    for (let i = this.readyMeshes.length - 1; i >= 0; i--) {
      if (!this.world.hasChunk(this.readyMeshes[i].coord)) this.readyMeshes.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ phases

  /** Starts repository reads for the nearest chunks that are still missing. */
  private pumpFetches(): void {
    let available = this.settings.maxConcurrentFetches - this.fetching.size;
    if (available <= 0) return;

    for (const coord of this.desired) {
      if (available <= 0) break;
      const key = coord.key;
      if (this.world.hasChunk(coord)) continue;
      if (this.fetching.has(key) || this.queuedForGeneration.has(key)) continue;

      this.fetching.add(key);
      available--;

      void this.fetchEdits(coord).then((edits) => {
        this.fetching.delete(key);
        if (this.disposed || this.world.hasChunk(coord)) return;
        if (this.queuedForGeneration.has(key)) return;
        this.queuedForGeneration.add(key);
        this.generationQueue.push({ coord, edits });
      });
    }
  }

  /** Generates queued chunks until the frame budget is spent. */
  private pumpGeneration(): void {
    if (this.generationQueue.length === 0) return;
    const deadline = now() + this.settings.generationBudgetMs;

    do {
      const next = this.generationQueue.shift();
      if (next === undefined) return;
      this.queuedForGeneration.delete(next.coord.key);
      if (this.world.hasChunk(next.coord)) continue;
      this.materialise(next.coord, next.edits);
    } while (this.generationQueue.length > 0 && now() < deadline);
  }

  /** Dispatches mesh jobs for visible chunks whose geometry is stale. */
  private pumpMeshing(): void {
    let available = this.mesher.capacity - this.meshInFlight.size;
    if (available <= 0) return;

    const renderLimit = this.settings.renderDistance;
    const centre = this.centre;
    if (centre === null) return;

    for (const coord of this.desired) {
      if (available <= 0) break;
      if (centre.chebyshevDistanceTo(coord) > renderLimit) continue;

      const key = coord.key;
      if (this.meshInFlight.has(key)) continue;

      const chunk = this.world.getChunk(coord);
      if (chunk === null) continue;

      const stale = this.meshDirty.has(key) || this.meshedRevision.get(key) !== chunk.revision;
      if (!stale) continue;

      // Border culling and ambient occlusion both read the surrounding
      // chunks; meshing early would bake in seams that never get cleaned up.
      if (!this.world.hasAllNeighbours(coord)) continue;

      const revision = chunk.revision;
      this.meshDirty.delete(key);
      this.meshInFlight.set(key, revision);
      available--;

      void this.mesher
        .submit({ coord, revision, paddedVolume: this.buildPaddedVolume(coord) })
        .then((response) => {
          if (this.disposed) return;
          if (this.meshInFlight.get(key) !== response.revision) return;
          this.readyMeshes.push(response);
        })
        .catch((error: unknown) => {
          this.meshInFlight.delete(key);
          this.meshDirty.add(key);
          this.onError(error, `mesh chunk ${key}`);
        });
    }
  }

  /** Uploads a bounded number of finished meshes to the GPU. */
  private pumpUploads(): void {
    let budget = this.settings.maxUploadsPerFrame;
    while (budget > 0 && this.readyMeshes.length > 0) {
      const response = this.readyMeshes.shift();
      if (response === undefined) break;
      const key = response.coord.key;

      this.meshInFlight.delete(key);

      // The chunk may have been unloaded while the job was in flight.
      if (!this.world.hasChunk(response.coord)) continue;

      this.renderer.updateChunk(response.coord, response.data);
      this.meshedRevision.set(key, response.revision);
      budget--;
    }
  }

  // ------------------------------------------------------------------ helpers

  /** Repository failures degrade to "no edits" rather than blocking the world. */
  private async fetchEdits(coord: ChunkCoord): Promise<ChunkEdits | null> {
    try {
      return await this.repository.loadChunkEdits(coord);
    } catch (error) {
      this.onError(error, `load edits ${coord.key}`);
      return null;
    }
  }

  private materialise(coord: ChunkCoord, edits: ChunkEdits | null): void {
    try {
      const chunk = this.generator.generate(coord);
      if (edits !== null) {
        chunk.applyEdits(edits);
        chunk.markSaved();
      }
      this.world.addChunk(chunk);
    } catch (error) {
      this.onError(error, `generate chunk ${coord.key}`);
    }
  }

  private async persist(chunk: Chunk): Promise<void> {
    const snapshot = chunk.snapshotEdits();
    if (snapshot === null) {
      chunk.markSaved();
      return;
    }
    try {
      await this.repository.saveChunkEdits(chunk.coord, snapshot);
      chunk.markSaved();
    } catch (error) {
      this.onError(error, `save chunk ${chunk.coord.key}`);
    }
  }

  /**
   * Copies a chunk and a one-block skirt of its neighbours into a flat array.
   *
   * Handing the mesher a self-contained volume means it needs no access to the
   * world, so it can run in a worker and the buffer can be transferred rather
   * than copied.
   */
  private buildPaddedVolume(coord: ChunkCoord): Uint8Array {
    const volume = new Uint8Array(PADDED_VOLUME);

    // Resolve the 3x3 neighbourhood once instead of per column.
    const neighbourhood: (Chunk | null)[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        neighbourhood.push(this.world.getChunk(coord.offset(dx, dz)));
      }
    }

    for (let pz = 0; pz < PADDED_SIZE; pz++) {
      const worldLocalZ = pz - 1;
      const cellZ = worldLocalZ < 0 ? 0 : worldLocalZ >= CHUNK_SIZE ? 2 : 1;
      const localZ = ((worldLocalZ % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

      for (let px = 0; px < PADDED_SIZE; px++) {
        const worldLocalX = px - 1;
        const cellX = worldLocalX < 0 ? 0 : worldLocalX >= CHUNK_SIZE ? 2 : 1;
        const localX = ((worldLocalX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

        const source = neighbourhood[cellZ * 3 + cellX];
        if (source === null) continue;

        const data = source.data;
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          volume[paddedIndex(px, y, pz)] = data[voxelIndex(localX, y, localZ)];
        }
      }
    }

    return volume;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
