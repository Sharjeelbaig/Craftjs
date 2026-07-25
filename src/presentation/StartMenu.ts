import { GameMode } from '@domain/player/GameMode';
import {
  GeneratorPreset,
  createWorldCreationSettings,
  parseWorldSeed,
  type WorldCreationSettings,
} from '@domain/world/WorldCreationSettings';

export interface LaunchOptions {
  readonly creationSettings: WorldCreationSettings;
  readonly multiplayer: null | {
    readonly room: string;
    readonly name: string;
    readonly serverUrl: string;
  };
}

export interface StartMenuDefaults {
  readonly seed: number;
  readonly gameMode: GameMode;
  readonly name?: string;
}

/**
 * Minecraft-inspired title and world-creation flow.
 *
 * It remains a presentation adapter: all values are validated into the
 * immutable domain settings before the overlay is removed.
 */
export class StartMenu {
  static show(parent: HTMLElement, defaults: StartMenuDefaults): Promise<LaunchOptions> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'start-menu';
      overlay.append(createPanorama());

      const titleView = document.createElement('main');
      titleView.className = 'start-menu__title-view';
      titleView.setAttribute('aria-label', 'Craftjs main menu');

      const brand = document.createElement('div');
      brand.className = 'start-menu__brand';
      brand.innerHTML = `
        <h1>CRAFT<span>JS</span></h1>
        <p>Stable by design!</p>
      `;

      const titleActions = document.createElement('div');
      titleActions.className = 'start-menu__main-actions';
      const singleplayerButton = menuButton('Singleplayer');
      const multiplayerButton = menuButton('Multiplayer');
      const optionsButton = menuButton('Options & Controls...');
      titleActions.append(singleplayerButton, multiplayerButton, optionsButton);

      const titleFooter = document.createElement('div');
      titleFooter.className = 'start-menu__title-footer';
      titleFooter.innerHTML = `
        <span>Craftjs · browser edition</span>
        <span>Minimal setup · deterministic worlds</span>
      `;
      titleView.append(brand, titleActions, titleFooter);

      const creationView = document.createElement('main');
      creationView.className = 'start-menu__creation-view is-hidden';
      const creationHeading = document.createElement('h2');
      creationHeading.textContent = 'Create New World';
      const creationSubheading = document.createElement('p');
      creationSubheading.className = 'start-menu__screen-note';
      creationSubheading.textContent = 'World settings are permanent after creation.';

      const form = document.createElement('form');
      form.className = 'start-menu__form';

      const worldName = field('World name', 'text', defaults.name ?? `World ${defaults.seed}`);
      worldName.input.maxLength = 48;
      worldName.input.required = true;
      const seed = field('World seed', 'text', String(defaults.seed));
      seed.input.maxLength = 128;
      seed.input.required = true;

      const mode = document.createElement('select');
      mode.append(
        new Option('Survival', GameMode.Survival),
        new Option('Creative', GameMode.Creative),
        new Option('Hardcore', GameMode.Hardcore),
      );
      mode.value = defaults.gameMode;
      const modeField = labelled('Game mode', mode);

      const preset = document.createElement('select');
      preset.append(
        new Option('Default', GeneratorPreset.Default),
        new Option('Flat', GeneratorPreset.Flat),
      );
      const presetField = labelled('World type', preset);

      const primaryFields = document.createElement('div');
      primaryFields.className = 'start-menu__field-grid';
      primaryFields.append(worldName.wrapper, seed.wrapper, modeField, presetField);

      const structures = document.createElement('input');
      structures.type = 'checkbox';
      structures.checked = true;
      const structuresField = labelled('Generate Structures', structures, 'start-menu__toggle');

      const bonusChest = document.createElement('input');
      bonusChest.type = 'checkbox';
      const bonusChestField = labelled('Bonus Chest', bonusChest, 'start-menu__toggle');

      const worldOptions = document.createElement('fieldset');
      worldOptions.className = 'start-menu__world-options';
      const worldOptionsLegend = document.createElement('legend');
      worldOptionsLegend.textContent = 'More World Options';
      worldOptions.append(worldOptionsLegend, structuresField, bonusChestField);

      const hardcoreWarning = document.createElement('div');
      hardcoreWarning.className = 'start-menu__warning is-hidden';
      const warningText = document.createElement('p');
      warningText.textContent =
        'Hardcore is permanent: death disables respawn. You may return to the title or explicitly delete the save.';
      const acknowledge = document.createElement('input');
      acknowledge.type = 'checkbox';
      const acknowledgeField = labelled(
        'I understand there is no respawn',
        acknowledge,
        'start-menu__toggle',
      );
      hardcoreWarning.append(warningText, acknowledgeField);
      mode.addEventListener('change', () => {
        const hardcore = mode.value === GameMode.Hardcore;
        hardcoreWarning.classList.toggle('is-hidden', !hardcore);
        if (!hardcore) acknowledge.checked = false;
      });

      const multiplayer = document.createElement('input');
      multiplayer.type = 'checkbox';

      const network = document.createElement('fieldset');
      network.className = 'start-menu__network is-hidden';
      const networkLegend = document.createElement('legend');
      networkLegend.textContent = 'Multiplayer Room';
      const room = field('Room name', 'text', 'friends');
      const playerName = field('Player name', 'text', rememberedName());
      const server = field('Relay address', 'url', defaultRelayUrl());
      network.append(networkLegend, room.wrapper, playerName.wrapper, server.wrapper);

      const error = document.createElement('p');
      error.className = 'start-menu__error is-hidden';
      error.setAttribute('role', 'alert');

      const actions = document.createElement('div');
      actions.className = 'start-menu__creation-actions';
      const play = menuButton('Create New World', 'submit');
      const random = menuButton('Random Seed');
      random.type = 'button';
      random.addEventListener('click', () => {
        seed.input.value = String((Math.random() * 0xffffffff) | 0);
      });
      const cancel = menuButton('Cancel');
      cancel.type = 'button';
      actions.append(play, random, cancel);

      form.append(
        primaryFields,
        worldOptions,
        hardcoreWarning,
        network,
        error,
        actions,
      );
      creationView.append(creationHeading, creationSubheading, form);

      const optionsView = createOptionsView();
      const optionsBack = optionsView.querySelector<HTMLButtonElement>('[data-action="back"]');

      const showTitle = (): void => {
        creationView.classList.add('is-hidden');
        optionsView.classList.add('is-hidden');
        titleView.classList.remove('is-hidden');
        error.classList.add('is-hidden');
      };

      const showCreation = (online: boolean): void => {
        multiplayer.checked = online;
        network.classList.toggle('is-hidden', !online);
        creationHeading.textContent = online ? 'Create or Join Multiplayer World' : 'Create New World';
        creationSubheading.textContent = online
          ? 'The room shares nearby players and block edits. World generation remains deterministic.'
          : 'World settings are permanent after creation.';
        play.textContent = online ? 'Join World' : 'Create New World';
        titleView.classList.add('is-hidden');
        optionsView.classList.add('is-hidden');
        creationView.classList.remove('is-hidden');
        worldName.input.focus();
      };

      singleplayerButton.addEventListener('click', () => showCreation(false));
      multiplayerButton.addEventListener('click', () => showCreation(true));
      optionsButton.addEventListener('click', () => {
        titleView.classList.add('is-hidden');
        creationView.classList.add('is-hidden');
        optionsView.classList.remove('is-hidden');
      });
      optionsBack?.addEventListener('click', showTitle);
      cancel.addEventListener('click', showTitle);

      overlay.append(titleView, creationView, optionsView);
      parent.append(overlay);

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        error.classList.add('is-hidden');
        const resolvedSeed = parseWorldSeed(seed.input.value);
        if (resolvedSeed === null) {
          showError(error, 'Enter a seed up to 128 characters (a 32-bit number or text).');
          return;
        }

        const selectedMode =
          mode.value === GameMode.Creative
            ? GameMode.Creative
            : mode.value === GameMode.Survival
              ? GameMode.Survival
              : mode.value === GameMode.Hardcore
                ? GameMode.Hardcore
                : null;
        if (selectedMode === null) {
          showError(error, 'Choose a valid game mode.');
          return;
        }

        const selectedPreset =
          preset.value === GeneratorPreset.Default
            ? GeneratorPreset.Default
            : preset.value === GeneratorPreset.Flat
              ? GeneratorPreset.Flat
              : null;
        if (selectedPreset === null) {
          showError(error, 'Choose a valid world type.');
          return;
        }
        if (selectedMode === GameMode.Hardcore && !acknowledge.checked) {
          showError(error, 'Acknowledge the Hardcore permanent-death warning to continue.');
          return;
        }

        const settings = createWorldCreationSettings({
          name: worldName.input.value,
          seed: resolvedSeed,
          gameMode: selectedMode,
          generatorPreset: selectedPreset,
          structures: structures.checked,
          bonusChest: bonusChest.checked,
        });
        if (!settings.ok) {
          showError(error, settings.error);
          return;
        }

        const resolvedPlayerName = playerName.input.value.trim() || 'Player';
        rememberName(resolvedPlayerName);
        overlay.remove();
        resolve({
          creationSettings: settings.value,
          multiplayer: multiplayer.checked
            ? {
                room: room.input.value.trim() || 'friends',
                name: resolvedPlayerName,
                serverUrl: server.input.value.trim() || defaultRelayUrl(),
              }
            : null,
        });
      });
    });
  }
}

function createPanorama(): HTMLElement {
  const panorama = document.createElement('div');
  panorama.className = 'start-menu__panorama';
  panorama.setAttribute('aria-hidden', 'true');
  panorama.innerHTML = `
    <span class="menu-sun"></span>
    <span class="menu-cloud menu-cloud--one"></span>
    <span class="menu-cloud menu-cloud--two"></span>
    <span class="menu-cloud menu-cloud--three"></span>
    <span class="menu-ridge menu-ridge--far"></span>
    <span class="menu-ridge menu-ridge--near"></span>
    <span class="menu-lake"></span>
    <span class="menu-shore"></span>
    <span class="menu-forest menu-forest--left"></span>
    <span class="menu-forest menu-forest--right"></span>
  `;
  return panorama;
}

function createOptionsView(): HTMLElement {
  const view = document.createElement('main');
  view.className = 'start-menu__options-view is-hidden';
  view.innerHTML = `
    <h2>Options & Controls</h2>
    <p class="start-menu__screen-note">The stable baseline keeps runtime options intentionally small.</p>
    <dl class="start-menu__controls">
      <div><dt>Move</dt><dd>W A S D</dd></div>
      <div><dt>Jump / Ascend</dt><dd>Space</dd></div>
      <div><dt>Sneak / Descend</dt><dd>Shift</dd></div>
      <div><dt>Sprint</dt><dd>Ctrl</dd></div>
      <div><dt>Mine / Attack</dt><dd>Left click</dd></div>
      <div><dt>Place / Use</dt><dd>Right click</dd></div>
      <div><dt>Inventory / Crafting</dt><dd>E</dd></div>
      <div><dt>Toggle flight</dt><dd>F (Creative)</dd></div>
      <div><dt>Debug</dt><dd>F3</dd></div>
      <div><dt>Pause</dt><dd>Esc</dd></div>
    </dl>
  `;
  const back = menuButton('Done');
  back.dataset.action = 'back';
  view.append(back);
  return view;
}

function menuButton(text: string, type: HTMLButtonElement['type'] = 'button'): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'start-menu__button';
  button.type = type;
  button.textContent = text;
  return button;
}

function showError(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.classList.remove('is-hidden');
}

function field(label: string, type: string, value: string): {
  wrapper: HTMLLabelElement;
  input: HTMLInputElement;
} {
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.autocomplete = 'off';
  return { wrapper: labelled(label, input), input };
}

function labelled(
  text: string,
  control: HTMLElement,
  className = '',
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = className;
  const caption = document.createElement('span');
  caption.textContent = text;
  label.append(caption, control);
  return label;
}

function defaultRelayUrl(): string {
  const protocol = globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${globalThis.location?.host ?? 'localhost:8080'}/multiplayer`;
}

const PLAYER_NAME_KEY = 'craftjs.playerName';

function rememberedName(): string {
  try {
    return globalThis.localStorage?.getItem(PLAYER_NAME_KEY) ?? 'Player';
  } catch {
    return 'Player';
  }
}

function rememberName(name: string): void {
  try {
    globalThis.localStorage?.setItem(PLAYER_NAME_KEY, name);
  } catch {
    /* optional convenience only */
  }
}
