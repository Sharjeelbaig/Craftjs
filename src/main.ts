import './presentation/styles.css';

import { Game } from '@application/Game';
import type { WorldMetadata, WorldRepository } from '@application/ports/WorldRepository';
import { settingsForWorld } from '@application/services/WorldCreationService';
import { WorldManagementService } from '@application/services/WorldManagementService';
import { GameMode, parseGameMode } from '@domain/player/GameMode';
import type { PlayerSnapshot } from '@domain/player/Player';
import { seedFromString } from '@domain/generation/Noise';
import { BrowserInput } from '@infrastructure/input/BrowserInput';
import { WorkerChunkMesher } from '@infrastructure/meshing/WorkerChunkMesher';
import { IndexedDbWorldRepository } from '@infrastructure/persistence/IndexedDbWorldRepository';
import { IndexedDbWorldCatalog } from '@infrastructure/persistence/IndexedDbWorldCatalog';
import { InMemoryWorldRepository } from '@infrastructure/persistence/InMemoryWorldRepository';
import { ThreeRenderer } from '@infrastructure/rendering/ThreeRenderer';
import { Hud } from '@presentation/Hud';
import { StartMenu } from '@presentation/StartMenu';
import { WebSocketMultiplayerSession } from '@infrastructure/network/WebSocketMultiplayerSession';

/**
 * Application entry point.
 *
 * Builds the concrete adapters, hands them to `Game`, and owns the browser
 * lifecycle (visibility, unload, fatal errors). This is the only file that
 * knows about both the DOM and the engine.
 */

const DEFAULT_RENDER_DISTANCE = 8;

interface Persistence {
  readonly repository: WorldRepository;
  readonly durable: boolean;
  readonly metadata: WorldMetadata | null;
  readonly player: PlayerSnapshot | null;
}

/**
 * Opens storage for one specific world. The seed is part of the record
 * namespace, so worlds never contaminate each other.
 */
async function createPersistence(seed: number): Promise<Persistence> {
  try {
    const repository = new IndexedDbWorldRepository(String(seed));
    // Force a real connection now so a failure surfaces here rather than
    // silently losing the first save twenty seconds into play.
    const [metadata, player] = await Promise.all([
      repository.loadMetadata(),
      repository.loadPlayer(),
    ]);
    return { repository, durable: true, metadata, player };
  } catch (error) {
    console.warn('[craftjs] persistent storage unavailable; progress will not be saved', error);
    return {
      repository: new InMemoryWorldRepository(),
      durable: false,
      metadata: null,
      player: null,
    };
  }
}

const LAST_SEED_KEY = 'craftjs.lastSeed';

/**
 * Seed comes from `?seed=`, then the last world played, then a random value.
 *
 * The last-played seed lives in `localStorage` rather than the world database:
 * the seed is needed to choose which world to open, so it cannot itself be
 * stored inside one.
 */
function resolveSeed(): number {
  const requested = new URLSearchParams(globalThis.location?.search ?? '').get('seed');
  if (requested !== null && requested.trim() !== '') {
    const numeric = Number(requested);
    return Number.isFinite(numeric) ? numeric | 0 : seedFromString(requested) | 0;
  }

  const remembered = readSetting(LAST_SEED_KEY);
  if (remembered !== null) {
    const numeric = Number(remembered);
    if (Number.isFinite(numeric)) return numeric | 0;
  }

  return (Math.random() * 0xffffffff) | 0;
}

/** Storage access throws in some privacy modes; a missing value is fine. */
function readSetting(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* nothing to do; the seed simply is not remembered */
  }
}

function renderDistanceFromQuery(): number {
  const raw = new URLSearchParams(globalThis.location?.search ?? '').get('distance');
  if (raw === null) return DEFAULT_RENDER_DISTANCE;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) return DEFAULT_RENDER_DISTANCE;
  return Math.max(2, Math.min(16, value));
}

/** `?mode=creative` preselects the mode for a newly created world. */
function gameModeFromQuery(): GameMode | undefined {
  const raw = new URLSearchParams(globalThis.location?.search ?? '').get('mode');
  if (raw === null) return undefined;
  return parseGameMode(raw.toLowerCase(), GameMode.Survival);
}

function showFatalError(message: string, detail: string): void {
  const app = document.getElementById('app');
  if (app === null) return;
  const panel = document.createElement('div');
  panel.className = 'fatal';
  const heading = document.createElement('h2');
  heading.textContent = message;
  const body = document.createElement('p');
  body.textContent = detail;
  panel.append(heading, body);
  app.replaceChildren(panel);
}

