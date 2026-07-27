import { defineConfig, type Plugin } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

interface RelayClient {
  readonly id: string;
  readonly name: string;
  readonly socket: WebSocket;
  presence: Record<string, unknown> | null;
}

interface RelayRoom {
  readonly clients: Map<string, RelayClient>;
  readonly edits: Map<string, Record<string, unknown>>;
}

/** Adds the same tiny room relay to `vite` and `vite preview` for one-command QA. */
function multiplayerRelay(): Plugin {
  const rooms = new Map<string, RelayRoom>();
  const attach = (server: HttpServer | null): void => {
    if (server === null) return;
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://local');
      if (url.pathname !== '/multiplayer') return;
      sockets.handleUpgrade(request, socket, head, (websocket) => {
        sockets.emit('connection', websocket, request);
      });
    });

    sockets.on('connection', (socket, request) => {
      const url = new URL(request.url ?? '/', 'http://local');
      const roomId = relayToken(url.searchParams.get('room'), 'world', 40);
      const name = relayToken(url.searchParams.get('name'), 'Player', 20);
      const room = rooms.get(roomId) ?? { clients: new Map(), edits: new Map() };
      rooms.set(roomId, room);

      const client: RelayClient = { id: randomUUID(), name, socket, presence: null };
      room.clients.set(client.id, client);
      relaySend(socket, { type: 'welcome', id: client.id });
      for (const edit of room.edits.values()) relaySend(socket, { type: 'edit', edit });
      relayPeers(room);

      socket.on('message', (payload, binary) => {
        if (binary) return;
        try {
          const message = JSON.parse(payload.toString()) as Record<string, unknown>;
          if (message.type === 'presence' && isRecord(message.presence)) {
            client.presence = { ...message.presence, id: client.id, name: client.name };
            relayPeers(room);
          } else if (message.type === 'edit' && isRecord(message.edit)) {
            const edit = message.edit;
            const key = `${edit.x},${edit.y},${edit.z}`;
            if (room.edits.size < 10_000 || room.edits.has(key)) {
              room.edits.set(key, edit);
              relayBroadcast(room, { type: 'edit', edit }, client.id);
            }
          }
        } catch {
          /* isolate malformed packets */
        }
      });

      socket.on('close', () => {
        room.clients.delete(client.id);
        relayPeers(room);
        if (room.clients.size === 0) rooms.delete(roomId);
      });
    });
  };

  return {
    name: 'craftjs-multiplayer-relay',
    configureServer(server) {
      attach(server.httpServer as HttpServer | null);
    },
    configurePreviewServer(server) {
      attach(server.httpServer as HttpServer | null);
    },
  };
}

function relayPeers(room: RelayRoom): void {
  relayBroadcast(room, {
    type: 'peers',
    peers: [...room.clients.values()].flatMap((client) =>
      client.presence === null ? [] : [client.presence],
    ),
  });
}

function relayBroadcast(room: RelayRoom, message: unknown, except = ''): void {
  for (const client of room.clients.values()) {
    if (client.id !== except) relaySend(client.socket, message);
  }
}

function relaySend(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function relayToken(value: string | null, fallback: string, maxLength: number): string {
  return (value ?? '').trim().replace(/[^\w -]/g, '').slice(0, maxLength) || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export default defineConfig({
  plugins: [multiplayerRelay()],
  base: './',
  resolve: {
    alias: {
      '@domain': resolvePath('./src/domain'),
      '@application': resolvePath('./src/application'),
      '@infrastructure': resolvePath('./src/infrastructure'),
      '@presentation': resolvePath('./src/presentation'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The deliberate worst-case 65k-vertex meshing test can cross Vitest's
    // 5s default on shared/low-power CPUs even though the code is healthy. It
    // runs alongside the generation and spawning suites, which are CPU-bound
    // too, so the budget accounts for contention rather than the test alone.
    testTimeout: 20_000,
  },
});
