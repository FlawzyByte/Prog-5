import Fastify from 'fastify';
import { z } from 'zod';
import cors from '@fastify/cors';
import { request as undiciRequest } from 'undici';
import { Server as IOServer } from 'socket.io';

type Coord = string;
type Ship = { from: Coord; to: Coord };
type PlayerState = {
  shipsPlaced: boolean;
  shipCells: Set<Coord>;
  hitsTaken: Set<Coord>;
};
type RoomGameState = { players: string[]; turn: string; playerState: Map<string, PlayerState> };

const rooms = new Map<string, RoomGameState>();

function coordToTuple(coord: Coord): [number, number] {
  const m = /^([A-D])([1-4])$/.exec(coord);
  if (!m) throw new Error('Out of bounds');
  const row = m[1].charCodeAt(0) - 'A'.charCodeAt(0);
  const col = parseInt(m[2], 10) - 1;
  return [row, col];
}

function enumerateShipCells(ship: Ship): Coord[] {
  const [r1, c1] = coordToTuple(ship.from);
  const [r2, c2] = coordToTuple(ship.to);
  if (r1 !== r2 && c1 !== c2) throw new Error('Ships must be straight');
  const cells: Coord[] = [];
  if (r1 === r2) {
    const [start, end] = c1 <= c2 ? [c1, c2] : [c2, c1];
    for (let c = start; c <= end; c++) cells.push(String.fromCharCode(65 + r1) + String(c + 1));
  } else {
    const [start, end] = r1 <= r2 ? [r1, r2] : [r2, r1];
    for (let r = start; r <= end; r++) cells.push(String.fromCharCode(65 + r) + String(c1 + 1));
  }
  return cells;
}

