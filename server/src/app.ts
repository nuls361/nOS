import Fastify, { type FastifyInstance } from 'fastify';

export const buildApp = (): FastifyInstance => {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/health', async () => ({ status: 'ok' as const }));

  return app;
};
