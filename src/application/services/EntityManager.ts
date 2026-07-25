import { applyDamage, applyKnockback, fallDamageFor } from '@domain/combat/Combat';
import { stepBody } from '@domain/entity/EntityPhysics';
import type { EntityTypeId } from '@domain/entity/EntityType';
import { BrainState, Mob } from '@domain/entity/Mob';
import { startFleeing, updateBrain } from '@domain/entity/MobBrain';
import { MobSpawner, type SpawnSettings } from '@domain/entity/MobSpawner';
import type { Player } from '@domain/player/Player';
import type { World } from '@domain/world/World';
import type { TimeOfDay } from '@domain/world/TimeOfDay';
import { WORLD_MIN_Y } from '@domain/world/WorldConstants';
import type { EntityView } from '../ports/GameRenderer';

/** Jump impulse creatures use to clear obstacles they cannot step over. */
const MOB_JUMP_VELOCITY = 7.6;

/**
 * Hard ceiling on live creatures.
 *
 * The spawner has its own caps, but this is the backstop that guarantees a
 * bounded simulation and a bounded draw cost no matter how the spawn rules are
 * configured or how many worlds' worth of creatures drift into range.
 */
const ABSOLUTE_ENTITY_LIMIT = 60;

/** Damage a creature takes from falling, per block beyond the safe distance. */
const MOB_FALL_DAMAGE_SCALE = 1;

export interface PlayerHit {
  readonly amount: number;
  readonly sourceX: number;
  readonly sourceZ: number;
  readonly attacker: string;
}

export interface EntityUpdateResult {
  /** Attacks that landed on the player this tick. */
  readonly playerHits: readonly PlayerHit[];
}

export interface EntityManagerOptions {
  readonly world: World;
  readonly spawnSettings?: Partial<SpawnSettings>;
  /** Injectable so tests can drive behaviour deterministically. */
  readonly random?: () => number;
  readonly maxEntities?: number;
}

/**
 * Owns every creature in the world and advances them each tick.
 *
 * Creatures are deliberately not persisted: they are cheap to respawn, and
 * storing them would grow the save with state the player never notices is
 * missing. The population is a pure function of where the player is and what
 * time it is.
 */
export class EntityManager {
  private readonly world: World;
  private readonly spawner: MobSpawner;
  private readonly random: () => number;
  private readonly maxEntities: number;

  private readonly mobs = new Map<number, Mob>();
  private readonly hits: PlayerHit[] = [];
  private readonly views: EntityView[] = [];

  constructor(options: EntityManagerOptions) {
    this.world = options.world;
    this.spawner = new MobSpawner(options.spawnSettings);
    this.random = options.random ?? Math.random;
    this.maxEntities = Math.max(1, options.maxEntities ?? ABSOLUTE_ENTITY_LIMIT);
  }

  get count(): number {
    return this.mobs.size;
  }

  get hostileCount(): number {
    let total = 0;
    for (const mob of this.mobs.values()) if (mob.isHostile) total++;
    return total;
  }

  all(): IterableIterator<Mob> {
    return this.mobs.values();
  }

  get(id: number): Mob | null {
    return this.mobs.get(id) ?? null;
  }

  /** Adds a creature directly. Used by the spawner and by tests. */
  spawn(type: EntityTypeId, x: number, y: number, z: number, yaw = 0): Mob | null {
    if (this.mobs.size >= this.maxEntities) return null;
    const mob = new Mob(type, x, y, z, yaw);
    this.mobs.set(mob.id, mob);
    return mob;
  }

  removeAll(): void {
    this.mobs.clear();
  }

  /**
   * Advances brains, physics and spawning by one tick.
   *
   * Returns the attacks that landed on the player rather than applying them,
   * so damage rules stay in one place and this stays testable without a
   * player-damage pipeline.
   */
  update(player: Player, time: TimeOfDay, dt: number): EntityUpdateResult {
    this.hits.length = 0;
    if (dt <= 0 || !Number.isFinite(dt)) return { playerHits: this.hits };

    const targetable = !player.isDead && player.rules.attractsHostiles;

    for (const mob of this.mobs.values()) {
      this.updateMob(mob, player, time, dt, targetable);
    }

    this.cull(player, time);
    this.trySpawn(player, time, dt);

    return { playerHits: this.hits };
  }

  private updateMob(
    mob: Mob,
    player: Player,
    time: TimeOfDay,
    dt: number,
    targetable: boolean,
  ): void {
    if (!mob.isAlive) return;

    mob.beginTick();

    const brain = updateBrain(mob, {
      playerX: player.x,
      playerY: player.y,
      playerZ: player.z,
      playerTargetable: targetable,
      isNight: time.isNight,
      blocked: mob.blockedLastTick,
      random: this.random,
      dt,
    });

    const definition = mob.definition;
    const result = stepBody(
      mob,
      this.world,
      {
        size: { width: definition.width, height: definition.height },
        desiredVelocityX: brain.desiredVelocityX,
        desiredVelocityZ: brain.desiredVelocityZ,
        stepHeight: definition.stepHeight,
        jump: brain.jump,
        jumpVelocity: MOB_JUMP_VELOCITY,
      },
      dt,
    );

    mob.blockedLastTick = result.blocked;
    mob.moving = brain.desiredVelocityX !== 0 || brain.desiredVelocityZ !== 0;

    // The walk cycle advances with real ground covered, so animation speed
    // always matches actual movement instead of drifting out of sync.
    const travelled = Math.hypot(mob.x - mob.previousX, mob.z - mob.previousZ);
    mob.walkPhase += travelled * definition.walkCycleScale;

    if (result.landedFallDistance > 0) {
      const damage = fallDamageFor(result.landedFallDistance) * MOB_FALL_DAMAGE_SCALE;
      if (damage > 0) applyDamage(mob, damage);
    }

    if (brain.attack && targetable) {
      this.tryAttackPlayer(mob, player);
    }
  }

  private tryAttackPlayer(mob: Mob, player: Player): void {
    const definition = mob.definition;
    const reach = definition.attackRange + definition.width / 2 + 0.4;

    const dx = player.x - mob.x;
    const dz = player.z - mob.z;
    if (dx * dx + dz * dz > reach * reach) return;
    // A creature cannot hit a player standing well above or below it.
    if (Math.abs(player.y - mob.y) > definition.height + 0.6) return;

    mob.attackCooldown = definition.attackCooldown;
    this.hits.push({
      amount: definition.attackDamage,
      sourceX: mob.x,
      sourceZ: mob.z,
      attacker: definition.name,
    });
  }

  /**
   * Applies player damage to a creature, with knockback and a panic response.
   * Returns true when the creature died.
   */
  damage(mob: Mob, amount: number, fromX: number, fromZ: number, knockback: number): boolean {
    const result = applyDamage(mob, amount);
    if (!result.applied) return false;

    applyKnockback(mob, fromX, fromZ, mob.x, mob.z, knockback);

    if (result.fatal) {
      mob.removed = true;
      this.mobs.delete(mob.id);
      return true;
    }

    // Passives bolt; hostiles keep coming, which is what makes them a threat.
    if (!mob.isHostile) startFleeing(mob, fromX, fromZ);
    else mob.state = BrainState.Chase;

    return false;
  }

  /** Removes creatures that are dead, too far away, or out of the world. */
  private cull(player: Player, time: TimeOfDay): void {
    const despawnSquared = this.spawner.despawnRadius * this.spawner.despawnRadius;
    const day = !time.isNight;

    for (const mob of [...this.mobs.values()]) {
      if (!mob.isAlive) {
        this.mobs.delete(mob.id);
        continue;
      }

      // Fell out of the world, or drifted into terrain that has unloaded.
      if (mob.y < WORLD_MIN_Y - 4 || !this.world.isLoadedAt(mob.x, mob.z)) {
        this.mobs.delete(mob.id);
        continue;
      }

      if (mob.horizontalDistanceSquaredTo(player.x, player.z) > despawnSquared) {
        this.mobs.delete(mob.id);
        continue;
      }

      // Night creatures do not linger into the morning.
      if (day && mob.definition.despawnsAtDawn) {
        this.mobs.delete(mob.id);
      }
    }
  }

  private trySpawn(player: Player, time: TimeOfDay, dt: number): void {
    if (!this.spawner.tick(dt)) return;
    if (this.mobs.size >= this.maxEntities) return;
    // Nothing hunts a player who cannot be hurt.
    if (!player.rules.attractsHostiles && time.isNight) return;

    let hostile = 0;
    for (const mob of this.mobs.values()) if (mob.isHostile) hostile++;

    const requests = this.spawner.plan({
      world: this.world,
      playerX: player.x,
      playerZ: player.z,
      isNight: time.isNight,
      passiveCount: this.mobs.size - hostile,
      hostileCount: hostile,
      random: this.random,
    });

    for (const request of requests) {
      if (this.mobs.size >= this.maxEntities) break;
      this.spawn(request.type, request.x, request.y, request.z, request.yaw);
    }
  }

  /**
   * Render-facing snapshot, interpolated between the last two ticks.
   *
   * The array is reused between frames: rebuilding it would allocate once per
   * creature per frame for data the renderer reads and immediately discards.
   */
  snapshot(alpha: number): readonly EntityView[] {
    this.views.length = 0;
    const t = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;

    for (const mob of this.mobs.values()) {
      if (!mob.isAlive) continue;
      this.views.push({
        id: mob.id,
        type: mob.type,
        x: mob.previousX + (mob.x - mob.previousX) * t,
        y: mob.previousY + (mob.y - mob.previousY) * t,
        z: mob.previousZ + (mob.z - mob.previousZ) * t,
        yaw: mob.yaw,
        walkPhase: mob.walkPhase,
        hurt: mob.hurtTimer > 0,
      });
    }

    return this.views;
  }

  /** Population summary for the debug overlay. */
  stats(): { total: number; hostile: number } {
    let hostile = 0;
    for (const mob of this.mobs.values()) if (mob.isHostile) hostile++;
    return { total: this.mobs.size, hostile };
  }
}
