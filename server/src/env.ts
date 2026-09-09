import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// Die .env liegt im Monorepo-Root, pnpm-Skripte laufen aber mit cwd=server/.
// Deshalb den Pfad explizit auflösen statt auf dotenv/config (cwd-basiert) zu setzen.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
