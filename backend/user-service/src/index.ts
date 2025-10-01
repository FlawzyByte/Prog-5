import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

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


