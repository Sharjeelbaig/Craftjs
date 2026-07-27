import type { ChunkCoord } from '@domain/world/ChunkCoord';
import type { Vec3Like } from '@domain/shared/Vec3';
import type { EntityTypeId } from '@domain/entity/EntityType';
import type { ItemId } from '@domain/inventory/Item';
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

export interface ItemDropView {
  readonly id: number;
  readonly item: ItemId;
  readonly count: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Seconds alive; drives a deterministic bob and spin. */
  readonly age: number;
}

/**
 * The item drawn in the player's hand.
 *
 * Deliberately flat and adapter-agnostic: the renderer decides whether that
 * means a textured cube, a box model or nothing at all.
 */
export interface HeldItemView {
  readonly item: ItemId;
  readonly name: string;
  /** Set when the item places a block, so the cube can be textured from it. */
  readonly block: number | null;
  /** Tool class, when the item is a tool. Picks the box model. */
  readonly tool: string | null;
  /** Base colour for items with no texture of their own. */
  readonly colour: number;
}

/** Atmospheric state derived from the world clock. */
export interface SkyState {
  /** Ambient multiplier applied to baked vertex lighting, in [0, 1]. */
  readonly light: number;
  /** Height of the sun in [-1, 1]; drives sky colour. */
  readonly sunHeight: number;
  /**
   * Horizontal leg of the sun's position in [-1, 1], paired with `sunHeight`.
   *
   * Height alone is a sine, so it cannot say which side of the sky the sun is
   * on — without this the sun would set on the side it rose from. Optional
   * because only the sky's geometry needs it, not its colour.
   */
  readonly sunHorizontal?: number;
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

  /** Optional for renderers that can display collectible item stacks. */
  syncItemDrops?(views: readonly ItemDropView[]): void;

  /**
   * Sets what the player is holding, or clears the hand when null. Optional so
   * headless renderers need not model a first-person view.
   */
  setHeldItem?(item: HeldItemView | null): void;

  /** Plays one swing of the held item. Optional, like `setHeldItem`. */
  swingHeldItem?(): void;

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
