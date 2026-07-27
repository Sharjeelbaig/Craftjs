import { applyDamage, applyKnockback, fallDamageFor } from '@domain/combat/Combat';
import { stepBody } from '@domain/entity/EntityPhysics';
import { ItemDrop } from '@domain/entity/ItemDrop';
import { rollMobLoot } from '@domain/entity/MobLoot';
import { EntityRegistry, type EntityTypeId } from '@domain/entity/EntityType';
import { BrainState, Mob } from '@domain/entity/Mob';
import { startFleeing, turnToward, updateBrain } from '@domain/entity/MobBrain';
import { MobSpawner, isSkyExposed, type SpawnSettings } from '@domain/entity/MobSpawner';
import { driveRailCart, steerMount, type VehicleOutput } from '@domain/entity/Vehicle';
import type { PlayerIntent } from '@domain/player/PlayerIntent';
import type { ItemId } from '@domain/inventory/Item';
import type { Player } from '@domain/player/Player';
import type { World } from '@domain/world/World';
import type { TimeOfDay } from '@domain/world/TimeOfDay';
import { WORLD_MIN_Y } from '@domain/world/WorldConstants';
import type { EntityView, ItemDropView } from '../ports/GameRenderer';

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

/**
 * Separate ceiling for player-placed entities.
 *
 * Carts are exempt from despawning, so counting them against the creature cap
 * would let a long rail line quietly stop the world spawning any wildlife.
 */
const MAX_PLACED_ENTITIES = 16;
const ABSOLUTE_ITEM_DROP_LIMIT = 128;
const ITEM_DROP_SIZE = Object.freeze({ width: 0.25, height: 0.25 });
const ITEM_PICKUP_RADIUS_SQUARED = 1.6 * 1.6;

/** Damage a creature takes from falling, per block beyond the safe distance. */
const MOB_FALL_DAMAGE_SCALE = 1;

/**
 * Interval between shelter samples per creature.
 *
 * The test scans a whole column, so running it every tick for every creature
 * would cost more than the rest of the entity update combined.
 */
const SHELTER_SAMPLE_SECONDS = 0.5;

/** How fast a ridden mount swings round to the rider's chosen heading. */
const RIDDEN_TURN_RATE = 8;

export interface PlayerHit {
  readonly amount: number;
  readonly sourceX: number;
  readonly sourceZ: number;
  readonly attacker: string;
}

export interface EntityUpdateResult {
  /** Attacks that landed on the player this tick. */
  readonly playerHits: readonly PlayerHit[];
  /** Item stacks close enough to be transferred into the player's inventory. */
  readonly pickups: readonly ItemPickup[];
}

export interface ItemPickup {
  readonly item: ItemId;
  readonly count: number;
}

/** What the rider is asking their mount to do this tick. */
export interface RideControl {
  readonly intent: PlayerIntent;
  /** Where the rider is looking; mounts steer by camera, not by their own facing. */
  readonly yaw: number;
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
  private readonly drops = new Map<number, ItemDrop>();
  /** Id of the entity the player is sitting on, or null when on foot. */
  private riddenId: number | null = null;
  private readonly hits: PlayerHit[] = [];
  private readonly pickups: ItemPickup[] = [];
  private readonly views: EntityView[] = [];
  private readonly dropViews: ItemDropView[] = [];

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

  get itemDropCount(): number {
    return this.drops.size;
  }

  all(): IterableIterator<Mob> {
    return this.mobs.values();
  }

  /**
   * Distance to the closest living hostile, or null when none exist.
   *
   * Sleeping needs this, and reading it here keeps the caller from having to
   * iterate the population and know what counts as hostile.
   */
  nearestHostileDistance(x: number, y: number, z: number): number | null {
    let closest = Number.POSITIVE_INFINITY;
    for (const mob of this.mobs.values()) {
      if (!mob.isAlive || !mob.isHostile) continue;
      closest = Math.min(closest, mob.distanceSquaredTo(x, y, z));
    }
    return Number.isFinite(closest) ? Math.sqrt(closest) : null;
  }

  get(id: number): Mob | null {
    return this.mobs.get(id) ?? null;
  }

  /** Placed objects such as minecarts, which do not count as wildlife. */
  get placedCount(): number {
    let total = 0;
    for (const mob of this.mobs.values()) if (mob.definition.placedByPlayer) total++;
    return total;
  }

  /** Adds a creature directly. Used by the spawner and by tests. */
  spawn(type: EntityTypeId, x: number, y: number, z: number, yaw = 0): Mob | null {
    if (EntityRegistry.isPlacedByPlayer(type)) {
      if (this.placedCount >= MAX_PLACED_ENTITIES) return null;
    } else if (this.creatureCount >= this.maxEntities) {
      return null;
    }

    const mob = new Mob(type, x, y, z, yaw);
    this.mobs.set(mob.id, mob);
    return mob;
  }

  /** Live wildlife, excluding anything the player placed. */
  private get creatureCount(): number {
    let total = 0;
    for (const mob of this.mobs.values()) if (!mob.definition.placedByPlayer) total++;
    return total;
  }

  removeAll(): void {
    this.mobs.clear();
    this.drops.clear();
    this.riddenId = null;
  }

  /** The entity the player is riding, or null. */
  get ridden(): Mob | null {
    if (this.riddenId === null) return null;
    const mob = this.mobs.get(this.riddenId) ?? null;
    // A mount that died or despawned drops its rider rather than leaving the
    // player welded to a ghost.
    if (mob === null || !mob.isAlive) {
      this.riddenId = null;
      return null;
    }
    return mob;
  }

  /** Seats the player on a rideable entity. */
  mount(mob: Mob): boolean {
    if (!mob.isAlive || !mob.definition.rideable) return false;
    this.riddenId = mob.id;
    return true;
  }

  /** Stands the player up. Returns the entity they were on, if any. */
  dismount(): Mob | null {
    const mob = this.ridden;
    this.riddenId = null;
    return mob;
  }

  /**
   * Advances brains, physics and spawning by one tick.
   *
   * Returns the attacks that landed on the player rather than applying them,
   * so damage rules stay in one place and this stays testable without a
   * player-damage pipeline.
   */
  update(
    player: Player,
    time: TimeOfDay,
    dt: number,
    ride: RideControl | null = null,
  ): EntityUpdateResult {
    this.hits.length = 0;
    this.pickups.length = 0;
    if (dt <= 0 || !Number.isFinite(dt)) {
      return { playerHits: this.hits, pickups: this.pickups };
    }

    const targetable = !player.isDead && player.rules.attractsHostiles;
    const ridden = this.ridden;

    for (const mob of this.mobs.values()) {
      if (mob === ridden && ride !== null) this.updateRidden(mob, ride, dt);
      else this.updateMob(mob, player, time, dt, targetable);
    }
    this.updateDrops(player, dt);

    this.cull(player, time);
    this.trySpawn(player, time, dt);

    return { playerHits: this.hits, pickups: this.pickups };
  }

  /**
   * Advances the entity the player is steering.
   *
   * The brain is bypassed entirely: a driven vehicle has no wandering or
   * hunting to do, and letting a brain run alongside rider input would fight it
   * for the same velocity every tick.
   */
  private updateRidden(mob: Mob, ride: RideControl, dt: number): void {
    mob.beginTick();
    const definition = mob.definition;

    let output: VehicleOutput;
    if (definition.railBound) {
      const drive = driveRailCart(
        mob,
        definition,
        ride.intent,
        ride.yaw,
        mob.railSpeed,
        dt,
        this.world,
      );
      mob.railSpeed = drive.railSpeed;
      output = drive;
    } else {
      output = steerMount(mob, definition, ride.intent, ride.yaw);
    }

    const result = stepBody(
      mob,
      this.world,
      {
        size: { width: definition.width, height: definition.height },
        desiredVelocityX: output.desiredVelocityX,
        desiredVelocityZ: output.desiredVelocityZ,
        stepHeight: definition.stepHeight,
        jump: output.jump,
        jumpVelocity: MOB_JUMP_VELOCITY,
      },
      dt,
    );

    mob.blockedLastTick = result.blocked;
    mob.moving = output.desiredVelocityX !== 0 || output.desiredVelocityZ !== 0;
    const travelled = Math.hypot(mob.x - mob.previousX, mob.z - mob.previousZ);
    mob.walkPhase += travelled * definition.walkCycleScale;

    // Turn the body toward the direction the rider chose.
    turnToward(mob, dt, RIDDEN_TURN_RATE);
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

    mob.shelterTimer -= dt;
    if (mob.shelterTimer <= 0) {
      mob.shelterTimer = SHELTER_SAMPLE_SECONDS;
      mob.sheltered = !isSkyExposed(this.world, mob.x, mob.y, mob.z);
    }

    const brain = updateBrain(mob, {
      playerX: player.x,
      playerY: player.y,
      playerZ: player.z,
      playerTargetable: targetable,
      isDark: time.isNight || mob.sheltered,
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
      if (damage > 0) {
        const outcome = applyDamage(mob, damage);
        if (outcome.fatal) {
          this.createDrops(mob);
          mob.removed = true;
          this.mobs.delete(mob.id);
          return;
        }
      }
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
      this.createDrops(mob);
      mob.removed = true;
      this.mobs.delete(mob.id);
      if (this.riddenId === mob.id) this.riddenId = null;
      return true;
    }

    // Passives bolt; hostiles keep coming, which is what makes them a threat.
    if (!mob.isHostile) startFleeing(mob, fromX, fromZ);
    else mob.state = BrainState.Chase;

    return false;
  }

  private createDrops(mob: Mob): void {
    for (const loot of rollMobLoot(mob.type, this.random)) {
      if (this.drops.size >= ABSOLUTE_ITEM_DROP_LIMIT) {
        const oldest = this.drops.keys().next().value as number | undefined;
        if (oldest !== undefined) this.drops.delete(oldest);
      }

      const angle = this.random() * Math.PI * 2;
      const speed = 0.8 + this.random() * 0.8;
      const drop = new ItemDrop(
        loot.item,
        loot.count,
        mob.x,
        mob.y + Math.min(0.7, mob.definition.height * 0.5),
        mob.z,
        Math.cos(angle) * speed,
        3.2 + this.random() * 1.2,
        Math.sin(angle) * speed,
      );
      this.drops.set(drop.id, drop);
    }
  }

  private updateDrops(player: Player, dt: number): void {
    for (const drop of [...this.drops.values()]) {
      drop.beginTick();
      drop.age += dt;

      stepBody(
        drop,
        this.world,
        {
          size: ITEM_DROP_SIZE,
          desiredVelocityX: 0,
          desiredVelocityZ: 0,
          stepHeight: 0,
          jump: false,
          jumpVelocity: 0,
        },
        dt,
      );

      if (drop.expired || drop.y < WORLD_MIN_Y - 4 || !this.world.isLoadedAt(drop.x, drop.z)) {
        this.drops.delete(drop.id);
        continue;
      }

      const dx = drop.x - player.x;
      const dz = drop.z - player.z;
      if (
        !player.isDead &&
        drop.collectable &&
        dx * dx + dz * dz <= ITEM_PICKUP_RADIUS_SQUARED &&
        Math.abs(drop.y - player.y) <= 2
      ) {
        drop.removed = true;
        this.drops.delete(drop.id);
        this.pickups.push(Object.freeze({ item: drop.item, count: drop.count }));
      }
    }
  }

  /** Removes creatures that are dead, too far away, or out of the world. */
  private cull(player: Player, time: TimeOfDay): void {
    const despawnSquared = this.spawner.despawnRadius * this.spawner.despawnRadius;
    const day = !time.isNight;

    for (const mob of [...this.mobs.values()]) {
      if (!mob.isAlive) {
        this.mobs.delete(mob.id);
        if (this.riddenId === mob.id) this.riddenId = null;
        continue;
      }

      // Whatever the player is sitting on stays, whatever the rules say: having
      // a mount evaporate underneath the rider is never the right answer. The
      // same holds for anything the player put there deliberately.
      if (mob.id === this.riddenId || mob.definition.placedByPlayer) continue;

      // Fell out of the world, or drifted into terrain that has unloaded.
      if (mob.y < WORLD_MIN_Y - 4 || !this.world.isLoadedAt(mob.x, mob.z)) {
        this.mobs.delete(mob.id);
        continue;
      }

      if (mob.horizontalDistanceSquaredTo(player.x, player.z) > despawnSquared) {
        this.mobs.delete(mob.id);
        continue;
      }

      // Night creatures do not linger into the morning — but one standing in a
      // cave or a roofed base is still in the dark, and removing it would empty
      // out every mine the moment the sun came up.
      if (day && mob.definition.despawnsAtDawn && isSkyExposed(this.world, mob.x, mob.y, mob.z)) {
        this.mobs.delete(mob.id);
      }
    }
  }

  private trySpawn(player: Player, time: TimeOfDay, dt: number): void {
    if (!this.spawner.tick(dt)) return;

    let hostile = 0;
    let creatures = 0;
    for (const mob of this.mobs.values()) {
      if (mob.definition.placedByPlayer) continue;
      creatures++;
      if (mob.isHostile) hostile++;
    }
    if (creatures >= this.maxEntities) return;

    const requests = this.spawner.plan({
      world: this.world,
      playerX: player.x,
      playerY: player.y,
      playerZ: player.z,
      isNight: time.isNight,
      // Nothing hunts a player who cannot be hurt.
      hostilesAllowed: player.rules.attractsHostiles,
      passiveCount: creatures - hostile,
      hostileCount: hostile,
      random: this.random,
    });

    for (const request of requests) {
      if (this.spawn(request.type, request.x, request.y, request.z, request.yaw) === null) break;
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

  /** Render-facing item stacks, kept separate from creature model ids. */
  itemDropSnapshot(alpha: number): readonly ItemDropView[] {
    this.dropViews.length = 0;
    const t = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
    for (const drop of this.drops.values()) {
      this.dropViews.push({
        id: drop.id,
        item: drop.item,
        count: drop.count,
        x: drop.previousX + (drop.x - drop.previousX) * t,
        y: drop.previousY + (drop.y - drop.previousY) * t,
        z: drop.previousZ + (drop.z - drop.previousZ) * t,
        age: drop.age,
      });
    }
    return this.dropViews;
  }

  /** Population summary for the debug overlay. */
  stats(): { total: number; hostile: number; drops: number } {
    let hostile = 0;
    for (const mob of this.mobs.values()) if (mob.isHostile) hostile++;
    return { total: this.mobs.size, hostile, drops: this.drops.size };
  }
}
