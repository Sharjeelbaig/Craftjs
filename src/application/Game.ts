import type { ChunkGenerator } from '@domain/generation/ChunkGenerator';
import { createTerrainGenerator } from '@domain/generation/ConfiguredTerrainGenerator';
import { BlockId, BlockRegistry, HOTBAR_BLOCKS } from '@domain/world/BlockType';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { World } from '@domain/world/World';
import { TimeOfDay } from '@domain/world/TimeOfDay';
import { Weather, type WeatherKind } from '@domain/world/Weather';
import { CHUNK_SIZE, SEA_LEVEL } from '@domain/world/WorldConstants';
import {
  MovementMode,
  PLAYER_EYE_HEIGHT,
  PLAYER_REACH,
  PLAYER_SIZE,
  Player,
  type PlayerSnapshot,
} from '@domain/player/Player';
import {
  WAKE_FRACTION,
  canSleep,
  sleepRejectionMessage,
} from '@domain/world/Sleep';
import { GameMode, parseGameMode } from '@domain/player/GameMode';
import {
  defaultWorldCreationSettings,
  type WorldCreationSettings,
} from '@domain/world/WorldCreationSettings';
import { starterChestLoot, starterChestPosition } from '@domain/world/StarterChest';
import { Inventory } from '@domain/inventory/Inventory';
import { RECIPES, canCraft, craft } from '@domain/inventory/Crafting';
import { blockDrop } from '@domain/inventory/BlockDrops';
import { canHarvest, toolProfile } from '@domain/inventory/Tool';
import {
  catalogItem,
  itemDefinition,
  type ItemDefinition,
  type ItemId,
} from '@domain/inventory/Item';
import { PlayerMovement } from '@domain/player/PlayerMovement';
import { isPositionObstructed } from '@domain/physics/CollisionResolver';
import type { RaycastHit } from '@domain/physics/VoxelRaycaster';

import { GameLoop, browserClock, type GameLoopHandlers, type LoopClock } from './GameLoop';
import { ChunkStreamer, type StreamingSettings } from './services/ChunkStreamer';
import { EditRejection, WorldEditor } from './services/WorldEditor';
import { EntityManager } from './services/EntityManager';
import { CombatService } from './services/CombatService';
import { MiningController } from './services/MiningController';
import { PerformanceGovernor } from './services/PerformanceGovernor';
import type { SpawnSettings } from '@domain/entity/MobSpawner';
import type { ChunkMesher } from './ports/ChunkMesher';
import type { GameRenderer } from './ports/GameRenderer';
import { InputAction, type InputSource } from './ports/InputSource';
import type { WorldRepository } from './ports/WorldRepository';
import type { BlockEditMessage, MultiplayerSession } from './ports/MultiplayerSession';
import { EntityTypeId } from '@domain/entity/EntityType';
import { canPlaceCart } from '@domain/entity/Vehicle';
import type { EntityView } from './ports/GameRenderer';

/** Save format version, bumped when stored records change shape. */
const SAVE_VERSION = 4;

const AUTOSAVE_INTERVAL_SECONDS = 20;

/** Chunks force-loaded before the first frame so spawn is never mid-air. */
const SPAWN_PRELOAD_RADIUS = 1;

/** Items with behaviour of their own rather than a block to place. */
const MINECART_ITEM = catalogItem('minecart');
const SADDLE_ITEM = catalogItem('saddle');

/**
 * Consecutive frame failures tolerated before the loop gives up.
 *
 * One bad frame — a transient GPU hiccup, a malformed chunk — should never end
 * the session. A permanently broken frame should not spin forever burning
 * battery and filling the console either.
 */
const MAX_CONSECUTIVE_FRAME_ERRORS = 30;

export interface GameDebugInfo {
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly position: { x: number; y: number; z: number };
  readonly chunk: { x: number; z: number };
  readonly mode: MovementMode;
  readonly gameMode: GameMode;
  readonly health: number;
  readonly maxHealth: number;
  readonly onGround: boolean;
  readonly inLiquid: boolean;
  readonly seed: number;
  readonly time: string;
  readonly isNight: boolean;
  readonly loadedChunks: number;
  readonly renderDistance: number;
  readonly pendingGeneration: number;
  readonly meshesInFlight: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly entities: number;
  readonly hostiles: number;
  readonly itemDrops: number;
  readonly targetBlock: string | null;
  readonly targetEntity: string | null;
  readonly persistence: 'durable' | 'memory';
}

function stablePeerId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return -(Math.abs(hash | 0) + 1);
}

/** State the HUD mirrors; emitted only when a value actually changes. */
export interface PlayerStatus {
  readonly health: number;
  readonly maxHealth: number;
  readonly gameMode: GameMode;
  readonly dead: boolean;
}

export interface InventoryView {
  readonly creative: boolean;
  readonly selectedSlot: number;
  readonly hotbar: readonly (ItemView | null)[];
  readonly items: readonly ItemView[];
  readonly recipes: readonly {
    id: string;
    name: string;
    available: boolean;
    detail: string;
  }[];
}

export interface ItemView {
  readonly id: ItemId;
  readonly name: string;
  readonly kind: ItemDefinition['kind'];
  readonly count: number;
}

export interface WorldStatus {
  readonly time: string;
  readonly isNight: boolean;
  readonly weather: WeatherKind;
}

export interface GameOptions {
  readonly renderer: GameRenderer;
  readonly input: InputSource;
  readonly mesher: ChunkMesher;
  readonly repository: WorldRepository;
  /** True when the repository survives a reload; shown in the debug overlay. */
  readonly durablePersistence: boolean;
  readonly seed?: number;
  readonly gameMode?: GameMode;
  /** Authoritative immutable settings for a newly created or loaded world. */
  readonly worldCreation?: WorldCreationSettings;
  /** Optional strategy injection for headless tests or alternate composition roots. */
  readonly generator?: ChunkGenerator;
  readonly streaming?: Partial<StreamingSettings>;
  readonly spawning?: Partial<SpawnSettings>;
  readonly onError?: (error: unknown, context: string) => void;
  /** Frame source. Defaults to `requestAnimationFrame`; injectable for tests. */
  readonly clock?: LoopClock;
  /** Injectable randomness so creature behaviour can be made deterministic. */
  readonly random?: () => number;
  /** Disables automatic render-distance adjustment. */
  readonly adaptiveQuality?: boolean;
  /** Starting point of the day/night cycle, in [0, 1). */
  readonly startTime?: number;
  /** Optional realtime room. Omit for the zero-dependency single-player path. */
  readonly multiplayer?: MultiplayerSession;
}

/**
 * Composition root and per-frame orchestrator.
 *
 * Owns the wiring between domain rules and adapters, and is the only object
 * that knows the order of operations in a frame. Everything it touches is
 * behind a port, so the same `Game` runs against a headless renderer, a stub
 * input source, or an in-memory repository without modification.
 */
export class Game {
  readonly world = new World();
  readonly player: Player;
  readonly time: TimeOfDay;
  readonly weather: Weather;
  readonly creationSettings: WorldCreationSettings;

  private readonly generator: ChunkGenerator;
  private readonly movement = new PlayerMovement();
  private readonly streamer: ChunkStreamer;
  private readonly editor: WorldEditor;
  private readonly entities: EntityManager;
  private readonly combat: CombatService;
  private readonly mining: MiningController;
  private readonly governor: PerformanceGovernor | null;
  private readonly loop: GameLoop;

  private readonly renderer: GameRenderer;
  private readonly input: InputSource;
  private readonly mesher: ChunkMesher;
  private readonly repository: WorldRepository;
  private readonly multiplayer: MultiplayerSession | null;
  private readonly durablePersistence: boolean;
  private readonly onError: (error: unknown, context: string) => void;

  private readonly seed: number;
  private timeSinceSave = 0;
  private saveInFlight: Promise<void> | null = null;
  private target: RaycastHit | null = null;
  private targetEntityName: string | null = null;
  private started = false;
  private disposed = false;
  private worldDeleted = false;
  private frameErrors = 0;

  private _debugVisible = false;
  private lastStatus: PlayerStatus | null = null;
  private readonly debugListeners = new Set<(visible: boolean) => void>();
  private readonly slotListeners = new Set<(slot: number) => void>();
  private readonly statusListeners = new Set<(status: PlayerStatus) => void>();
  private readonly noticeListeners = new Set<(message: string) => void>();
  private readonly inventoryListeners = new Set<() => void>();
  private readonly inventoryToggleListeners = new Set<(open: boolean) => void>();
  private readonly worldStatusListeners = new Set<(status: WorldStatus) => void>();
  private readonly exitListeners = new Set<() => void>();
  private inventoryOpen = false;
  private readonly networkViews: EntityView[] = [];
  private readonly pendingNetworkEdits = new Map<string, BlockEditMessage>();

  constructor(options: GameOptions) {
    this.renderer = options.renderer;
    this.input = options.input;
    this.mesher = options.mesher;
    this.repository = options.repository;
    this.multiplayer = options.multiplayer ?? null;
    this.durablePersistence = options.durablePersistence;
    this.onError =
      options.onError ??
      ((error, context) => {
        console.error(`[craftjs] ${context}`, error);
      });

    // Legacy constructor fields remain supported for tests and embedders, but
    // production composition passes the complete immutable value.
    this.creationSettings =
      options.worldCreation ??
      defaultWorldCreationSettings(
        (options.seed ?? 0) | 0,
        parseGameMode(options.gameMode, GameMode.Survival),
      );
    this.seed = this.creationSettings.seed;
    this.generator = options.generator ?? createTerrainGenerator(this.creationSettings);
    this.time = new TimeOfDay(options.startTime ?? 0.08);
    this.weather = new Weather(this.seed);

    this.player = new Player(0.5, SEA_LEVEL + 8, 0.5);
    this.player.gameMode = this.creationSettings.gameMode;
    if (this.player.gameMode === GameMode.Creative) {
      this.player.inventory = Inventory.creativeLoadout();
    }

    this.streamer = new ChunkStreamer({
      world: this.world,
      generator: this.generator,
      mesher: this.mesher,
      renderer: this.renderer,
      repository: this.repository,
      settings: options.streaming,
      onError: this.onError,
    });

    this.editor = new WorldEditor(this.world, this.streamer);
    this.entities = new EntityManager({
      world: this.world,
      spawnSettings: options.spawning,
      random: options.random,
    });
    this.combat = new CombatService(this.entities);
    this.mining = new MiningController(this.editor);

    this.governor =
      options.adaptiveQuality === false
        ? null
        : new PerformanceGovernor(this.streamer.renderDistance);

    const handlers: GameLoopHandlers = {
      update: (step) => this.guardedFrame('update', () => this.update(step)),
      render: (alpha, frameTime) =>
        this.guardedFrame('render', () => this.renderFrame(alpha, frameTime)),
    };
    this.loop = new GameLoop(handlers, options.clock ?? browserClock);

    this.renderer.setRenderDistance(this.streamer.renderDistance);
    this.renderer.setRainSurfaceSampler?.((x, z) => this.world.surfaceHeightAt(x, z));
    this.applySky();

    this.multiplayer?.onBlockEdit((edit) => {
      const result = this.editor.applyBlockEdit(edit.x, edit.y, edit.z, edit.block);
      if (!result.ok && result.reason === EditRejection.NotLoaded) {
        this.pendingNetworkEdits.set(`${edit.x},${edit.y},${edit.z}`, edit);
      }
    });
    this.multiplayer?.onStatus((message) => this.notify(message));
  }

