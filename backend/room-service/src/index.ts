import Fastify from 'fastify';
import { z } from 'zod';
import { request as undiciRequest } from 'undici';

type RoomState = {
  players: string[];
  turn: string | null;
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

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

// POST /rooms { userId }
app.post('/rooms', async (request, reply) => {
  const schema = z.object({ userId: z.string().min(1) });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

  const userService = process.env.USER_SERVICE_URL || 'http://127.0.0.1:3001';
  const ok = await validateUser(userService, parsed.data.userId);
  if (!ok) return reply.code(404).send({ error: 'User not found' });

  const roomId = Math.random().toString(36).slice(2, 10);
  const state: RoomState = { players: [parsed.data.userId], turn: parsed.data.userId };
  rooms.set(roomId, state);
  return reply.send({ roomId, players: state.players, turn: state.turn });
});

// POST /rooms/:roomId/join { userId }
app.post('/rooms/:roomId/join', async (request, reply) => {
  const roomId = (request.params as { roomId: string }).roomId;
  const schema = z.object({ userId: z.string().min(1) });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid body' });

  const room = rooms.get(roomId);
  if (!room) return reply.code(404).send({ error: 'Room not found' });
  if (room.players.includes(parsed.data.userId)) {
    return reply.send({ roomId, players: room.players, turn: room.turn });
  }
  if (room.players.length >= 2) return reply.code(409).send({ error: 'Room full' });

  const userService = process.env.USER_SERVICE_URL || 'http://127.0.0.1:3001';
  const ok = await validateUser(userService, parsed.data.userId);
  if (!ok) return reply.code(404).send({ error: 'User not found' });

  room.players.push(parsed.data.userId);
  return reply.send({ roomId, players: room.players, turn: room.turn });
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


