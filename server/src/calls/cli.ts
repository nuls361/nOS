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
  const result = await new CallCardPipeline(repository, generator).processAll();
  console.info(JSON.stringify(result));
} finally {
  await pool.end();
}