async function bootstrap(): Promise<void> {
  const app = document.getElementById('app');
  const canvas = document.getElementById('viewport');
  const hudRoot = document.getElementById('hud');

  if (!(canvas instanceof HTMLCanvasElement) || hudRoot === null || app === null) {
    showFatalError('Craftjs could not start', 'The page markup is missing required elements.');
    return;
  }

  const launch = await StartMenu.show(app, {
    seed: resolveSeed(),
    gameMode: gameModeFromQuery() ?? GameMode.Survival,
  });
  const requestedSettings = launch.creationSettings;
  const { repository, durable, metadata, player } = await createPersistence(
    requestedSettings.seed,
  );
  const worldCreation = settingsForWorld(metadata, requestedSettings, player?.gameMode);
  const seed = worldCreation.seed;
  if (durable) writeSetting(LAST_SEED_KEY, String(seed));
  let worldManagement: WorldManagementService | null = null;
  if (durable) {
    try {
      worldManagement = new WorldManagementService(
        new IndexedDbWorldCatalog(),
        (id) => new IndexedDbWorldRepository(id),
      );
      // Seed-keyed saves are registered, not rewritten. Future non-UI clients
      // can create distinct ids even when their generation seeds are equal.
      await worldManagement.registerExisting(String(seed), worldCreation);
    } catch (error) {
      worldManagement?.dispose();
      worldManagement = null;
      console.warn('[craftjs] world catalogue unavailable; direct save still works', error);
    }
  }
  const renderDistance = renderDistanceFromQuery();

  let renderer: ThreeRenderer;
  try {
    renderer = new ThreeRenderer(canvas, renderDistance);
  } catch (error) {
    repository.dispose();
    worldManagement?.dispose();
    showFatalError(
      'WebGL is unavailable',
      'Craftjs needs WebGL 2 to render. Enable hardware acceleration or try a different browser.',
    );
    console.error('[craftjs] renderer initialisation failed', error);
    return;
  }

  const input = new BrowserInput(canvas);
  const mesher = new WorkerChunkMesher();
  const multiplayer =
    launch.multiplayer === null
      ? undefined
      : new WebSocketMultiplayerSession(
          launch.multiplayer.serverUrl,
          `${seed}:${launch.multiplayer.room}`,
          launch.multiplayer.name,
        );

  const game = new Game({
    renderer,
    input,
    mesher,
    repository,
    durablePersistence: durable,
    worldCreation,
    multiplayer,
    streaming: { renderDistance },
  });

  const hud = new Hud(hudRoot, game);
  hud.setPaused(true);

  let exiting = false;
  game.onExitRequest(() => {
    if (exiting) return;
    exiting = true;
    hud.dispose();
    void game.dispose().finally(() => {
      worldManagement?.dispose();
      globalThis.location.reload();
    });
  });

  // Pointer lock is the single source of truth for "is the player playing".
  input.onCaptureChange((captured) => {
    hud.setPaused(!captured);
    if (captured) game.resume();
  });

  game.onSlotChange((slot) => input.syncSlot(slot));
  game.onInventoryToggle((open) => {
    if (open) input.releaseCapture();
    else input.requestCapture();
  });

  if (!durable) {
    hud.showMessage('Storage unavailable — this world will not be saved', 6000);
  }
  if (!mesher.usesWorkers) {
    hud.showMessage('Web Workers unavailable — meshing on the main thread', 6000);
  }

  // A backgrounded tab gets throttled to ~1 fps; stopping avoids burning
  // battery and avoids a huge accumulated delta on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.stop();
      void game.save();
    } else {
      game.resume();
    }
  });

  // Best-effort final save. `pagehide` fires on mobile Safari where
  // `beforeunload` does not.
  const finalSave = () => void game.save();
  globalThis.addEventListener('pagehide', finalSave);
  globalThis.addEventListener('beforeunload', finalSave);

  await game.start();

  // Exposed for debugging from the console; not part of any public contract.
  Reflect.set(globalThis, 'craftjs', {
    game,
    renderer,
    input,
    mesher,
    hud,
    /** Non-UI world lifecycle API: list/create/open/rename/delete. */
    worlds: worldManagement,
  });
}

bootstrap().catch((error: unknown) => {
  console.error('[craftjs] fatal error during start-up', error);
  showFatalError(
    'Craftjs could not start',
    error instanceof Error ? error.message : 'An unexpected error occurred.',
  );
});
