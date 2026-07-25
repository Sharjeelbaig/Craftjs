import { TerrainGenerator } from '@domain/generation/TerrainGenerator';
import { BlockRegistry, HOTBAR_BLOCKS, type BlockId } from '@domain/world/BlockType';
import { ChunkCoord } from '@domain/world/ChunkCoord';
import { World } from '@domain/world/World';
import { TimeOfDay } from '@domain/world/TimeOfDay';
import { CHUNK_SIZE, SEA_LEVEL } from '@domain/world/WorldConstants';
import {
  MovementMode,
  PLAYER_EYE_HEIGHT,
  PLAYER_SIZE,
  Player,
  type PlayerSnapshot,
} from '@domain/player/Player';
import { GameMode, parseGameMode } from '@domain/player/GameMode';
import { PlayerMovement } from '@domain/player/PlayerMovement';
import { isPositionObstructed } from '@domain/physics/CollisionResolver';
import type { RaycastHit } from '@domain/physics/VoxelRaycaster';

import { GameLoop, browserClock, type GameLoopHandlers, type LoopClock } from './GameLoop';
import { ChunkStreamer, type StreamingSettings } from './services/ChunkStreamer';
import { WorldEditor } from './services/WorldEditor';
import { EntityManager } from './services/EntityManager';
import { CombatService } from './services/CombatService';
import { MiningController } from './services/MiningController';
import { PerformanceGovernor } from './services/PerformanceGovernor';
import type { SpawnSettings } from '@domain/entity/MobSpawner';
import type { ChunkMesher } from './ports/ChunkMesher';
import type { GameRenderer } from './ports/GameRenderer';
import { InputAction, type InputSource } from './ports/InputSource';
import type { WorldRepository } from './ports/WorldRepository';

/** Save format version, bumped when stored records change shape. */
const SAVE_VERSION = 2;

const AUTOSAVE_INTERVAL_SECONDS = 20;

/** Chunks force-loaded before the first frame so spawn is never mid-air. */
const SPAWN_PRELOAD_RADIUS = 1;

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
  readonly targetBlock: string | null;
  readonly targetEntity: string | null;
  readonly persistence: 'durable' | 'memory';
}

/** State the HUD mirrors; emitted only when a value actually changes. */
export interface PlayerStatus {
  readonly health: number;
  readonly maxHealth: number;
  readonly gameMode: GameMode;
  readonly dead: boolean;
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

  private readonly generator: TerrainGenerator;
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
  private readonly durablePersistence: boolean;
  private readonly onError: (error: unknown, context: string) => void;

  private readonly seed: number;
  private timeSinceSave = 0;
  private saveInFlight = false;
  private target: RaycastHit | null = null;
  private targetEntityName: string | null = null;
  private started = false;
  private disposed = false;
  private frameErrors = 0;

  private _debugVisible = false;
  private lastStatus: PlayerStatus | null = null;
  private readonly debugListeners = new Set<(visible: boolean) => void>();
  private readonly slotListeners = new Set<(slot: number) => void>();
  private readonly statusListeners = new Set<(status: PlayerStatus) => void>();
  private readonly noticeListeners = new Set<(message: string) => void>();

  constructor(options: GameOptions) {
    this.renderer = options.renderer;
    this.input = options.input;
    this.mesher = options.mesher;
    this.repository = options.repository;
    this.durablePersistence = options.durablePersistence;
    this.onError =
      options.onError ??
      ((error, context) => {
        console.error(`[craftjs] ${context}`, error);
      });

    // Normalised to a signed 32-bit value so the seed reported, persisted and
    // fed to the generator are always the same number across reloads.
    this.seed = (options.seed ?? 0) | 0;
    this.generator = new TerrainGenerator(this.seed);
    this.time = new TimeOfDay(options.startTime ?? 0.08);

    this.player = new Player(0.5, SEA_LEVEL + 8, 0.5);
    this.player.gameMode = parseGameMode(options.gameMode, GameMode.Survival);

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
    this.renderer.setSky({ light: this.time.lightLevel, sunHeight: this.time.sunHeight });
  }

  get isRunning(): boolean {
    return this.loop.isRunning;
  }

  get debugVisible(): boolean {
    return this._debugVisible;
  }

  get selectedBlock(): BlockId {
    return HOTBAR_BLOCKS[this.player.selectedSlot] ?? HOTBAR_BLOCKS[0];
  }

  get entityCount(): number {
    return this.entities.count;
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
    }

    this.emitStatus();

    // Prime streaming so the first rendered frame already has geometry queued.
    this.streamer.update(this.player.x, this.player.z);
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

    this.input.dispose();
    this.mesher.dispose();
    this.renderer.dispose();
    this.repository.dispose();
  }

  /** Writes player state and every chunk holding unsaved edits. */
  async save(): Promise<void> {
    if (this.saveInFlight) return;
    this.saveInFlight = true;
    try {
      await Promise.allSettled([
        this.repository.saveMetadata({
          seed: this.seed,
          version: SAVE_VERSION,
          updatedAt: Date.now(),
          timeOfDay: this.time.fraction,
        }),
        this.repository.savePlayer(this.player.toSnapshot()),
        this.streamer.flush(),
      ]);
    } catch (error) {
      this.onError(error, 'save world');
    } finally {
      this.saveInFlight = false;
      this.timeSinceSave = 0;
    }
  }

  /** Brings the player back at their spawn point. No-op while alive. */
  respawn(): void {
    if (!this.player.isDead) return;
    this.entities.removeAll();
    this.mining.reset();
    this.player.respawn();

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
    this.player.setGameMode(mode);
    this.mining.reset();
    if (!this.player.rules.attractsHostiles) this.entities.removeAll();
    this.emitStatus();
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
    }

    this.time.advance(step);
    this.player.tickTimers(step);

    if (this.player.isDead) {
      // Frozen on death: no movement, no mining, no creature interaction.
      this.mining.reset();
      this.renderer.setBreakProgress(0);
      return;
    }

    const outcome = this.movement.step(this.player, this.world, this.input.getIntent(), step);
    if (outcome.landedFallDistance > 0) {
      if (this.combat.applyFallDamage(this.player, outcome.landedFallDistance)) {
        this.handleDeath('fell from a high place');
      }
      this.emitStatus();
    }

    const creatures = this.entities.update(this.player, this.time, step);
    if (creatures.playerHits.length > 0) {
      if (this.combat.applyHits(this.player, creatures.playerHits)) {
        this.handleDeath(`slain by a ${creatures.playerHits[0].attacker}`);
      }
      this.emitStatus();
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

    if (this.mining.update(this.player, mineable, held, step)) {
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

      case InputAction.Attack:
        this.handleAttack();
        break;

      case InputAction.Use:
        if (!this.player.isDead) this.editor.placeBlock(this.player, this.selectedBlock);
        break;

      case InputAction.Respawn:
        this.respawn();
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

    const outcome = this.combat.attack(this.player);
    if (outcome.hit) {
      if (outcome.killed && outcome.targetName !== null) this.notify(`Killed ${outcome.targetName}`);
      return;
    }

    if (this.player.rules.instantMining) {
      this.editor.breakBlock(this.player);
      this.target = this.editor.findTarget(this.player);
    }
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
    this.applyAdaptiveQuality(frameTime);

    this.renderer.setBlockHighlight(this.target);
    this.renderer.syncEntities(this.entities.snapshot(alpha));
    this.renderer.setSky({ light: this.time.lightLevel, sunHeight: this.time.sunHeight });

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
    const restored = Player.fromSnapshot(snapshot);
    this.player.moveTo(restored.x, restored.y, restored.z);
    this.player.yaw = restored.yaw;
    this.player.pitch = restored.pitch;
    this.player.mode = restored.mode;
    this.player.gameMode = restored.gameMode;
    this.player.health = restored.health;
    this.player.setSpawnPoint(restored.spawnX, restored.spawnY, restored.spawnZ);
    this.player.selectedSlot =
      Number.isInteger(restored.selectedSlot) &&
      restored.selectedSlot >= 0 &&
      restored.selectedSlot < HOTBAR_BLOCKS.length
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
