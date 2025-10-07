import Fastify from 'fastify';
import { z } from 'zod';
import cors from '@fastify/cors';
import { randomUUID } from 'crypto';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok' }));

const users = new Map<string, string>();

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


