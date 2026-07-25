import { seedFromString } from '@domain/generation/Noise';
import { GameMode } from '@domain/player/GameMode';

export interface LaunchOptions {
  readonly seed: number;
  readonly gameMode: GameMode;
  readonly multiplayer: null | {
    readonly room: string;
    readonly name: string;
    readonly serverUrl: string;
  };
}

export interface StartMenuDefaults {
  readonly seed: number;
  readonly gameMode: GameMode;
}

/** The one pre-game screen; no renderer or world resources exist until Play. */
export class StartMenu {
  static show(parent: HTMLElement, defaults: StartMenuDefaults): Promise<LaunchOptions> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'start-menu';

      const panel = document.createElement('main');
      panel.className = 'start-menu__panel';
      panel.innerHTML = `
        <p class="start-menu__eyebrow">A stable voxel sandbox</p>
        <h1>Craft<span>js</span></h1>
        <p class="start-menu__lede">Choose a world. Everything else stays optional.</p>
      `;

      const form = document.createElement('form');
      form.className = 'start-menu__form';

      const seed = field('World seed', 'text', String(defaults.seed));
      const mode = document.createElement('select');
      mode.append(new Option('Survival', GameMode.Survival), new Option('Creative', GameMode.Creative));
      mode.value = defaults.gameMode;
      const modeField = labelled('Game mode', mode);

      const multiplayer = document.createElement('input');
      multiplayer.type = 'checkbox';
      const multiplayerField = labelled('Multiplayer room', multiplayer, 'start-menu__toggle');

      const network = document.createElement('div');
      network.className = 'start-menu__network is-hidden';
      const room = field('Room name', 'text', 'friends');
      const name = field('Player name', 'text', rememberedName());
      const server = field('Relay address', 'url', defaultRelayUrl());
      network.append(room.wrapper, name.wrapper, server.wrapper);

      multiplayer.addEventListener('change', () => {
        network.classList.toggle('is-hidden', !multiplayer.checked);
      });

      const actions = document.createElement('div');
      actions.className = 'start-menu__actions';
      const play = document.createElement('button');
      play.type = 'submit';
      play.textContent = 'Play';
      const random = document.createElement('button');
      random.type = 'button';
      random.className = 'button-secondary';
      random.textContent = 'New seed';
      random.addEventListener('click', () => {
        seed.input.value = String((Math.random() * 0xffffffff) | 0);
      });
      actions.append(play, random);

      const note = document.createElement('p');
      note.className = 'start-menu__note';
      note.textContent =
        'Multiplayer syncs nearby players and block edits. It is optional; single-player needs no server.';

      form.append(seed.wrapper, modeField, multiplayerField, network, actions, note);
      panel.append(form);
      overlay.append(panel);
      parent.append(overlay);

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const seedText = seed.input.value.trim();
        const numeric = Number(seedText);
        const resolvedSeed = Number.isFinite(numeric) ? numeric | 0 : seedFromString(seedText) | 0;
        const playerName = name.input.value.trim() || 'Player';
        rememberName(playerName);
        overlay.remove();
        resolve({
          seed: resolvedSeed,
          gameMode:
            mode.value === GameMode.Creative ? GameMode.Creative : GameMode.Survival,
          multiplayer: multiplayer.checked
            ? {
                room: room.input.value.trim() || 'friends',
                name: playerName,
                serverUrl: server.input.value.trim() || defaultRelayUrl(),
              }
            : null,
        });
      });
    });
  }
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
