import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// Die .env liegt im Monorepo-Root, pnpm-Skripte laufen aber mit cwd=server/.
// Deshalb den Pfad explizit auflösen statt auf dotenv/config (cwd-basiert) zu setzen.
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
loadEnv({ path: resolve(repoRoot, '.env') });
