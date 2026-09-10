import '../env.js';
import { ContextRepository } from '../agent/context-repository.js';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { createCallCardGenerator } from './generator.js';
import { CallCardPipeline } from './pipeline.js';
import { CallCardRepository } from './repository.js';

await migrate();
const pool = createPool();
try {
  const repository = new CallCardRepository(pool);
  const generator = createCallCardGenerator(new ContextRepository(pool));
  // Begrenzt, damit ein Cron-Lauf im Zeitfenster der Function bleibt.
  const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1];
  const limit = limitArgument === undefined ? 20 : Number(limitArgument);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  const result = await new CallCardPipeline(repository, generator).processAll(limit);
  console.info(JSON.stringify(result));
} finally {
  await pool.end();
}