async function fetchRoom(roomServiceBase: string, roomId: string) {
  const res = await undiciRequest(`${roomServiceBase}/rooms/${roomId}`);
  if (res.statusCode !== 200) return null;
  const body = await res.body.json();
  return body as { roomId: string; players: string[]; turn: string };
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok' }));

// TEMP: Debug endpoint to inspect server in-memory state
app.get('/debug/:roomId', async (request, reply) => {
  const roomId = (request.params as { roomId: string }).roomId;
  const state = rooms.get(roomId);
  if (!state) return reply.code(404).send({ error: 'No state for room' });
  const serialized: any = {
    players: state.players,
    turn: state.turn,
    playerState: {} as Record<string, { shipsPlaced: boolean; shipCells: string[]; hitsTaken: string[] }>,
  };
  for (const [pid, ps] of state.playerState.entries()) {
    serialized.playerState[pid] = {
      shipsPlaced: ps.shipsPlaced,
      shipCells: Array.from(ps.shipCells.values()),
      hitsTaken: Array.from(ps.hitsTaken.values()),
    };
  }
  return serialized;
});

// POST /game/:roomId/place { playerId, shipCoords: [{from,to}, {from,to}] }
app.post('/game/:roomId/place', async (request, reply) => {
  const roomId = (request.params as { roomId: string }).roomId;
  const schema = z.object({
    playerId: z.string().min(1),
    // For troubleshooting: 1 ship = 1 cell (from==to)
    shipCoords: z.array(z.object({ from: z.string(), to: z.string() })).length(1),
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

  const roomService = process.env.ROOM_SERVICE_URL || 'http://127.0.0.1:3002';
  const room = await fetchRoom(roomService, roomId);
  if (!room) return reply.code(404).send({ error: 'Room not found' });
  if (!room.players.includes(parsed.data.playerId)) return reply.code(403).send({ error: 'Not in room' });

  let state = rooms.get(roomId);
  if (!state) {
    state = {
      players: room.players,
      turn: room.turn,
      playerState: new Map(),
    };
    rooms.set(roomId, state);
  }
  // Keep players list in sync with Room Service (handles late joiners)
  state.players = room.players;
  const ps = state.playerState.get(parsed.data.playerId) || {
    shipsPlaced: false,
    shipCells: new Set<Coord>(),
    hitsTaken: new Set<Coord>(),
  };
  if (ps.shipsPlaced) return reply.code(409).send({ error: 'Already placed' });

  const cells = new Set<Coord>();
  try {
    for (const s of parsed.data.shipCoords) {
      for (const cell of enumerateShipCells(s)) {
        if (cells.has(cell)) throw new Error('Overlap');
        cells.add(cell);
      }
    }
  } catch (e) {
    return reply.code(400).send({ error: 'Invalid ship placement' });
  }
  // Prevent choosing a cell already taken by opponent (per user request)
  const opponentId = room.players.find((p) => p !== parsed.data.playerId);
  if (opponentId) {
    const oppState = state.playerState.get(opponentId);
    if (oppState && [...cells].some((c) => oppState.shipCells.has(c))) {
      return reply.code(409).send({ error: 'Cell occupied by opponent' });
    }
  }
  ps.shipCells = cells;
  ps.shipsPlaced = true;
  state.playerState.set(parsed.data.playerId, ps);
  return reply.send({ ok: true });
});

// POST /game/:roomId/fire { playerId, coord }
app.post('/game/:roomId/fire', async (request, reply) => {
  const roomId = (request.params as { roomId: string }).roomId;
  const schema = z.object({ playerId: z.string().min(1), coord: z.string() });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

  const roomService = process.env.ROOM_SERVICE_URL || 'http://127.0.0.1:3002';
  const room = await fetchRoom(roomService, roomId);
  if (!room) return reply.code(404).send({ error: 'Room not found' });
  if (!room.players.includes(parsed.data.playerId)) return reply.code(403).send({ error: 'Not in room' });

  let state = rooms.get(roomId);
  if (!state) return reply.code(409).send({ error: 'Place ships first' });
  // Sync players list to reflect latest join state
  state.players = room.players;
  if (state.turn !== parsed.data.playerId) return reply.code(403).send({ error: 'Not your turn' });

  const opponent = room.players.find((p) => p !== parsed.data.playerId)!;
  const oppState = state.playerState.get(opponent);
  if (!oppState || !oppState.shipsPlaced) return reply.code(409).send({ error: 'Opponent not ready' });

  // Determine hit/miss/sink
  const coord = parsed.data.coord.toUpperCase();
  try { coordToTuple(coord); } catch { return reply.code(400).send({ error: 'Out of bounds' }); }
  let result: 'hit' | 'miss' | 'sink' = 'miss';
  if (oppState.shipCells.has(coord)) {
    oppState.hitsTaken.add(coord);
    result = 'hit';
    if ([...oppState.shipCells].every((c) => oppState.hitsTaken.has(c))) {
      result = 'sink';
    }
  }

  const gameOver = [...oppState.shipCells].every((c) => oppState.hitsTaken.has(c));

  const nextTurn = opponent;
  state.turn = nextTurn;
  rooms.set(roomId, state);

  return reply.send({ result, gameOver, nextTurn });
});

const port = Number(process.env.PORT || 3003);
app
  .listen({ port, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`game-rules-service listening on ${port}`);
    // Socket.IO server mounted on the same HTTP server
    const io = new IOServer(app.server, { cors: { origin: '*' } });

    io.on('connection', (socket) => {
      socket.on('joinRoom', async (msg) => {
        const schema = z.object({ roomId: z.string(), playerId: z.string() });
        const p = schema.safeParse(msg);
        if (!p.success) return socket.emit('joinRoomAck', { error: 'Invalid payload' });
        const roomService = process.env.ROOM_SERVICE_URL || 'http://127.0.0.1:3002';
        const room = await fetchRoom(roomService, p.data.roomId);
        if (!room) return socket.emit('joinRoomAck', { error: 'Room not found' });
        if (!room.players.includes(p.data.playerId)) return socket.emit('joinRoomAck', { error: 'Not in room' });
        socket.join(p.data.roomId);
        // Ack to joiner
        socket.emit('joinRoomAck', { roomId: room.roomId, players: room.players, turn: room.turn });
        // Broadcast updated room state to all
        socket.to(p.data.roomId).emit('roomUpdate', { roomId: room.roomId, players: room.players, turn: room.turn });
      });

      socket.on('placeShip', async (msg) => {
        const schema = z.object({ roomId: z.string(), playerId: z.string(), from: z.string(), to: z.string() });
        const p = schema.safeParse(msg);
        if (!p.success) return socket.emit('placeShipAck', { ok: false, error: 'Invalid payload' });
        // Accept single ship via WS (client already places both over HTTP). This avoids double placement.
        const res = await undiciRequest(`http://127.0.0.1:${port}/game/${p.data.roomId}/place`, {
          method: 'POST',
          body: JSON.stringify({ playerId: p.data.playerId, shipCoords: [{ from: p.data.from, to: p.data.to }] }),
          headers: { 'content-type': 'application/json' },
        });
        if (res.statusCode !== 200) {
          const err = await res.body.text();
          return socket.emit('placeShipAck', { ok: false, error: err });
        }
        socket.emit('placeShipAck', { ok: true });
      });

      socket.on('fire', async (msg) => {
        const schema = z.object({ roomId: z.string(), playerId: z.string(), coord: z.string() });
        const p = schema.safeParse(msg);
        if (!p.success) return;
        const res = await undiciRequest(`http://127.0.0.1:${port}/game/${p.data.roomId}/fire`, {
          method: 'POST',
          body: JSON.stringify({ playerId: p.data.playerId, coord: p.data.coord }),
          headers: { 'content-type': 'application/json' }
        });
        // Update local state from memory to compute authoritative result/turn
        const state = rooms.get(p.data.roomId);
        // Ensure we reflect latest players list from Room Service for opponent calc
        const roomService = process.env.ROOM_SERVICE_URL || 'http://127.0.0.1:3002';
        const roomInfo = await fetchRoom(roomService, p.data.roomId);
        if (state && roomInfo) state.players = roomInfo.players;
        const opponent = state?.players.find((id) => id !== p.data.playerId);
        const oppState = opponent ? state?.playerState.get(opponent) : undefined;
        const coord = p.data.coord.toUpperCase();
        const isHit = Boolean(oppState && oppState.shipCells.has(coord));
        const allHit = Boolean(oppState && [...oppState.shipCells].every((c) => oppState.hitsTaken.has(c)));
        const result: 'hit' | 'miss' = isHit ? 'hit' : 'miss';
        const gameOver = allHit;
        const nextTurn = opponent;
        // Broadcast to room
        io.to(p.data.roomId).emit('fireResult', { roomId: p.data.roomId, shooterId: p.data.playerId, coord: p.data.coord, result });
        if (!gameOver && nextTurn) {
          io.to(p.data.roomId).emit('turnChange', { roomId: p.data.roomId, playerId: nextTurn });
        }
        if (gameOver) io.to(p.data.roomId).emit('gameOver', { roomId: p.data.roomId, winnerId: p.data.playerId });
      });
    });
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });


