import '../env.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { createPlaybookGenerator } from './generator.js';
import { PlaybookMiningPipeline } from './pipeline.js';
import { PlaybookRepository } from './repository.js';

await migrate();
const pool = createPool();
try {
  const raw = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1];
  const limit = raw === undefined ? 100 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  console.info(JSON.stringify(await new PlaybookMiningPipeline(
    new PlaybookRepository(pool), createPlaybookGenerator()
  ).processAll(limit)));
} finally {
  await pool.end();
}
