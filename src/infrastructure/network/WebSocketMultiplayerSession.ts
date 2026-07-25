import type {
  BlockEditMessage,
  MultiplayerSession,
  PlayerPresence,
} from '@application/ports/MultiplayerSession';

const PRESENCE_INTERVAL_MS = 100;
const MAX_RECONNECT_MS = 10_000;

type ServerMessage =
  | { readonly type: 'welcome'; readonly id: string }
  | { readonly type: 'peers'; readonly peers: readonly PlayerPresence[] }
  | { readonly type: 'edit'; readonly edit: BlockEditMessage }
  | { readonly type: 'error'; readonly message: string };

export class WebSocketMultiplayerSession implements MultiplayerSession {
  readonly room: string;
  private readonly url: string;
  private readonly name: string;
  private socket: WebSocket | null = null;
  private clientId = '';
  private latestPresence: Omit<PlayerPresence, 'id'> | null = null;
  private lastPresenceAt = 0;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private peerList: readonly PlayerPresence[] = [];
  private readonly editListeners = new Set<(edit: BlockEditMessage) => void>();
  private readonly statusListeners = new Set<(message: string) => void>();

  constructor(url: string, room: string, name: string) {
    this.url = url;
    this.room = normaliseToken(room, 'world');
    this.name = normaliseToken(name, 'Player').slice(0, 20);
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.disposed || this.socket !== null) return;
    try {
      const target = new URL(this.url, globalThis.location?.href);
      target.searchParams.set('room', this.room);
      target.searchParams.set('name', this.name);
      this.socket = new WebSocket(target);
      this.socket.addEventListener('open', this.handleOpen);
      this.socket.addEventListener('message', this.handleMessage);
      this.socket.addEventListener('close', this.handleClose);
      this.socket.addEventListener('error', this.handleError);
    } catch {
      this.emitStatus('Multiplayer address is invalid');
    }
  }

  publishPresence(presence: Omit<PlayerPresence, 'id'>): void {
    this.latestPresence = presence;
    const now = performance.now();
    if (!this.connected || now - this.lastPresenceAt < PRESENCE_INTERVAL_MS) return;
    this.lastPresenceAt = now;
    this.send({ type: 'presence', presence });
  }

  publishBlockEdit(edit: BlockEditMessage): void {
    if (this.connected) this.send({ type: 'edit', edit });
  }

  peers(): readonly PlayerPresence[] {
    return this.peerList;
  }

  onBlockEdit(listener: (edit: BlockEditMessage) => void): () => void {
    this.editListeners.add(listener);
    return () => this.editListeners.delete(listener);
  }

  onStatus(listener: (message: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) globalThis.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'leaving');
    this.peerList = [];
    this.editListeners.clear();
    this.statusListeners.clear();
  }

  private readonly handleOpen = (): void => {
    this.reconnectDelay = 1000;
    this.emitStatus(`Joined multiplayer room “${this.room}”`);
    if (this.latestPresence !== null) this.send({ type: 'presence', presence: this.latestPresence });
  };

  private readonly handleMessage = (event: MessageEvent): void => {
    if (typeof event.data !== 'string' || event.data.length > 64_000) return;
    try {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === 'welcome') this.clientId = message.id;
      else if (message.type === 'peers') {
        this.peerList = message.peers.filter((peer) => peer.id !== this.clientId);
      } else if (message.type === 'edit') {
        for (const listener of this.editListeners) listener(message.edit);
      } else if (message.type === 'error') {
        this.emitStatus(message.message);
      }
    } catch {
      /* malformed packets are ignored; a peer cannot break the game loop */
    }
  };

  private readonly handleClose = (): void => {
    this.socket = null;
    this.peerList = [];
    if (this.disposed) return;
    this.emitStatus('Multiplayer disconnected — retrying');
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(MAX_RECONNECT_MS, this.reconnectDelay * 2);
  };

  private readonly handleError = (): void => {
    // Close is the single reconnect path; browsers also fire it after error.
    this.socket?.close();
  };

  private send(message: unknown): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      this.socket?.close();
    }
  }

  private emitStatus(message: string): void {
    for (const listener of this.statusListeners) listener(message);
  }
}

function normaliseToken(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[^\w -]/g, '');
  return cleaned || fallback;
}
