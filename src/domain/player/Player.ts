import { Vec3, clamp } from '../shared/Vec3';
import type { EntitySize } from '../physics/CollisionResolver';
import { Inventory, type InventorySnapshot } from '../inventory/Inventory';
import { GameMode, parseGameMode, rulesFor, type GameModeRules } from './GameMode';

/** Collision dimensions, in blocks. */
export const PLAYER_SIZE: EntitySize = Object.freeze({ width: 0.6, height: 1.8 });

/** Camera offset above the player's feet. */
export const PLAYER_EYE_HEIGHT = 1.62;

/** How far the player can reach to break or place a block. */
export const PLAYER_REACH = 5;

/** Health at full, in half-heart units. */
export const PLAYER_MAX_HEALTH = 20;

/** Damage the player deals with a bare-handed hit. */
export const PLAYER_ATTACK_DAMAGE = 3;

/** Seconds between attacks. */
export const PLAYER_ATTACK_COOLDOWN = 0.35;

/** Force applied to a creature the player hits. */
export const PLAYER_KNOCKBACK = 7;

const PITCH_LIMIT = Math.PI / 2 - 1e-3;
const TAU = Math.PI * 2;

export const MovementMode = {
  Walking: 'walking',
  Flying: 'flying',
} as const;

export type MovementMode = (typeof MovementMode)[keyof typeof MovementMode];

/** Serialisable player state for persistence. */
export interface PlayerSnapshot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly mode: MovementMode;
  readonly selectedSlot: number;
  /** Optional so saves written before survival mode still load. */
  readonly gameMode?: GameMode;
  readonly health?: number;
  readonly spawnX?: number;
  readonly spawnY?: number;
  readonly spawnZ?: number;
  /** Optional so worlds saved before inventories were introduced still load. */
  readonly inventory?: InventorySnapshot;
  /** Single-use starter chest state. Absent in saves written before bonus chests. */
  readonly bonusChestClaimed?: boolean;
}

/**
 * The player entity.
 *
 * `position` is the centre of the footprint at feet level. Mutable by design:
 * it is updated every physics tick and allocating value objects there would
 * dominate the frame budget.
 */
export class Player {
  x: number;
  y: number;
  z: number;

  velocityX = 0;
  velocityY = 0;
  velocityZ = 0;

  /** Position at the end of the previous tick, for render interpolation. */
  previousX: number;
  previousY: number;
  previousZ: number;

  yaw: number;
  pitch: number;

  onGround = false;
  inLiquid = false;
  mode: MovementMode = MovementMode.Walking;
  selectedSlot = 0;
  inventory = new Inventory();
  bonusChestClaimed = false;

  gameMode: GameMode = GameMode.Survival;
  health = PLAYER_MAX_HEALTH;
  readonly maxHealth = PLAYER_MAX_HEALTH;
  /** Remaining invulnerability; also drives the damage flash. */
  hurtTimer = 0;
  /** Remaining cooldown before the next attack. */
  attackCooldown = 0;
  /** Distance fallen since last touching the ground. */
  fallDistance = 0;

  /** Where the player returns after dying. */
  spawnX: number;
  spawnY: number;
  spawnZ: number;

  constructor(x: number, y: number, z: number, yaw = 0, pitch = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.previousX = x;
    this.previousY = y;
    this.previousZ = z;
    this.yaw = yaw;
    this.pitch = pitch;
    this.spawnX = x;
    this.spawnY = y;
    this.spawnZ = z;
  }

  static fromSnapshot(snapshot: PlayerSnapshot): Player {
    const player = new Player(
      snapshot.x,
      snapshot.y,
      snapshot.z,
      snapshot.yaw,
      snapshot.pitch,
    );
    player.mode = snapshot.mode === MovementMode.Flying ? MovementMode.Flying : MovementMode.Walking;
    player.selectedSlot = snapshot.selectedSlot;
    player.gameMode = parseGameMode(snapshot.gameMode);
    player.inventory =
      snapshot.inventory === undefined && player.gameMode === GameMode.Creative
        ? Inventory.creativeLoadout()
        : Inventory.fromSnapshot(snapshot.inventory);

    // Hardcore is the one mode where zero health is meaningful across reloads.
    // Other old or malformed saves still recover to a playable state.
    const health = Number(snapshot.health);
    player.health =
      player.gameMode === GameMode.Hardcore && Number.isFinite(health) && health <= 0
        ? 0
        : Number.isFinite(health) && health > 0
          ? Math.min(health, PLAYER_MAX_HEALTH)
          : PLAYER_MAX_HEALTH;
    player.bonusChestClaimed = snapshot.bonusChestClaimed === true;

    if (
      Number.isFinite(snapshot.spawnX) &&
      Number.isFinite(snapshot.spawnY) &&
      Number.isFinite(snapshot.spawnZ)
    ) {
      player.spawnX = snapshot.spawnX as number;
      player.spawnY = snapshot.spawnY as number;
      player.spawnZ = snapshot.spawnZ as number;
    }

    // Flight is a creative privilege; a survival save must not restore into it.
    if (!player.rules.canFly) player.mode = MovementMode.Walking;

    return player;
  }

  toSnapshot(): PlayerSnapshot {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      yaw: this.yaw,
      pitch: this.pitch,
      mode: this.mode,
      selectedSlot: this.selectedSlot,
      gameMode: this.gameMode,
      health: this.health,
      spawnX: this.spawnX,
      spawnY: this.spawnY,
      spawnZ: this.spawnZ,
      inventory: this.inventory.toSnapshot(),
      bonusChestClaimed: this.bonusChestClaimed,
    };
  }

  get rules(): GameModeRules {
    return rulesFor(this.gameMode);
  }

  get isDead(): boolean {
    return this.rules.takesDamage && this.health <= 0;
  }

  /** Switches mode, enforcing the rules that differ between them. */
  setGameMode(mode: GameMode): boolean {
    if (mode === this.gameMode) return true;
    if (!this.rules.canChangeMode || mode === GameMode.Hardcore) return false;
    this.gameMode = mode;
    if (!this.rules.canFly) this.mode = MovementMode.Walking;
    if (!this.rules.takesDamage) {
      this.health = this.maxHealth;
      this.hurtTimer = 0;
      // Old survival worlds can enter creative without being left with an
      // empty hotbar. Existing player choices are preserved where present.
      const creative = Inventory.creativeLoadout();
      for (let index = 0; index < this.inventory.hotbar.length; index++) {
        if (this.inventory.hotbar[index] === null) {
          this.inventory.hotbar[index] = creative.hotbar[index];
        }
      }
    }
    this.fallDistance = 0;
    return true;
  }

  /** Restores the player at their spawn point with full health. */
  respawn(): boolean {
    if (!this.rules.canRespawn) return false;
    this.health = this.maxHealth;
    this.hurtTimer = 0;
    this.attackCooldown = 0;
    this.fallDistance = 0;
    this.mode = MovementMode.Walking;
    this.moveTo(this.spawnX, this.spawnY, this.spawnZ);
    return true;
  }

  setSpawnPoint(x: number, y: number, z: number): void {
    this.spawnX = x;
    this.spawnY = y;
    this.spawnZ = z;
  }

  /** Records the pre-tick position so the renderer can interpolate. */
  beginTick(): void {
    this.previousX = this.x;
    this.previousY = this.y;
    this.previousZ = this.z;
  }

  /** Teleports without leaving an interpolation trail. */
  moveTo(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.previousX = x;
    this.previousY = y;
    this.previousZ = z;
    this.velocityX = 0;
    this.velocityY = 0;
    this.velocityZ = 0;
  }

  /** Applies a look delta in radians, clamping pitch and wrapping yaw. */
  rotate(deltaYaw: number, deltaPitch: number): void {
    this.yaw = ((this.yaw + deltaYaw) % TAU + TAU) % TAU;
    this.pitch = clamp(this.pitch + deltaPitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  get position(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  get eyePosition(): Vec3 {
    return new Vec3(this.x, this.y + PLAYER_EYE_HEIGHT, this.z);
  }

  /** Unit vector the camera is facing. */
  get lookDirection(): Vec3 {
    const cosPitch = Math.cos(this.pitch);
    return new Vec3(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
    );
  }

  /** Toggles flight. Ignored in modes that do not permit it. */
  toggleMovementMode(): boolean {
    if (!this.rules.canFly) return false;
    this.mode = this.mode === MovementMode.Flying ? MovementMode.Walking : MovementMode.Flying;
    this.velocityY = 0;
    this.fallDistance = 0;
    return true;
  }

  /** Advances per-tick timers. */
  tickTimers(dt: number): void {
    if (this.hurtTimer > 0) this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - dt);
  }
}
