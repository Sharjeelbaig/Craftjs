import { BlockRegistry, type BlockId } from '@domain/world/BlockType';
import { miningSpeedFor } from '@domain/inventory/Tool';
import type { ItemId } from '@domain/inventory/Item';
import type { RaycastHit } from '@domain/physics/VoxelRaycaster';
import type { Player } from '@domain/player/Player';
import type { WorldEditor } from './WorldEditor';

/** Repeat interval for instant mining, so creative does not clear a tunnel. */
const CREATIVE_REPEAT_SECONDS = 0.22;

/**
 * Tracks progress on the block the player is breaking.
 *
 * Mining time is the main pacing mechanism survival has: it is what makes
 * stone meaningfully harder to remove than dirt, and what stops a player
 * tunnelling through a hillside instantly. Progress is bound to a specific
 * block, so looking away or switching targets resets it rather than letting
 * the player accumulate credit across the world.
 */
export class MiningController {
  private readonly editor: WorldEditor;

  private targetKey: string | null = null;
  private progress = 0;
  private cooldown = 0;

  constructor(editor: WorldEditor) {
    this.editor = editor;
  }

  /** Progress on the current block, in [0, 1]. Zero when not mining. */
  get currentProgress(): number {
    return this.targetKey === null ? 0 : this.progress;
  }

  /**
   * Advances mining by one tick.
   *
   * @param held True while the primary button is down.
   * @param tool The equipped item, which sets the speed multiplier.
   * @returns The block type broken this tick, or null.
   */
  update(
    player: Player,
    target: RaycastHit | null,
    held: boolean,
    dt: number,
    tool: ItemId | null = null,
  ): BlockId | null {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    if (!held || target === null || player.isDead) {
      this.reset();
      return null;
    }

    const definition = BlockRegistry.get(target.block);
    if (definition.indestructible) {
      this.reset();
      return null;
    }

    if (player.rules.instantMining) {
      this.reset();
      if (this.cooldown > 0) return null;
      this.cooldown = CREATIVE_REPEAT_SECONDS;
      return this.editor.breakBlock(player).ok ? (target.block as BlockId) : null;
    }

    const key = `${target.x},${target.y},${target.z}`;
    // Switching blocks abandons the old one; partial progress is not banked.
    if (key !== this.targetKey) {
      this.targetKey = key;
      this.progress = 0;
    }

    const hardness = definition.hardness;
    if (!Number.isFinite(hardness) || hardness <= 0) {
      this.reset();
      return this.editor.breakBlock(player).ok ? (target.block as BlockId) : null;
    }

    // The right tool divides the block's hardness; the wrong one leaves it
    // untouched, which is what makes carrying a pickaxe worth the slot.
    const speed = miningSpeedFor(tool, target.block);
    this.progress += (dt * speed) / hardness;
    if (this.progress < 1) return null;

    this.reset();
    return this.editor.breakBlock(player).ok ? (target.block as BlockId) : null;
  }

  /** Clears progress; call when the player dies, respawns or changes mode. */
  reset(): void {
    this.targetKey = null;
    this.progress = 0;
  }
}
