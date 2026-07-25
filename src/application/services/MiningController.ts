import { BlockRegistry } from '@domain/world/BlockType';
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
   * @returns True when a block was broken this tick.
   */
  update(player: Player, target: RaycastHit | null, held: boolean, dt: number): boolean {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    if (!held || target === null || player.isDead) {
      this.reset();
      return false;
    }

    const definition = BlockRegistry.get(target.block);
    if (definition.indestructible) {
      this.reset();
      return false;
    }

    if (player.rules.instantMining) {
      this.reset();
      if (this.cooldown > 0) return false;
      this.cooldown = CREATIVE_REPEAT_SECONDS;
      return this.editor.breakBlock(player).ok;
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
      return this.editor.breakBlock(player).ok;
    }

    this.progress += dt / hardness;
    if (this.progress < 1) return false;

    this.reset();
    return this.editor.breakBlock(player).ok;
  }

  /** Clears progress; call when the player dies, respawns or changes mode. */
  reset(): void {
    this.targetKey = null;
    this.progress = 0;
  }
}