  get isRunning(): boolean {
    return this.loop.isRunning;
  }

  get debugVisible(): boolean {
    return this._debugVisible;
  }

  get selectedBlock(): BlockId {
    const definition = this.selectedItem;
    return definition?.block ?? HOTBAR_BLOCKS[0];
  }

  get selectedItem(): ItemDefinition | null {
    return itemDefinition(this.player.inventory.hotbar[this.player.selectedSlot] ?? null);
  }

  get entityCount(): number {
    return this.entities.count;
  }

  /** Re-acquires pointer lock so the player can resume playing. */
  requestPointerLock(): void {
    this.input.requestCapture();
  }

  /** Triggers the exit flow: saves, disposes, and returns to the title screen. */
  exitToTitle(): void {
    for (const listener of this.exitListeners) listener();
  }

  onDebugToggle(listener: (visible: boolean) => void): () => void {
    this.debugListeners.add(listener);
    return () => this.debugListeners.delete(listener);
  }

  onSlotChange(listener: (slot: number) => void): () => void {
    this.slotListeners.add(listener);
    return () => this.slotListeners.delete(listener);
  }

  /** Health, mode and death transitions, for the HUD. */
  onStatusChange(listener: (status: PlayerStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Transient messages worth surfacing to the player. */
  onNotice(listener: (message: string) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  onInventoryChange(listener: () => void): () => void {
    this.inventoryListeners.add(listener);
    return () => this.inventoryListeners.delete(listener);
  }

  onInventoryToggle(listener: (open: boolean) => void): () => void {
    this.inventoryToggleListeners.add(listener);
    return () => this.inventoryToggleListeners.delete(listener);
  }

  onWorldStatusChange(listener: (status: WorldStatus) => void): () => void {
    this.worldStatusListeners.add(listener);
    return () => this.worldStatusListeners.delete(listener);
  }

  /** Requests a presentation-owned return to the title after cleanup. */
  onExitRequest(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /**
   * Leaves a dead Hardcore world. Deletion is explicit and scoped to this
   * repository; returning without deletion preserves the death state.
   */
  async exitHardcoreWorld(deleteWorld: boolean): Promise<boolean> {
    if (this.player.gameMode !== GameMode.Hardcore || !this.player.isDead) return false;
    this.loop.stop();

    if (deleteWorld) {
      if (this.saveInFlight !== null) await this.saveInFlight;
      this.worldDeleted = true;
      try {
        await this.repository.clear();
      } catch (error) {
        this.worldDeleted = false;
        this.onError(error, 'delete world');
        this.notify('World deletion failed — your save was not silently discarded');
        return false;
      }
      await this.streamer.dispose(false);
    } else {
      await this.save();
    }

    for (const listener of this.exitListeners) listener();
    return true;
  }

  worldStatus(): WorldStatus {
    return { time: this.time.clock, isNight: this.time.isNight, weather: this.weather.kind };
  }

  inventoryView(): InventoryView {
    const creative = this.player.gameMode === GameMode.Creative;
    const toView = (id: ItemId): ItemView | null => {
      const definition = itemDefinition(id);
      if (definition === null) return null;
      return {
        id,
        name: definition.name,
        kind: definition.kind,
        count: creative ? Infinity : this.player.inventory.count(id),
      };
    };

    return {
      creative,
      selectedSlot: this.player.selectedSlot,
      hotbar: this.player.inventory.hotbar.map((item) => (item === null ? null : toView(item))),
      items: this.player.inventory.entries().flatMap(({ item }) => {
        const view = toView(item);
        return view === null ? [] : [view];
      }),
      recipes: RECIPES.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        available: creative || canCraft(this.player.inventory, recipe),
        detail: recipe.inputs
          .map((input) => `${input.count} ${itemDefinition(input.item)?.name ?? input.item}`)
          .join(' + '),
      })),
    };
  }

  assignHotbar(item: ItemId): boolean {
    const definition = itemDefinition(item);
    if (definition === null) return false;
    if (
      this.player.gameMode !== GameMode.Creative &&
      !this.player.inventory.has(definition.id)
    ) {
      return false;
    }
    if (!this.player.inventory.assignHotbar(this.player.selectedSlot, definition.id)) return false;
    this.emitInventory();
    return true;
  }

  craftRecipe(recipeId: string): boolean {
    const recipe = RECIPES.find((entry) => entry.id === recipeId);
    if (recipe === undefined) return false;
    const crafted =
      this.player.gameMode === GameMode.Creative
        ? this.assignHotbar(recipe.output.item)
        : craft(this.player.inventory, recipe);
    if (crafted) {
      this.emitInventory();
      this.notify(`Crafted ${recipe.name}`);
    }
    return crafted;
  }

  /**
   * Restores saved state, guarantees the spawn area exists, then starts the
   * loop. Spawn chunks are loaded before the first frame so the player can
   * never appear inside unloaded space or fall through pending terrain.
   */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;

    const snapshot = await this.loadPlayerSnapshot();
    const spawnCoord =
      snapshot === null
        ? ChunkCoord.of(0, 0)
        : ChunkCoord.fromWorld(Math.floor(snapshot.x), Math.floor(snapshot.z));

    await this.streamer.preload(spawnCoord, SPAWN_PRELOAD_RADIUS);
    if (this.disposed) return;

    if (snapshot === null) {
      this.placeAtSurface(0.5, 0.5);
      this.player.setSpawnPoint(this.player.x, this.player.y, this.player.z);
    } else {
      this.restore(snapshot);
      this.removeClaimedStarterChest();
    }

    // Creation metadata is durable before the first playable frame, rather
    // than depending on the first autosave or a clean page close.
    await this.save();
    if (this.disposed) return;

    this.emitStatus();
    this.emitInventory();
    this.emitWorldStatus();

    // Prime streaming so the first rendered frame already has geometry queued.
    this.streamer.update(this.player.x, this.player.z);
    this.multiplayer?.connect();
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  /** Resumes after a pause without simulating the elapsed gap. */
  resume(): void {
    if (this.disposed) return;
    this.loop.resetTiming();
    if (!this.loop.isRunning) this.loop.start();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.loop.stop();
    await this.save();
    await this.streamer.dispose();
    this.entities.removeAll();

    this.debugListeners.clear();
    this.slotListeners.clear();
    this.statusListeners.clear();
    this.noticeListeners.clear();
    this.inventoryListeners.clear();
    this.inventoryToggleListeners.clear();
    this.worldStatusListeners.clear();
    this.exitListeners.clear();

    this.input.dispose();
    this.mesher.dispose();
    this.renderer.dispose();
    this.repository.dispose();
    this.multiplayer?.dispose();
  }

  /** Explicit manual-save-and-exit semantic used by world management clients. */
  async saveAndExit(): Promise<void> {
    if (this.disposed) return;
    this.loop.stop();
    await this.dispose();
  }

  /** Writes player state and every chunk holding unsaved edits. */
  async save(): Promise<void> {
    if (this.worldDeleted) return;
    if (this.saveInFlight !== null) {
      await this.saveInFlight;
      return;
    }

    const operation = Promise.allSettled([
      this.repository.saveMetadata({
        seed: this.seed,
        version: SAVE_VERSION,
        updatedAt: Date.now(),
        timeOfDay: this.time.fraction,
        weather: this.weather.snapshot(),
        creation: this.creationSettings,
      }),
      this.repository.savePlayer(this.player.toSnapshot()),
      this.streamer.flush(),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') this.onError(result.reason, 'save world');
      }
    });
    this.saveInFlight = operation;
    try {
      await operation;
    } catch (error) {
      this.onError(error, 'save world');
    } finally {
      if (this.saveInFlight === operation) this.saveInFlight = null;
      this.timeSinceSave = 0;
    }
  }

  /** Brings the player back at their spawn point. No-op while alive. */
  respawn(): void {
    if (!this.player.isDead || !this.player.rules.canRespawn) return;
    this.entities.removeAll();
    this.mining.reset();
    if (!this.player.respawn()) return;

    // Standing where the player died is not a guarantee the spawn point is
    // still clear — they may have built over it.
    if (isPositionObstructed(this.world, this.player, PLAYER_SIZE)) {
      this.placeAtSurface(this.player.x, this.player.z);
    }

    this.emitStatus();
    this.loop.resetTiming();
  }

  setGameMode(mode: GameMode): void {
    if (mode === this.player.gameMode) return;
    if (!this.player.setGameMode(mode)) {
      this.notify(
        this.player.gameMode === GameMode.Hardcore
          ? 'Hardcore mode cannot be changed'
          : 'Hardcore can only be selected when creating a world',
      );
      return;
    }
    this.mining.reset();
    if (!this.player.rules.attractsHostiles) this.entities.removeAll();
    this.emitStatus();
    this.emitInventory();
    this.notify(`${mode === GameMode.Creative ? 'Creative' : 'Survival'} mode`);
  }

  debugInfo(): GameDebugInfo {
    const streaming = this.streamer.stats();
    const stats = this.renderer.getStats();
    const population = this.entities.stats();

    return {
      fps: this.loop.fps,
      frameTimeMs: this.loop.frameTimeMs,
      position: { x: this.player.x, y: this.player.y, z: this.player.z },
      chunk: {
        x: Math.floor(this.player.x / CHUNK_SIZE),
        z: Math.floor(this.player.z / CHUNK_SIZE),
      },
      mode: this.player.mode,
      gameMode: this.player.gameMode,
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      onGround: this.player.onGround,
      inLiquid: this.player.inLiquid,
      seed: this.seed,
      time: this.time.clock,
      isNight: this.time.isNight,
      loadedChunks: streaming.loaded,
      renderDistance: this.streamer.renderDistance,
      pendingGeneration: streaming.pendingGeneration,
      meshesInFlight: streaming.meshesInFlight,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      entities: population.total,
      hostiles: population.hostile,
      itemDrops: population.drops,
      targetBlock: this.target === null ? null : BlockRegistry.get(this.target.block).name,
      targetEntity: this.targetEntityName,
      persistence: this.durablePersistence ? 'durable' : 'memory',
    };
  }

  // ------------------------------------------------------------------ frame

  /**
   * Runs one phase of the frame, tolerating failures.
   *
   * The loop reschedules itself before invoking handlers, so an exception here
   * cannot stop it — but it would repeat every frame forever. Counting
   * consecutive failures turns an unrecoverable fault into a clean stop with a
   * message instead of an endless error storm.
   */
  private guardedFrame(phase: string, body: () => void): void {
    if (this.disposed) return;
    try {
      body();
      this.frameErrors = 0;
    } catch (error) {
      this.frameErrors++;
      this.onError(error, `frame ${phase}`);
      if (this.frameErrors >= MAX_CONSECUTIVE_FRAME_ERRORS) {
        this.loop.stop();
        this.notify('Craftjs stopped after repeated errors — reload to continue');
      }
    }
  }

  /**
   * Fixed-rate simulation step.
   *
   * Input is consumed here rather than in the render step: the consume methods
   * drain their state, so extra simulation ticks in one frame cannot re-apply
   * the same mouse movement or double-place a block.
   */
  private update(step: number): void {
    const look = this.input.consumeLookDelta();
    if (look.yaw !== 0 || look.pitch !== 0) this.player.rotate(look.yaw, look.pitch);

    for (const action of this.input.consumeActions()) this.applyAction(action);

    const slot = this.input.consumeSlotSelection();
    if (slot !== null && slot !== this.player.selectedSlot) {
      this.player.selectedSlot = slot;
      for (const listener of this.slotListeners) listener(slot);
      this.emitInventory();
    }

    this.time.advance(step);
    if (this.weather.advance(step)) {
      this.emitWorldStatus();
      this.notify(
        this.weather.kind === 'clear' ? 'The weather cleared' : `Weather: ${this.weather.kind}`,
      );
    }
    this.player.tickTimers(step);

    if (this.player.isDead) {
      // Frozen on death: no movement, no mining, no creature interaction.
      this.mining.reset();
      this.renderer.setBreakProgress(0);
      if (this.entities.ridden !== null) this.entities.dismount();
      return;
    }

    const intent = this.input.getIntent();
    const mount = this.entities.ridden;

    // A rider's own locomotion is suspended: the vehicle moves, and the player
    // is carried. Running both would have the two fight over the same position.
    if (mount === null) {
      const outcome = this.movement.step(this.player, this.world, intent, step);
      if (outcome.landedFallDistance > 0) {
        if (this.combat.applyFallDamage(this.player, outcome.landedFallDistance)) {
          this.handleDeath('fell from a high place');
        }
        this.emitStatus();
      }
    }

    const creatures = this.entities.update(
      this.player,
      this.time,
      step,
      mount === null ? null : { intent, yaw: this.player.yaw },
    );
    if (mount !== null) this.followMount();
    if (creatures.playerHits.length > 0) {
      if (this.combat.applyHits(this.player, creatures.playerHits)) {
        this.handleDeath(`slain by a ${creatures.playerHits[0].attacker}`);
      }
      this.emitStatus();
    }
    if (creatures.pickups.length > 0) {
      const collected: string[] = [];
      for (const pickup of creatures.pickups) {
        if (!this.player.inventory.add(pickup.item, pickup.count)) continue;
        const name = itemDefinition(pickup.item)?.name ?? 'item';
        collected.push(`${pickup.count} ${name}`);
      }
      if (collected.length > 0) {
        this.emitInventory();
        this.notify(`Collected ${collected.join(', ')}`);
      }
    }

    this.updateTargeting();
    this.updateMining(step);

    this.timeSinceSave += step;
    if (this.timeSinceSave >= AUTOSAVE_INTERVAL_SECONDS) {
      this.timeSinceSave = 0;
      void this.save();
    }
  }

  /**
   * Sets a minecart down on the rail the player is aiming at.
   *
   * Carts only exist on track, so this refuses anywhere else rather than
   * dropping one on the ground where it could never be driven.
   */
  private tryPlaceMinecart(): void {
    const hit = this.editor.findTarget(this.player);
    if (hit === null) return;

    // Aim at the rail itself or at the block carrying it; both are natural.
    const candidates: readonly (readonly [number, number, number])[] = [
      [hit.x, hit.y, hit.z],
      [hit.x + hit.normalX, hit.y + hit.normalY, hit.z + hit.normalZ],
    ];

    for (const [x, y, z] of candidates) {
      if (!canPlaceCart(this.world, x, y, z)) continue;

      const cart = this.entities.spawn(
        EntityTypeId.Minecart,
        Math.floor(x) + 0.5,
        y,
        Math.floor(z) + 0.5,
        this.player.yaw,
      );
      if (cart === null) {
        this.notify('Too many entities to place a minecart');
        return;
      }
      if (this.player.gameMode !== GameMode.Creative) {
        this.player.inventory.remove(MINECART_ITEM);
        this.emitInventory();
      }
      this.notify('Minecart placed — right click to ride');
      return;
    }

    this.notify('A minecart needs a rail to sit on');
  }

  /**
   * Places the rider in their mount's seat for this tick.
   *
   * `previousX/Y/Z` are advanced rather than reset, so the renderer keeps
   * interpolating and the ride is as smooth as walking. Fall distance is
   * cleared because the vehicle absorbs the landing, not the passenger.
   */
  private followMount(): void {
    const mount = this.entities.ridden;
    if (mount === null) return;

    this.player.beginTick();
    this.player.x = mount.x;
    this.player.y = mount.y + mount.definition.seatHeight;
    this.player.z = mount.z;
    this.player.velocityX = 0;
    this.player.velocityY = 0;
    this.player.velocityZ = 0;
    this.player.onGround = mount.onGround;
    this.player.fallDistance = 0;
  }

  /**
   * Seats the player on whatever they are aiming at, if it can be ridden.
   *
   * Returns true when the interaction was handled, so a click on a horse never
   * also places a block into the world behind it.
   */
  private tryMount(): boolean {
    const target = this.combat.findTarget(this.player);
    if (target === null || !target.definition.rideable) return false;

    const definition = target.definition;
    if (definition.needsSaddle && this.player.gameMode !== GameMode.Creative) {
      if (!this.player.inventory.has(SADDLE_ITEM)) {
        this.notify(`A ${definition.name.toLowerCase()} needs a saddle to ride`);
        return true;
      }
    }

    if (!this.entities.mount(target)) return false;
    this.followMount();
    this.notify(`Riding ${definition.name.toLowerCase()} — Shift to dismount`);
    return true;
  }

  /**
   * Stands the player up beside their mount.
   *
   * Offsetting sideways matters: leaving them in the seat position means the
   * next tick resolves the collision by shoving them somewhere arbitrary, often
   * into the floor.
   */
  private dismount(): void {
    const mount = this.entities.dismount();
    if (mount === null) return;

    const offset = mount.definition.width / 2 + PLAYER_SIZE.width / 2 + 0.1;
    const candidates: readonly (readonly [number, number])[] = [
      [offset, 0],
      [-offset, 0],
      [0, offset],
      [0, -offset],
      [0, 0],
    ];

    for (const [dx, dz] of candidates) {
      const x = mount.x + dx;
      const z = mount.z + dz;
      const probe = { x, y: mount.y, z };
      if (isPositionObstructed(this.world, probe, PLAYER_SIZE)) continue;
      this.player.moveTo(x, mount.y, z);
      this.notify(`Left the ${mount.definition.name.toLowerCase()}`);
      return;
    }

    // Every side is walled in; stepping up out of the seat is the last resort.
    this.player.moveTo(mount.x, mount.y + mount.definition.height, mount.z);
    this.notify(`Left the ${mount.definition.name.toLowerCase()}`);
  }

  /**
   * Resolves what the crosshair is on.
   *
   * Creatures take priority over blocks: a swing aimed at a creature standing
   * against a wall must hit the creature, not mine the wall behind it.
   */
  private updateTargeting(): void {
    const creature = this.combat.findTarget(this.player);
    this.targetEntityName = creature === null ? null : creature.definition.name;
    this.target = creature === null ? this.editor.findTarget(this.player) : null;
  }

  private updateMining(step: number): void {
    const held = this.input.getButtons().primary;
    // A swing at a creature is not a mining action.
    const mineable = this.targetEntityName === null ? this.target : null;
    const tool = this.selectedItem?.id ?? null;

    const broken = this.mining.update(this.player, mineable, held, step, tool);
    if (broken !== null) {
      if (this.player.gameMode !== GameMode.Creative) this.collectBrokenBlock(broken, tool);
      if (mineable !== null) {
        this.multiplayer?.publishBlockEdit({
          x: mineable.x,
          y: mineable.y,
          z: mineable.z,
          block: BlockId.Air,
        });
      }
      this.target = this.editor.findTarget(this.player);
    }
    this.renderer.setBreakProgress(this.mining.currentProgress);
  }

  private applyAction(action: InputAction): void {
    switch (action) {
      case InputAction.ToggleFlight:
        if (this.player.toggleMovementMode()) {
          this.notify(this.player.mode === MovementMode.Flying ? 'Flying' : 'Walking');
        } else {
          this.notify('Flight is creative only');
        }
        break;

      case InputAction.ToggleDebug:
        this._debugVisible = !this._debugVisible;
        for (const listener of this.debugListeners) listener(this._debugVisible);
        break;

      case InputAction.ToggleGameMode:
        this.setGameMode(
          this.player.gameMode === GameMode.Creative ? GameMode.Survival : GameMode.Creative,
        );
        break;

      case InputAction.ToggleInventory:
        this.inventoryOpen = !this.inventoryOpen;
        this.input.reset();
        for (const listener of this.inventoryToggleListeners) listener(this.inventoryOpen);
        break;

      case InputAction.Attack:
        this.handleAttack();
        break;

      case InputAction.Use:
        if (!this.player.isDead) this.useSelectedItem();
        break;

      case InputAction.Respawn:
        this.respawn();
        break;

      case InputAction.Dismount:
        // On foot this key is sneak, which the movement intent already reads.
        if (this.entities.ridden !== null) this.dismount();
        break;
    }
  }

  /**
   * A click either strikes a creature or begins mining.
   *
   * Instant-mining modes break on the click itself; timed mining is driven by
   * the held-button path in `updateMining`, so nothing happens here.
   */
  private handleAttack(): void {
    if (this.player.isDead) return;

    const tool = this.selectedItem?.id ?? null;
    this.renderer.swingHeldItem?.();

    const outcome = this.combat.attack(this.player, tool);
    if (outcome.hit) {
      if (outcome.killed && outcome.targetName !== null) this.notify(`Killed ${outcome.targetName}`);
      return;
    }

    if (this.player.rules.instantMining) {
      const hit = this.editor.findTarget(this.player);
      const result = this.editor.breakBlock(this.player);
      if (result.ok && hit !== null && this.player.gameMode !== GameMode.Creative) {
        this.collectBrokenBlock(hit.block as BlockId, tool);
      }
      if (result.ok) {
        this.multiplayer?.publishBlockEdit({
          x: result.x,
          y: result.y,
          z: result.z,
          block: BlockId.Air,
        });
      }
      this.target = this.editor.findTarget(this.player);
    }
  }

  /**
   * Banks the reward for a block the player just broke.
   *
   * Breaking always succeeds; the drop is what the tool gates. Telling the
   * player why they got nothing is the difference between a learnable rule and
   * a bug report — stone mined by hand is the first wall every survival player
   * hits.
   */
  private collectBrokenBlock(block: BlockId, tool: ItemId | null): void {
    if (!canHarvest(tool, block)) {
      const needed = BlockRegistry.get(block).harvestLevel;
      this.notify(
        needed >= 3
          ? `${BlockRegistry.get(block).name} needs an iron or diamond pickaxe`
          : `${BlockRegistry.get(block).name} needs a pickaxe`,
      );
      return;
    }

    const drop = blockDrop(block);
    if (drop === null) return;
    this.player.inventory.add(drop);
    this.emitInventory();
  }

  private useSelectedItem(): void {
    // Interacting with something takes precedence over building: a click aimed
    // at a horse, a bed or the starter chest is never a request to place a block.
    if (this.tryMount()) return;
    if (this.tryOpenStarterChest()) return;
    if (this.trySleep()) return;

    const item = this.selectedItem;
    if (item === null) {
      this.notify('Select an item from the inventory (E)');
      return;
    }

    if (item.id === MINECART_ITEM) {
      this.tryPlaceMinecart();
      return;
    }

    if (item.kind === 'block' && item.block !== undefined) {
      if (
        this.player.gameMode !== GameMode.Creative &&
        !this.player.inventory.has(item.id)
      ) {
        this.notify(`No ${item.name} left`);
        return;
      }
      const result = this.editor.placeBlock(this.player, item.block);
      if (result.ok && this.player.gameMode !== GameMode.Creative) {
        this.player.inventory.remove(item.id);
        this.emitInventory();
      }
      if (result.ok) {
        this.multiplayer?.publishBlockEdit({
          x: result.x,
          y: result.y,
          z: result.z,
          block: item.block,
        });
      }
      return;
    }

    if (item.kind === 'spawnEgg' && item.entity !== undefined) {
      if (this.player.gameMode !== GameMode.Creative) {
        this.notify('Spawn eggs are creative only');
        return;
      }
      const hit = this.editor.findTarget(this.player);
      if (hit === null) return;
      const x = hit.x + hit.normalX + 0.5;
      const y = hit.y + hit.normalY;
      const z = hit.z + hit.normalZ + 0.5;
      const spawned = this.entities.spawn(item.entity, x, y, z, this.player.yaw + Math.PI);
      if (spawned === null) this.notify('Mob limit reached');
      else this.notify(`Spawned ${spawned.definition.name}`);
    }
  }

  /**
   * Uses a targeted bed to sleep through to morning.
   *
   * Returns true when the bed handled the interaction — including a refusal, so
   * the click is not also treated as a block placement onto the bed.
   */
  private trySleep(): boolean {
    const hit = this.editor.findTarget(this.player);
    if (hit === null || hit.block !== BlockId.Bed) return false;

    const eye = this.player.eyePosition;
    const outcome = canSleep({
      isNight: this.time.isNight,
      isStorming: this.weather.kind === 'storm',
      distance: Math.hypot(hit.x + 0.5 - eye.x, hit.y + 0.5 - eye.y, hit.z + 0.5 - eye.z),
      reach: PLAYER_REACH,
      nearestHostileDistance: this.entities.nearestHostileDistance(
        this.player.x,
        this.player.y,
        this.player.z,
      ),
    });

    if (!outcome.ok) {
      this.notify(sleepRejectionMessage(outcome.reason));
      return true;
    }

    this.time.fraction = WAKE_FRACTION;
    this.weather.clear();
    // A bed is a checkpoint: dying after sleeping must return the player here,
    // not to wherever they first spawned hours ago.
    this.player.setSpawnPoint(this.player.x, this.player.y, this.player.z);
    // The loop has been idle for as long as the fade took; without this the
    // next frame would try to catch up on the skipped wall-clock time.
    this.loop.resetTiming();

    this.emitWorldStatus();
    this.applySky();
    this.notify('Good morning — spawn point set');
    void this.save();
    return true;
  }

  private tryOpenStarterChest(): boolean {
    if (!this.creationSettings.bonusChest || this.player.bonusChestClaimed) return false;
    const hit = this.editor.findTarget(this.player);
    if (hit === null || hit.block !== BlockId.Chest) return false;

    const expected = starterChestPosition(this.generator, this.seed);
    if (hit.x !== expected.x || hit.y !== expected.y || hit.z !== expected.z) return false;

    const result = this.editor.applyBlockEdit(hit.x, hit.y, hit.z, BlockId.Air);
    if (!result.ok) return false;

    for (const loot of starterChestLoot(this.seed)) {
      this.player.inventory.add(loot.item, loot.count);
    }
    this.player.bonusChestClaimed = true;
    this.multiplayer?.publishBlockEdit({
      x: hit.x,
      y: hit.y,
      z: hit.z,
      block: BlockId.Air,
    });
    this.emitInventory();
    this.notify('Starter chest collected');
    void this.save();
    return true;
  }

  /**
   * The player claim is the duplicate-loot guard. Reassert the matching world
   * edit on load as a recovery path if a prior tab closed between player and
   * chunk persistence completing.
   */
  private removeClaimedStarterChest(): void {
    if (!this.creationSettings.bonusChest || !this.player.bonusChestClaimed) return;
    const position = starterChestPosition(this.generator, this.seed);
    if (this.world.getBlock(position.x, position.y, position.z) !== BlockId.Chest) return;
    this.editor.applyBlockEdit(position.x, position.y, position.z, BlockId.Air);
  }

  private handleDeath(cause: string): void {
    this.mining.reset();
    this.player.velocityX = 0;
    this.player.velocityZ = 0;
    this.notify(`You died — ${cause}`);
    void this.save();
  }

  /**
   * Presentation step, once per frame regardless of how many simulation ticks
   * ran. Positions are interpolated between the last two ticks so the camera
   * is smooth even when the display refresh rate differs from the tick rate.
   */
  private renderFrame(alpha: number, frameTime: number): void {
    const x = this.player.previousX + (this.player.x - this.player.previousX) * alpha;
    const y = this.player.previousY + (this.player.y - this.player.previousY) * alpha;
    const z = this.player.previousZ + (this.player.z - this.player.previousZ) * alpha;

    // Streaming is presentation-rate work, not simulation: doing it here keeps
    // it to exactly one pass per frame under any tick backlog.
    this.streamer.update(x, z);
    this.applyPendingNetworkEdits();
    this.applyAdaptiveQuality(frameTime);

    this.renderer.setBlockHighlight(this.target);
    const localEntities = this.entities.snapshot(alpha);
    this.networkViews.length = 0;
    this.networkViews.push(...localEntities);
    for (const peer of this.multiplayer?.peers() ?? []) {
      this.networkViews.push({
        id: stablePeerId(peer.id),
        type: EntityTypeId.RemotePlayer,
        x: peer.x,
        y: peer.y,
        z: peer.z,
        yaw: peer.yaw,
        walkPhase: peer.moving ? performance.now() * 0.008 : 0,
        hurt: false,
      });
    }
    this.renderer.syncEntities(this.networkViews);
    this.renderer.syncItemDrops?.(this.entities.itemDropSnapshot(alpha));
    this.multiplayer?.publishPresence({
      name: 'Player',
      x,
      y,
      z,
      yaw: this.player.yaw,
      moving:
        Math.abs(this.player.velocityX) > 0.05 || Math.abs(this.player.velocityZ) > 0.05,
    });
    this.applySky();

    const eyeY = y + PLAYER_EYE_HEIGHT;
    this.renderer.setSubmerged(
      BlockRegistry.isLiquid(this.world.getBlock(Math.floor(x), Math.floor(eyeY), Math.floor(z))),
    );

    this.renderer.render({
      position: { x, y: eyeY, z },
      yaw: this.player.yaw,
      pitch: this.player.pitch,
    });
  }

  private applySky(): void {
    this.renderer.setSky({
      light: this.time.lightLevel,
      sunHeight: this.time.sunHeight,
      sunHorizontal: this.time.sunHorizontal,
      weatherDarkening: this.weather.skyDarkening,
      fogMultiplier: this.weather.fogMultiplier,
      precipitation:
        this.weather.kind === 'storm' ? 1 : this.weather.kind === 'rain' ? 0.62 : 0,
    });
  }

  private applyPendingNetworkEdits(): void {
    let budget = 24;
    for (const [key, edit] of this.pendingNetworkEdits) {
      if (budget-- <= 0) break;
      if (!this.world.isLoadedAt(edit.x, edit.z)) continue;
      this.editor.applyBlockEdit(edit.x, edit.y, edit.z, edit.block);
      this.pendingNetworkEdits.delete(key);
    }
  }

  private applyAdaptiveQuality(frameTime: number): void {
    if (this.governor === null) return;
    const next = this.governor.update(this.loop.fps, frameTime);
    if (next === null) return;

    this.streamer.setRenderDistance(next);
    this.renderer.setRenderDistance(next);
  }

  // ---------------------------------------------------------------- listeners

  private emitStatus(): void {
    const status: PlayerStatus = {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      gameMode: this.player.gameMode,
      dead: this.player.isDead,
    };

    // Only emit on change: the HUD would otherwise rewrite the DOM every tick.
    const previous = this.lastStatus;
    if (
      previous !== null &&
      previous.health === status.health &&
      previous.gameMode === status.gameMode &&
      previous.dead === status.dead
    ) {
      return;
    }

    this.lastStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private emitInventory(): void {
    this.syncHeldItem();
    for (const listener of this.inventoryListeners) listener();
  }

  /**
   * Mirrors the equipped item into the renderer's hand.
   *
   * Driven from the same place the HUD is, so what the player sees held and
   * what the hotbar highlights can never disagree.
   */
  private syncHeldItem(): void {
    const item = this.selectedItem;
    if (item === null) {
      this.renderer.setHeldItem?.(null);
      return;
    }

    this.renderer.setHeldItem?.({
      item: item.id,
      name: item.name,
      block: item.block ?? null,
      tool: toolProfile(item.id)?.toolClass ?? null,
      colour: item.colour ?? 0xc8c8c8,
    });
  }

  private emitWorldStatus(): void {
    const status = this.worldStatus();
    for (const listener of this.worldStatusListeners) listener(status);
  }

  private notify(message: string): void {
    for (const listener of this.noticeListeners) listener(message);
  }

  // ----------------------------------------------------------------- spawning

  private async loadPlayerSnapshot(): Promise<PlayerSnapshot | null> {
    try {
      const [snapshot, metadata] = await Promise.all([
        this.repository.loadPlayer(),
        this.repository.loadMetadata(),
      ]);

      if (metadata !== null && Number.isFinite(metadata.timeOfDay)) {
        this.time.fraction = metadata.timeOfDay as number;
      }
      if (metadata?.weather !== undefined) this.weather.restore(metadata.weather);

      if (snapshot === null) return null;
      // Reject anything that would put the player somewhere unrecoverable.
      const valid =
        Number.isFinite(snapshot.x) &&
        Number.isFinite(snapshot.y) &&
        Number.isFinite(snapshot.z) &&
        Number.isFinite(snapshot.yaw) &&
        Number.isFinite(snapshot.pitch);
      return valid ? snapshot : null;
    } catch (error) {
      this.onError(error, 'load player');
      return null;
    }
  }

  private restore(snapshot: PlayerSnapshot): void {
    const restored = Player.fromSnapshot({
      ...snapshot,
      // World creation mode is authoritative; a stale player record cannot
      // turn a Hardcore world into a respawnable one on reload.
      gameMode: this.creationSettings.gameMode,
    });
    this.player.moveTo(restored.x, restored.y, restored.z);
    this.player.yaw = restored.yaw;
    this.player.pitch = restored.pitch;
    this.player.mode = restored.mode;
    this.player.gameMode = this.creationSettings.gameMode;
    this.player.health = restored.health;
    this.player.setSpawnPoint(restored.spawnX, restored.spawnY, restored.spawnZ);
    this.player.inventory = restored.inventory;
    this.player.bonusChestClaimed = restored.bonusChestClaimed;
    this.player.selectedSlot =
      Number.isInteger(restored.selectedSlot) &&
      restored.selectedSlot >= 0 &&
      restored.selectedSlot < restored.inventory.hotbar.length
        ? restored.selectedSlot
        : 0;

    // A save written by an older build, or hand-edited, could drop the player
    // inside terrain with no way out. Lift them to the surface instead.
    if (isPositionObstructed(this.world, this.player, PLAYER_SIZE)) {
      this.placeAtSurface(this.player.x, this.player.z);
    }
  }

  private placeAtSurface(x: number, z: number): void {
    const surface = this.world.surfaceHeightAt(x, z);
    // Above sea level so a spawn over water still starts on something solid.
    const y = Math.max(surface ?? SEA_LEVEL + 2, SEA_LEVEL + 1);
    this.player.moveTo(x, y, z);
  }
}
