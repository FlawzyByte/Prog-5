import Fastify from 'fastify';
import { z } from 'zod';
import cors from '@fastify/cors';
import { request as undiciRequest } from 'undici';

type RoomState = {
  players: string[];
  turn: string | null;
  timeLimit?: number; // in minutes
};

const rooms = new Map<string, RoomState>();

async function validateUser(userServiceBaseUrl: string, userId: string): Promise<boolean> {
  try {
    const res = await undiciRequest(`${userServiceBaseUrl}/users/${userId}`);
    return res.statusCode === 200;
  } catch {
    return false;
  }
}

async function getUsername(userServiceBaseUrl: string, userId: string): Promise<string | null> {
  try {
    const res = await undiciRequest(`${userServiceBaseUrl}/users/${userId}`);
    if (res.statusCode === 200) {
      const body = await res.body.json() as any;
      return body.username || null;
    }
    return null;
  } catch {
    return null;
  }
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok' }));

app.get('/rooms', async (request, reply) => {
  // Return list of rooms with availability
  const userService = process.env.USER_SERVICE_URL || 'http://127.0.0.1:3001';
  const availableRooms = [];
  
  for (const [roomId, state] of rooms.entries()) {
    if (state.players.length < 2) {
      const playerInfo = [];
      for (const playerId of state.players) {
        const username = await getUsername(userService, playerId);
        playerInfo.push({ id: playerId, username: username || playerId });
      }
      availableRooms.push({
        roomId,
        players: playerInfo,
        playerCount: state.players.length,
        hasSpace: state.players.length < 2
      });
    }
  }
  
  return reply.send({ rooms: availableRooms });
});

app.get('/rooms/:roomId', async (request, reply) => {
  const roomId = (request.params as { roomId: string }).roomId;
  const room = rooms.get(roomId);
  if (!room) return reply.code(404).send({ error: 'Room not found' });
  
  // Fetch usernames for all players
  const userService = process.env.USER_SERVICE_URL || 'http://127.0.0.1:3001';
  const playerInfo = [];
  for (const playerId of room.players) {
    const username = await getUsername(userService, playerId);
    playerInfo.push({ id: playerId, username: username || playerId });
  }
  
  return reply.send({ 
    roomId, 
    players: playerInfo, 
    turn: room.turn,
    timeLimit: room.timeLimit || 3
  });
});

app.post('/rooms', async (request, reply) => {
  const schema = z.object({ 
    userId: z.string().min(1),
    timeLimit: z.number().min(1).max(3).optional()
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

  const userService = process.env.USER_SERVICE_URL || 'http://127.0.0.1:3001';
  const ok = await validateUser(userService, parsed.data.userId);
  if (!ok) return reply.code(404).send({ error: 'User not found' });

  const roomId = Math.random().toString(36).slice(2, 10);
  const state: RoomState = { 
    players: [parsed.data.userId], 
    turn: parsed.data.userId,
    timeLimit: parsed.data.timeLimit || 3 // default 3 minutes
  };
  rooms.set(roomId, state);
  
  // Fetch username for the player
  const username = await getUsername(userService, parsed.data.userId);
  const playerInfo = [{ id: parsed.data.userId, username: username || parsed.data.userId }];
  
  return reply.send({ 
    roomId, 
    players: playerInfo, 
    turn: state.turn,
    timeLimit: state.timeLimit 
  });
});

app.post('/rooms/:roomId/join', async (request, reply) => {
  const roomId = (request.params as { roomId: string }).roomId;
  const schema = z.object({ userId: z.string().min(1) });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

  const room = rooms.get(roomId);
  if (!room) return reply.code(404).send({ error: 'Room not found' });
  const userService = process.env.USER_SERVICE_URL || 'http://127.0.0.1:3001';
  
  if (room.players.includes(parsed.data.userId)) {
    const playerInfo = [];
    for (const playerId of room.players) {
      const username = await getUsername(userService, playerId);
      playerInfo.push({ id: playerId, username: username || playerId });
    }
    return reply.send({ 
      roomId, 
      players: playerInfo, 
      turn: room.turn,
      timeLimit: room.timeLimit || 3
    });
  }
  if (room.players.length >= 2) return reply.code(409).send({ error: 'Room full' });

  const ok = await validateUser(userService, parsed.data.userId);
  if (!ok) return reply.code(404).send({ error: 'User not found' });

  room.players.push(parsed.data.userId);
  
  const playerInfo = [];
  for (const playerId of room.players) {
    const username = await getUsername(userService, playerId);
    playerInfo.push({ id: playerId, username: username || playerId });
  }
  
  return reply.send({ 
    roomId, 
    players: playerInfo, 
    turn: room.turn,
    timeLimit: room.timeLimit || 3
  });
});

const port = Number(process.env.PORT || 3002);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`room-service listening on ${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });


