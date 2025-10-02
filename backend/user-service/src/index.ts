import Fastify from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

// In-memory user store: id -> username
const users = new Map<string, string>();

// POST /users { username }
app.post('/users', async (request, reply) => {
  const schema = z.object({ username: z.string().min(1) });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid body' });
  }
  const id = randomUUID();
  users.set(id, parsed.data.username);
  return reply.send({ id, username: parsed.data.username });
});

// GET /users/:id
app.get('/users/:id', async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const username = users.get(id);
  if (!username) {
    return reply.code(404).send({ error: 'User not found' });
  }
  return reply.send({ id, username });
});

const port = Number(process.env.PORT || 3001);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`user-service listening on ${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });


