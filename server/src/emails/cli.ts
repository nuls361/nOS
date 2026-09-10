import '../env.js';
import { ContextRepository } from '../agent/context-repository.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { createMailCardGenerator } from './mail-card.js';
import { EmailCardPipeline } from './pipeline.js';
import { EmailCardRepository } from './repository.js';

await migrate();
const pool = createPool();
try {
  // Begrenzt, damit ein Cron-Lauf im Zeitfenster der Function bleibt.
  const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1];
  const limit = limitArgument === undefined ? 50 : Number(limitArgument);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');

  const result = await new EmailCardPipeline(
    new EmailCardRepository(pool),
    createMailCardGenerator(new ContextRepository(pool))
  ).processAll(limit);
  console.info(JSON.stringify(result));
} finally {
  await pool.end();
}
