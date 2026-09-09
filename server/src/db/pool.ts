import { Pool } from 'pg';

export const createPool = (connectionString = process.env.DATABASE_URL): Pool => {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  return new Pool({ connectionString });
};
