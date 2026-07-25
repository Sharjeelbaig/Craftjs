import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const port = boundedInteger(process.env.PORT, 8080, 1, 65535);
const root = resolve(process.cwd(), 'dist');
const rooms = new Map();

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname);
  let target = resolve(root, `.${pathname}`);
  if (!target.startsWith(`${root}${sep}`) && target !== root) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(target) && statSync(target).isDirectory()) target = resolve(target, 'index.html');
  if (!existsSync(target)) target = resolve(root, 'index.html');
  if (!existsSync(target)) {
    response.writeHead(503).end('Run npm run build before npm run serve.');
    return;
  }
  response.setHeader('Content-Type', mimeFor(target));
  response.setHeader('X-Content-Type-Options', 'nosniff');
  createReadStream(target).pipe(response);
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://local');
  if (url.pathname !== '/multiplayer') {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (websocket) => {
    sockets.emit('connection', websocket, request);
  });
});

sockets.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/', 'http://local');
  const roomId = token(url.searchParams.get('room'), 'world', 40);
  const name = token(url.searchParams.get('name'), 'Player', 20);
  const id = randomUUID();
  const room = getRoom(roomId);
  const client = { id, name, socket, presence: null };
  room.clients.set(id, client);

  send(socket, { type: 'welcome', id });
  for (const edit of room.edits.values()) send(socket, { type: 'edit', edit });
  broadcastPeers(room);

  socket.on('message', (payload, binary) => {
    if (binary) return;
    try {
      const message = JSON.parse(payload.toString());
      if (message?.type === 'presence') {
        const presence = validPresence(message.presence, id, name);
        if (presence !== null) {
          client.presence = presence;
          broadcastPeers(room);
        }
      } else if (message?.type === 'edit') {
        const edit = validEdit(message.edit);
        if (edit !== null) {
          if (room.edits.size >= 10_000 && !room.edits.has(editKey(edit))) {
            send(socket, { type: 'error', message: 'Room edit limit reached' });
            return;
          }
          room.edits.set(editKey(edit), edit);
          broadcast(room, { type: 'edit', edit }, id);
        }
      }
    } catch {
      // Invalid client data is isolated to that packet.
    }
  });

  socket.on('close', () => {
    room.clients.delete(id);
    broadcastPeers(room);
    if (room.clients.size === 0) {
      // Retain edits briefly so a refresh can rejoin without losing the room.
      setTimeout(() => {
        if (room.clients.size === 0) rooms.delete(roomId);
      }, 5 * 60_000).unref();
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[craftjs] http://localhost:${port}`);
  console.log('[craftjs] multiplayer relay available at /multiplayer');
});

function getRoom(id) {
  let room = rooms.get(id);
  if (room === undefined) {
    room = { clients: new Map(), edits: new Map() };
    rooms.set(id, room);
  }
  return room;
}

function broadcastPeers(room) {
  const peers = [...room.clients.values()]
    .map((client) => client.presence)
    .filter(Boolean);
  broadcast(room, { type: 'peers', peers });
}

function broadcast(room, message, exceptId = '') {
  for (const client of room.clients.values()) {
    if (client.id !== exceptId) send(client.socket, message);
  }
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function validPresence(value, id, name) {
  if (value === null || typeof value !== 'object') return null;
  const coordinates = ['x', 'y', 'z', 'yaw'].map((key) => Number(value[key]));
  if (coordinates.some((number) => !Number.isFinite(number) || Math.abs(number) > 1_000_000)) {
    return null;
  }
  return {
    id,
    name,
    x: coordinates[0],
    y: coordinates[1],
    z: coordinates[2],
    yaw: coordinates[3],
    moving: Boolean(value.moving),
  };
}

function validEdit(value) {
  if (value === null || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  const block = Number(value.block);
  if (
    ![x, y, z, block].every(Number.isInteger) ||
    Math.abs(x) > 1_000_000 ||
    Math.abs(z) > 1_000_000 ||
    y < 0 ||
    y > 255 ||
    block < 0 ||
    block > 255
  ) {
    return null;
  }
  return { x, y, z, block };
}

function editKey(edit) {
  return `${edit.x},${edit.y},${edit.z}`;
}

function token(value, fallback, maxLength) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[^\w -]/g, '')
    .slice(0, maxLength);
  return cleaned || fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function mimeFor(path) {
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.map': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }[extname(path)] ?? 'application/octet-stream'
  );
}
