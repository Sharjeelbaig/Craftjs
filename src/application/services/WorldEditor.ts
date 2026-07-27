import { BlockId, BlockRegistry } from '@domain/world/BlockType';
import type { World } from '@domain/world/World';
import { boxAtFeet, boxOfVoxel, boxesOverlap } from '@domain/physics/AABB';
import { raycastVoxels, type RaycastHit } from '@domain/physics/VoxelRaycaster';
import { PLAYER_REACH, PLAYER_SIZE, type Player } from '@domain/player/Player';
import { WORLD_MAX_Y, WORLD_MIN_Y } from '@domain/world/WorldConstants';
import type { ChunkStreamer } from './ChunkStreamer';

export const EditRejection = {
  NoTarget: 'noTarget',
  Indestructible: 'indestructible',
  OutOfBounds: 'outOfBounds',
  Occupied: 'occupied',
  IntersectsPlayer: 'intersectsPlayer',
  NotLoaded: 'notLoaded',
  Unsupported: 'unsupported',
} as const;

export type EditRejection = (typeof EditRejection)[keyof typeof EditRejection];

export type EditResult =
  | { readonly ok: true; readonly x: number; readonly y: number; readonly z: number }
  | { readonly ok: false; readonly reason: EditRejection };

/**
 * Applies player edits to the world.
 *
 * Every rule that decides whether an edit is legal lives here, so break/place
 * behave identically no matter which input triggered them, and the streamer is
 * always told exactly which meshes to rebuild.
 */
export class WorldEditor {
  private readonly world: World;
  private readonly streamer: ChunkStreamer;

  constructor(world: World, streamer: ChunkStreamer) {
    this.world = world;
    this.streamer = streamer;
  }

  /**
   * The block the player is aiming at.
   * Fluids are see-through for targeting, matching player expectation.
   */
  findTarget(player: Player): RaycastHit | null {
    return raycastVoxels(
      this.world,
      player.eyePosition,
      player.lookDirection,
      PLAYER_REACH,
      (block) => block !== BlockId.Air && !BlockRegistry.isLiquid(block),
    );
  }

  breakBlock(player: Player): EditResult {
    const hit = this.findTarget(player);
    if (hit === null) return { ok: false, reason: EditRejection.NoTarget };
    if (BlockRegistry.get(hit.block).indestructible) {
      return { ok: false, reason: EditRejection.Indestructible };
    }
    return this.write(hit.x, hit.y, hit.z, BlockId.Air);
  }

  placeBlock(player: Player, block: BlockId): EditResult {
    const hit = this.findTarget(player);
    if (hit === null) return { ok: false, reason: EditRejection.NoTarget };

    // Place into the empty cell on the face that was hit.
    const x = hit.x + hit.normalX;
    const y = hit.y + hit.normalY;
    const z = hit.z + hit.normalZ;

    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) {
      return { ok: false, reason: EditRejection.OutOfBounds };
    }
    if (!this.world.isLoadedAt(x, z)) {
      return { ok: false, reason: EditRejection.NotLoaded };
    }
    if (!BlockRegistry.isReplaceable(this.world.getBlock(x, y, z))) {
      return { ok: false, reason: EditRejection.Occupied };
    }
    // Refusing to entomb the player is what stops them clipping into geometry.
    if (BlockRegistry.isSolid(block) && this.intersectsPlayer(player, x, y, z)) {
      return { ok: false, reason: EditRejection.IntersectsPlayer };
    }
    // Rails and beds read as floating debris without a floor under them.
    if (BlockRegistry.needsSupport(block) && !this.world.isSolidAt(x, y - 1, z)) {
      return { ok: false, reason: EditRejection.Unsupported };
    }

    return this.write(x, y, z, block);
  }

  /** Applies a validated edit received from a trusted application boundary. */
  applyBlockEdit(x: number, y: number, z: number, block: BlockId): EditResult {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !Number.isInteger(z) ||
      y < WORLD_MIN_Y ||
      y > WORLD_MAX_Y ||
      !BlockRegistry.isKnown(block)
    ) {
      return { ok: false, reason: EditRejection.OutOfBounds };
    }
    return this.write(x, y, z, block);
  }

  private write(x: number, y: number, z: number, block: number): EditResult {
    const change = this.world.setBlock(x, y, z, block);
    if (change === null) return { ok: false, reason: EditRejection.NotLoaded };

    // A border edit changes the neighbour's visible faces and its ambient
    // occlusion, so those meshes must be rebuilt as well.
    for (const coord of change.affectedChunks) {
      this.streamer.invalidateMesh(coord);
    }
    if (block === BlockId.Air) this.dropUnsupported(x, y + 1, z);
    return { ok: true, x, y, z };
  }

  /**
   * Removes a support-dependent block whose floor just disappeared.
   *
   * Only one cell is examined, and only when it holds such a block, so mining
   * out a hillside cannot cascade into an unbounded sweep of the world.
   */
  private dropUnsupported(x: number, y: number, z: number): void {
    const above = this.world.getBlock(x, y, z);
    if (above === BlockId.Air || !BlockRegistry.needsSupport(above)) return;

    const change = this.world.setBlock(x, y, z, BlockId.Air);
    if (change === null) return;
    for (const coord of change.affectedChunks) {
      this.streamer.invalidateMesh(coord);
    }
  }

  private intersectsPlayer(player: Player, x: number, y: number, z: number): boolean {
    return boxesOverlap(
      boxOfVoxel(x, y, z),
      boxAtFeet(player, PLAYER_SIZE.width, PLAYER_SIZE.height),
    );
  }
}
