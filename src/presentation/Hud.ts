import type {
  Game,
  GameDebugInfo,
  InventoryView,
  PlayerStatus,
  WorldStatus,
} from '@application/Game';
import { GameMode } from '@domain/player/GameMode';
import { HOTBAR_SIZE } from '@domain/inventory/Inventory';
import {
  CREATIVE_BLOCK_ITEMS,
  CREATIVE_CATALOG_ITEMS,
  CREATIVE_EGG_ITEMS,
  itemDefinition,
  type ItemId,
} from '@domain/inventory/Item';
import { createInventoryItemIcon } from './InventoryItemIcons';

/** Debug overlay refresh interval — faster just makes the numbers unreadable. */
const DEBUG_REFRESH_MS = 200;

/** Each heart represents two points of health. */
const HEALTH_PER_HEART = 2;

/** PSP-sized storage page: three rows of nine slots. */
const INVENTORY_PAGE_SIZE = 27;

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
  private readonly inventoryOverlay: HTMLElement;
  private readonly inventoryBody: HTMLElement;
  private readonly worldBadge: HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly hearts: HTMLElement[] = [];
  private readonly healthBar: HTMLElement;
  private readonly modeBadge: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly damageFlash: HTMLElement;

  private debugTimer: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private worldTimer: ReturnType<typeof setInterval> | null = null;
  private lastHealth = Number.NaN;
  private paused = true;
  private inventoryVisible = false;
  private inventoryPage = 0;
  private readonly unsubscribes: (() => void)[] = [];

  constructor(root: HTMLElement, game: Game) {
    this.root = root;
    this.game = game;

    this.overlay = this.createPauseOverlay();
    this.deathOverlay = this.createDeathOverlay();
    this.debugPanel = this.createDebugPanel();
    this.hotbar = this.createHotbar();
    [this.inventoryOverlay, this.inventoryBody] = this.createInventoryOverlay();
    this.worldBadge = this.createWorldBadge();
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
      this.worldBadge,
      this.debugPanel,
      this.overlay,
      this.inventoryOverlay,
      this.deathOverlay,
      this.toast,
    );

    this.unsubscribes.push(
      game.onDebugToggle((visible) => this.setDebugVisible(visible)),
      game.onSlotChange((slot) => this.setSelectedSlot(slot)),
      game.onStatusChange((status) => this.setStatus(status)),
      game.onNotice((message) => this.showMessage(message)),
      game.onInventoryChange(() => this.renderInventory()),
      game.onInventoryToggle((open) => this.setInventoryOpen(open)),
      game.onWorldStatusChange((status) => this.setWorldStatus(status)),
    );

    this.setSelectedSlot(game.player.selectedSlot);
    this.setStatus({
      health: game.player.health,
      maxHealth: game.player.maxHealth,
      gameMode: game.player.gameMode,
      dead: game.player.isDead,
    });
    this.renderInventory();
    this.setWorldStatus(game.worldStatus());
    this.worldTimer = globalThis.setInterval(() => this.setWorldStatus(game.worldStatus()), 1000);
  }

  /** Shows the click-to-play overlay when input capture is lost. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    // The death screen owns the view while it is up.
    const showPause =
      paused && !this.inventoryVisible && this.deathOverlay.classList.contains('is-hidden');
    this.overlay.classList.toggle('is-hidden', !showPause);
  }

  setInventoryOpen(open: boolean): void {
    this.inventoryVisible = open;
    this.inventoryOverlay.classList.toggle('is-hidden', !open);
    this.overlay.classList.toggle('is-hidden', open || !this.paused);
    if (open) this.renderInventory();
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
    const survival = status.gameMode !== GameMode.Creative;
    const hardcore = status.gameMode === GameMode.Hardcore;

    this.healthBar.classList.toggle('is-hidden', !survival);
    this.modeBadge.textContent = hardcore ? 'Hardcore' : survival ? 'Survival' : 'Creative';
    this.modeBadge.classList.toggle('is-creative', !survival);

    if (survival) this.renderHearts(status.health, status.maxHealth);

    // Flash red only on a real loss, not on the initial render or on healing.
    if (survival && Number.isFinite(this.lastHealth) && status.health < this.lastHealth) {
      this.flashDamage();
    }
    this.lastHealth = survival ? status.health : Number.NaN;

    this.deathOverlay.classList.toggle('is-hidden', !status.dead);
    const hint = this.deathOverlay.querySelector<HTMLElement>('.overlay__hint');
    const actions = this.deathOverlay.querySelector<HTMLElement>('.overlay__actions');
    if (hint !== null) {
      hint.textContent = hardcore
        ? 'This Hardcore world cannot respawn. Your save is preserved.'
        : 'Press R to respawn';
    }
    actions?.classList.toggle('is-hidden', !hardcore);
    if (status.dead) {
      this.overlay.classList.add('is-hidden');
      if (document.pointerLockElement !== null) void document.exitPointerLock();
    }
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
    if (this.worldTimer !== null) globalThis.clearInterval(this.worldTimer);
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

    for (let index = 0; index < HOTBAR_SIZE; index++) {
      const slot = document.createElement('div');
      slot.className = 'hotbar__slot';

      const key = document.createElement('span');
      key.className = 'hotbar__key';
      key.textContent = String(index + 1);

      const label = document.createElement('span');
      label.className = 'hotbar__label';
      label.textContent = 'Empty';

      const icon = document.createElement('span');
      icon.className = 'hotbar__icon';
      icon.setAttribute('aria-hidden', 'true');

      const count = document.createElement('span');
      count.className = 'hotbar__count';

      slot.append(key, icon, label, count);
      this.slots.push(slot);
      bar.append(slot);
    }

    return bar;
  }

  private renderHotbar(view: InventoryView): void {
    this.slots.forEach((slot, index) => {
      const item = view.hotbar[index];
      const label = slot.querySelector<HTMLElement>('.hotbar__label');
      const icon = slot.querySelector<HTMLElement>('.hotbar__icon');
      const count = slot.querySelector<HTMLElement>('.hotbar__count');
      slot.title = item?.name ?? 'Empty';
      if (label !== null) label.textContent = item?.name ?? 'Empty';
      icon?.replaceChildren(...(item === null ? [] : [createInventoryItemIcon(item.id)]));
      if (count !== null) {
        count.textContent =
          item === null || view.creative || item.count <= 0 ? '' : String(item.count);
      }
      slot.classList.toggle('is-empty', item === null);
    });
    this.setSelectedSlot(view.selectedSlot);
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

  private createInventoryOverlay(): [HTMLElement, HTMLElement] {
    const overlay = document.createElement('div');
    overlay.className = 'inventory-overlay is-hidden';

    const panel = document.createElement('section');
    panel.className = 'inventory-panel';
    panel.setAttribute('aria-label', 'Inventory and crafting');

    const header = document.createElement('header');
    header.className = 'inventory-panel__header';
    const title = document.createElement('h2');
    title.textContent = 'Inventory';
    const hint = document.createElement('span');
    hint.textContent = 'E to close · click an item to equip it';
    header.append(title, hint);

    const body = document.createElement('div');
    body.className = 'inventory-panel__body';
    panel.append(header, body);
    overlay.append(panel);
    return [overlay, body];
  }

  private renderInventory(): void {
    const view = this.game.inventoryView();
    this.renderHotbar(view);
    this.inventoryBody.replaceChildren();

    const itemHeading = document.createElement('h3');
    itemHeading.textContent = view.creative ? 'Creative catalogue' : 'Collected items';
    const inventoryItems = view.creative
      ? [...CREATIVE_BLOCK_ITEMS, ...CREATIVE_CATALOG_ITEMS, ...CREATIVE_EGG_ITEMS].map((id) => {
          const definition = itemDefinition(id);
          return { id, count: definition?.maxStack ?? 64 };
        })
      : [...view.items];
    const pageCount = Math.max(1, Math.ceil(inventoryItems.length / INVENTORY_PAGE_SIZE));
    this.inventoryPage = Math.min(this.inventoryPage, pageCount - 1);

    const sectionHead = document.createElement('div');
    sectionHead.className = 'inventory-section-head';
    const pager = document.createElement('div');
    pager.className = 'inventory-pager';
    const previous = this.createPagerButton('‹', 'Previous inventory page', -1);
    const page = document.createElement('span');
    page.textContent = `${this.inventoryPage + 1} / ${pageCount}`;
    const next = this.createPagerButton('›', 'Next inventory page', 1);
    previous.disabled = this.inventoryPage === 0;
    next.disabled = this.inventoryPage === pageCount - 1;
    pager.append(previous, page, next);
    sectionHead.append(itemHeading, pager);

    const itemGrid = document.createElement('div');
    itemGrid.className = 'inventory-grid';
    const pageItems = inventoryItems.slice(
      this.inventoryPage * INVENTORY_PAGE_SIZE,
      (this.inventoryPage + 1) * INVENTORY_PAGE_SIZE,
    );
    for (let index = 0; index < INVENTORY_PAGE_SIZE; index++) {
      const item = pageItems[index];
      itemGrid.append(
        item === undefined ? this.createEmptyInventorySlot() : this.createItemButton(item.id, item.count),
      );
    }

    const hotbarHeading = document.createElement('h3');
    hotbarHeading.textContent = 'Hotbar';
    const inventoryHotbar = document.createElement('div');
    inventoryHotbar.className = 'inventory-hotbar-grid';
    for (let index = 0; index < HOTBAR_SIZE; index++) {
      const item = view.hotbar[index];
      const slot =
        item === null ? this.createEmptyInventorySlot() : this.createItemButton(item.id, item.count);
      slot.classList.toggle('is-selected', index === view.selectedSlot);
      inventoryHotbar.append(slot);
    }

    const emptyHint = document.createElement('p');
    emptyHint.className = 'inventory-empty';
    emptyHint.textContent = 'Mine blocks or defeat creatures to collect items.';
    emptyHint.classList.toggle('is-hidden', view.creative || inventoryItems.length !== 0);

    const craftingHeading = document.createElement('h3');
    craftingHeading.textContent = 'Quick crafting';
    const recipes = document.createElement('div');
    recipes.className = 'recipe-grid';
    for (const recipe of view.recipes) {
      const button = document.createElement('button');
      button.className = 'recipe';
      button.type = 'button';
      button.disabled = !recipe.available;
      const name = document.createElement('strong');
      name.textContent = recipe.name;
      const detail = document.createElement('span');
      detail.textContent = recipe.detail;
      button.append(name, detail);
      button.addEventListener('click', () => this.game.craftRecipe(recipe.id));
      recipes.append(button);
    }

    this.inventoryBody.append(
      sectionHead,
      emptyHint,
      itemGrid,
      hotbarHeading,
      inventoryHotbar,
      craftingHeading,
      recipes,
    );
  }

  private createItemButton(item: ItemId, count: number): HTMLButtonElement {
    const definition = itemDefinition(item);
    const button = document.createElement('button');
    button.className = `inventory-item inventory-item--${definition?.kind ?? 'unknown'}`;
    button.type = 'button';
    const name = definition?.name ?? 'Unknown item';
    button.title = `${name} · equip in selected hotbar slot`;
    button.setAttribute('aria-label', button.title);
    const icon = createInventoryItemIcon(item);
    icon.setAttribute('aria-hidden', 'true');
    const quantity = document.createElement('b');
    quantity.textContent = Number.isFinite(count) && count > 1 ? String(count) : '';
    button.append(icon, quantity);
    button.addEventListener('click', () => this.game.assignHotbar(item));
    return button;
  }

  private createEmptyInventorySlot(): HTMLElement {
    const slot = document.createElement('span');
    slot.className = 'inventory-item inventory-item--empty';
    slot.setAttribute('aria-hidden', 'true');
    return slot;
  }

  private createPagerButton(label: string, accessibleName: string, direction: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'inventory-pager__button';
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-label', accessibleName);
    button.addEventListener('click', () => {
      this.inventoryPage += direction;
      this.renderInventory();
    });
    return button;
  }

  private createWorldBadge(): HTMLElement {
    const badge = document.createElement('div');
    badge.className = 'world-badge';
    return badge;
  }

  private setWorldStatus(status: WorldStatus): void {
    const period = status.isNight ? 'Night' : 'Day';
    const weather = status.weather[0].toUpperCase() + status.weather.slice(1);
    this.worldBadge.textContent = `${status.time} · ${period} · ${weather}`;
  }

  private createPauseOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay__panel">
        <h1 class="overlay__title">Craft<span>js</span></h1>
        <p class="overlay__hint">Click anywhere to resume</p>
        <dl class="controls">
          <div><dt>Move</dt><dd>W A S D</dd></div>
          <div><dt>Jump / Ascend</dt><dd>Space</dd></div>
          <div><dt>Sneak / Descend</dt><dd>Shift</dd></div>
          <div><dt>Sprint</dt><dd>Ctrl</dd></div>
          <div><dt>Mine / Attack</dt><dd>Hold left click</dd></div>
          <div><dt>Place block</dt><dd>Right click</dd></div>
          <div><dt>Select block</dt><dd>1 – 9 / Scroll</dd></div>
          <div><dt>Inventory / Crafting</dt><dd>E</dd></div>
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
    const panel = document.createElement('div');
    panel.className = 'overlay__panel';
    const title = document.createElement('h1');
    title.className = 'overlay__title overlay__title--death';
    title.textContent = 'You died';
    const hint = document.createElement('p');
    hint.className = 'overlay__hint';
    hint.textContent = 'Press R to respawn';
    const actions = document.createElement('div');
    actions.className = 'overlay__actions is-hidden';

    const returnButton = document.createElement('button');
    returnButton.type = 'button';
    returnButton.textContent = 'Return to title';
    returnButton.addEventListener('click', () => {
      void this.game.exitHardcoreWorld(false);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'danger';
    deleteButton.textContent = 'Delete world';
    deleteButton.addEventListener('click', () => {
      const confirmed = globalThis.confirm(
        `Delete “${this.game.creationSettings.name}”? This permanently removes this world's saved data.`,
      );
      if (confirmed) void this.game.exitHardcoreWorld(true);
    });

    actions.append(returnButton, deleteButton);
    panel.append(title, hint, actions);
    overlay.append(panel);
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
    `Drops  ${info.itemDrops}`,
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
