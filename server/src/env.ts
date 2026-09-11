import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// Die .env liegt im Monorepo-Root, pnpm-Skripte laufen aber mit cwd=server/.
// Deshalb den Pfad explizit auflösen statt auf dotenv/config (cwd-basiert) zu setzen.
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
loadEnv({ path: resolve(repoRoot, '.env') });

const fileSecrets = [
  'APP_PASSWORD', 'SESSION_SECRET', 'INTERNAL_HEALTH_TOKEN', 'OPENROUTER_API_KEY',
  'ATTIO_API_KEY', 'POSTGRES_PASSWORD'
] as const;

for (const name of fileSecrets) {
  const path = process.env[`${name}_FILE`];
  if (path) process.env[name] = readFileSync(path, 'utf8').trim();
}

if (process.env.VERCEL && process.env.DATABASE_URL_POOLED) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_POOLED;
}

// Production Compose keeps the database password in a Docker secret. Build the
// connection URL inside the process so it never needs to live in an env file.
if (!process.env.DATABASE_URL && process.env.POSTGRES_PASSWORD) {
  const user = process.env.POSTGRES_USER ?? 'nos';
  const database = process.env.POSTGRES_DB ?? 'nos';
  const host = process.env.POSTGRES_HOST ?? 'postgres';
  const port = process.env.POSTGRES_PORT ?? '5432';
  process.env.DATABASE_URL = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}`
    + `@${host}:${port}/${encodeURIComponent(database)}`;
}
