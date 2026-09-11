import { buildApp } from './app.js';
import { createActionExecutor } from './actions/runtime.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { WorkspaceRepository } from './workspace/repository.js';

const required = (name: string, minimum = 1): string => {
  const value = process.env[name] ?? '';
  if (value.length < minimum) throw new Error(`${name} must contain at least ${minimum} characters`);
  return value;
};

export const createRuntimeApp = async () => {
  await migrate();
  const pool = createPool();
  const app = buildApp({
    workspace: new WorkspaceRepository(pool), executor: createActionExecutor(pool),
    auth: {
      password: required('APP_PASSWORD', 12), sessionSecret: required('SESSION_SECRET', 32),
      userEmail: process.env.APP_USER_EMAIL ?? 'niels@songpush.com', secureCookies: config.nodeEnv === 'production'
    },
    healthToken: config.nodeEnv === 'production' ? required('INTERNAL_HEALTH_TOKEN', 32) : process.env.INTERNAL_HEALTH_TOKEN
  });
  app.addHook('onClose', async () => pool.end());
  return app;
};
