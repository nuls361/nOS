import { Pool } from 'pg';

export const createPool = (connectionString = process.env.DATABASE_URL): Pool => {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  return new Pool({
    connectionString,
    // Transaction poolers do not preserve session state. pg only creates
    // prepared statements when a query supplies a name; nOS never does.
    max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.VERCEL ? 3 : 10)),
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true
  });
};
