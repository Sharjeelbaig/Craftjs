import type { Game, GameDebugInfo, PlayerStatus } from '@application/Game';
import { GameMode } from '@domain/player/GameMode';
import { BlockRegistry, HOTBAR_BLOCKS } from '@domain/world/BlockType';

/** Debug overlay refresh interval — faster just makes the numbers unreadable. */
const DEBUG_REFRESH_MS = 200;

/** Each heart represents two points of health. */
const HEALTH_PER_HEART = 2;

/**
 * Heads-up display: crosshair, hotbar, health, pause and death overlays, and
 * the debug panel.
 *
 * Plain DOM rather than canvas overlays — text stays crisp at any DPI, and the
 * HUD costs nothing per frame because it only touches the DOM when a value
 * actually changes.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly game: Game;

  private readonly overlay: HTMLElement;
  private readonly deathOverlay: HTMLElement;
  private readonly debugPanel: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly hearts: HTMLElement[] = [];
  private readonly healthBar: HTMLElement;
  private readonly modeBadge: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly damageFlash: HTMLElement;

  private debugTimer: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHealth = Number.NaN;
  private readonly unsubscribes: (() => void)[] = [];

  constructor(root: HTMLElement, game: Game) {
    this.root = root;
    this.game = game;

    this.overlay = this.createPauseOverlay();
    this.deathOverlay = this.createDeathOverlay();
    this.debugPanel = this.createDebugPanel();
    this.hotbar = this.createHotbar();
    this.healthBar = this.createHealthBar();
    this.modeBadge = this.createModeBadge();
    this.toast = this.createToast();
    this.damageFlash = this.createDamageFlash();

    root.append(
      this.damageFlash,
      this.createCrosshair(),
      this.healthBar,
      this.hotbar,
      this.modeBadge,
      this.debugPanel,
      this.overlay,
      this.deathOverlay,
      this.toast,
    );

    this.unsubscribes.push(
      game.onDebugToggle((visible) => this.setDebugVisible(visible)),
      game.onSlotChange((slot) => this.setSelectedSlot(slot)),
      game.onStatusChange((status) => this.setStatus(status)),
      game.onNotice((message) => this.showMessage(message)),
    );

    this.setSelectedSlot(game.player.selectedSlot);
    this.setStatus({
      health: game.player.health,
      maxHealth: game.player.maxHealth,
      gameMode: game.player.gameMode,
      dead: game.player.isDead,
    });
  }

  /** Shows the click-to-play overlay when input capture is lost. */
  setPaused(paused: boolean): void {
    // The death screen owns the view while it is up.
    const showPause = paused && this.deathOverlay.classList.contains('is-hidden');
    this.overlay.classList.toggle('is-hidden', !showPause);
  }

  setDebugVisible(visible: boolean): void {
    this.debugPanel.classList.toggle('is-hidden', !visible);
    if (visible) {
      this.refreshDebug();
      this.debugTimer = globalThis.setInterval(() => this.refreshDebug(), DEBUG_REFRESH_MS);
    } else if (this.debugTimer !== null) {
      globalThis.clearInterval(this.debugTimer);
      this.debugTimer = null;
    }
  }

  setSelectedSlot(slot: number): void {
    this.slots.forEach((element, index) => {
      element.classList.toggle('is-selected', index === slot);
    });
  }

  /** Mirrors health, game mode and death state. */
  setStatus(status: PlayerStatus): void {
    const survival = status.gameMode === GameMode.Survival;

    this.healthBar.classList.toggle('is-hidden', !survival);
    this.modeBadge.textContent = survival ? 'Survival' : 'Creative';
    this.modeBadge.classList.toggle('is-creative', !survival);

    if (survival) this.renderHearts(status.health, status.maxHealth);

    // Flash red only on a real loss, not on the initial render or on healing.
    if (survival && Number.isFinite(this.lastHealth) && status.health < this.lastHealth) {
      this.flashDamage();
    }
    this.lastHealth = survival ? status.health : Number.NaN;

    this.deathOverlay.classList.toggle('is-hidden', !status.dead);
    if (status.dead) this.overlay.classList.add('is-hidden');
  }

  /** Transient status message, e.g. a storage warning. */
  showMessage(text: string, durationMs = 3200): void {
    this.toast.textContent = text;
    this.toast.classList.remove('is-hidden');
    if (this.toastTimer !== null) globalThis.clearTimeout(this.toastTimer);
    this.toastTimer = globalThis.setTimeout(() => {
      this.toast.classList.add('is-hidden');
      this.toastTimer = null;
    }, durationMs);
  }

  dispose(): void {
    if (this.debugTimer !== null) globalThis.clearInterval(this.debugTimer);
    if (this.toastTimer !== null) globalThis.clearTimeout(this.toastTimer);
    if (this.flashTimer !== null) globalThis.clearTimeout(this.flashTimer);
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.root.replaceChildren();
  }

  // ------------------------------------------------------------------ elements

  private createCrosshair(): HTMLElement {
    const crosshair = document.createElement('div');
    crosshair.className = 'crosshair';
    crosshair.setAttribute('aria-hidden', 'true');
    return crosshair;
  }

  private createHotbar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'hotbar';

    HOTBAR_BLOCKS.forEach((block, index) => {
      const slot = document.createElement('div');
      slot.className = 'hotbar__slot';
      slot.title = BlockRegistry.get(block).name;

      const key = document.createElement('span');
      key.className = 'hotbar__key';
      key.textContent = String(index + 1);

      const label = document.createElement('span');
      label.className = 'hotbar__label';
      label.textContent = BlockRegistry.get(block).name;

      slot.append(key, label);
      this.slots.push(slot);
      bar.append(slot);
    });

    return bar;
  }

  private createHealthBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'health';
    bar.setAttribute('role', 'meter');
    bar.setAttribute('aria-label', 'Health');

    const hearts = this.game.player.maxHealth / HEALTH_PER_HEART;
    for (let i = 0; i < hearts; i++) {
      const heart = document.createElement('span');
      heart.className = 'heart';
      this.hearts.push(heart);
      bar.append(heart);
    }
    return bar;
  }

  private renderHearts(health: number, maxHealth: number): void {
    this.healthBar.setAttribute('aria-valuenow', String(health));
    this.healthBar.setAttribute('aria-valuemax', String(maxHealth));

    this.hearts.forEach((heart, index) => {
      const filled = health - index * HEALTH_PER_HEART;
      // Half hearts make odd damage values readable at a glance.
      const state = filled >= HEALTH_PER_HEART ? 'full' : filled > 0 ? 'half' : 'empty';
      heart.dataset.state = state;
    });
  }

  private createModeBadge(): HTMLElement {
    const badge = document.createElement('div');
    badge.className = 'mode-badge';
    return badge;
  }

  private createDamageFlash(): HTMLElement {
    const flash = document.createElement('div');
    flash.className = 'damage-flash';
    flash.setAttribute('aria-hidden', 'true');
    return flash;
  }

  private flashDamage(): void {
    this.damageFlash.classList.add('is-active');
    if (this.flashTimer !== null) globalThis.clearTimeout(this.flashTimer);
    this.flashTimer = globalThis.setTimeout(() => {
      this.damageFlash.classList.remove('is-active');
      this.flashTimer = null;
    }, 220);
  }

  private createPauseOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay__panel">
        <h1 class="overlay__title">Craft<span>js</span></h1>
        <p class="overlay__hint">Click to play</p>
        <dl class="controls">
          <div><dt>Move</dt><dd>W A S D</dd></div>
          <div><dt>Jump / Ascend</dt><dd>Space</dd></div>
          <div><dt>Sneak / Descend</dt><dd>Shift</dd></div>
          <div><dt>Sprint</dt><dd>Ctrl</dd></div>
          <div><dt>Mine / Attack</dt><dd>Hold left click</dd></div>
          <div><dt>Place block</dt><dd>Right click</dd></div>
          <div><dt>Select block</dt><dd>1 – 9 / Scroll</dd></div>
          <div><dt>Survival / Creative</dt><dd>G</dd></div>
          <div><dt>Toggle flight</dt><dd>F <span class="muted">(creative)</span></dd></div>
          <div><dt>Debug info</dt><dd>F3</dd></div>
          <div><dt>Pause</dt><dd>Esc</dd></div>
        </dl>
      </div>
    `;
    return overlay;
  }

  private createDeathOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'overlay overlay--death is-hidden';
    overlay.innerHTML = `
      <div class="overlay__panel">
        <h1 class="overlay__title overlay__title--death">You died</h1>
        <p class="overlay__hint">Press R to respawn</p>
      </div>
    `;
    return overlay;
  }

  private createDebugPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'debug is-hidden';
    return panel;
  }

  private createToast(): HTMLElement {
    const toast = document.createElement('div');
    toast.className = 'toast is-hidden';
    toast.setAttribute('role', 'status');
    return toast;
  }

  private refreshDebug(): void {
    this.debugPanel.textContent = formatDebug(this.game.debugInfo());
  }
}

function formatDebug(info: GameDebugInfo): string {
  const target = info.targetEntity ?? info.targetBlock ?? '—';
  return [
    `Craftjs — ${info.fps.toFixed(0)} fps  (${info.frameTimeMs.toFixed(1)} ms)`,
    `XYZ  ${info.position.x.toFixed(2)} / ${info.position.y.toFixed(2)} / ${info.position.z.toFixed(2)}`,
    `Chunk  ${info.chunk.x}, ${info.chunk.z}   Seed  ${info.seed}`,
    `Time  ${info.time} ${info.isNight ? '· night' : '· day'}`,
    `Mode  ${info.gameMode} / ${info.mode}${info.onGround ? ' · grounded' : ''}${info.inLiquid ? ' · in water' : ''}`,
    `Health  ${info.health} / ${info.maxHealth}`,
    `Chunks  ${info.loadedChunks} loaded · dist ${info.renderDistance} · ${info.pendingGeneration} queued · ${info.meshesInFlight} meshing`,
    `Mobs  ${info.entities} (${info.hostiles} hostile)`,
    `Draws  ${info.drawCalls}   Tris  ${formatCount(info.triangles)}`,
    `Target  ${target}`,
    `Saves  ${info.persistence}`,
  ].join('\n');
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
