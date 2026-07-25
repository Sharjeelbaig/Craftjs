import type { ChunkCoord } from '@domain/world/ChunkCoord';
import type { Vec3Like } from '@domain/shared/Vec3';
import type { EntityTypeId } from '@domain/entity/EntityType';
import type { ChunkMeshData } from './ChunkMesher';

export interface CameraPose {
  readonly position: Vec3Like;
  readonly yaw: number;
  readonly pitch: number;
}

/**
 * Everything the renderer needs to draw one creature. A flat data record
 * rather than the `Mob` itself, so the renderer never reaches into domain
 * state and the two can evolve independently.
 */
export interface EntityView {
  readonly id: number;
  readonly type: EntityTypeId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  /** Drives the limb swing; grows with distance travelled. */
  readonly walkPhase: number;
  /** True while the damage flash should show. */
  readonly hurt: boolean;
}

/** Atmospheric state derived from the world clock. */
export interface SkyState {
  /** Ambient multiplier applied to baked vertex lighting, in [0, 1]. */
  readonly light: number;
  /** Height of the sun in [-1, 1]; drives sky colour. */
  readonly sunHeight: number;
  /** Additional dimming caused by rain or storms, in [0, 1]. */
  readonly weatherDarkening?: number;
  /** Pulls fog closer during poor weather. */
  readonly fogMultiplier?: number;
  /** World-space rain field strength; zero disables precipitation geometry. */
  readonly precipitation?: number;
}

export interface RenderStats {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly chunkMeshes: number;
  readonly entities: number;
}

/**
 * Presentation port. The application layer drives the renderer through this
 * and never touches a graphics API, which keeps chunk streaming, creatures and
 * gameplay testable headlessly.
 */
export interface GameRenderer {
  /** Uploads or replaces the geometry for a chunk. */
  updateChunk(coord: ChunkCoord, data: ChunkMeshData): void;

  /** Releases GPU resources for a chunk that left the view. */
  removeChunk(coord: ChunkCoord): void;

  /** Replaces the set of creatures drawn this frame. */
  syncEntities(views: readonly EntityView[]): void;

  /** Highlights the block being targeted, or clears it when null. */
  setBlockHighlight(block: Vec3Like | null): void;

  /** Mining progress on the targeted block, in [0, 1]. */
  setBreakProgress(progress: number): void;

  /** Tints the screen while the camera is inside a fluid. */
  setSubmerged(submerged: boolean): void;

  /** Applies time-of-day lighting and sky colour. */
  setSky(sky: SkyState): void;

  /** Optional terrain sampler used to stop world rain at roofs and ground. */
  setRainSurfaceSampler?(sampler: (x: number, z: number) => number | null): void;

  setRenderDistance(chunks: number): void;

  render(camera: CameraPose): void;

  getStats(): RenderStats;

  dispose(): void;
}
