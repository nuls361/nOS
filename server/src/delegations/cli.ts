import '../env.js';
import { ContextRepository } from '../agent/context-repository.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { createDelegationGenerator } from './generator.js';
import { DelegationPipeline } from './pipeline.js';
import { DelegationRepository } from './repository.js';

await migrate();
const pool = createPool();
try {
  const pipeline = new DelegationPipeline(
    new DelegationRepository(pool),
    createDelegationGenerator(new ContextRepository(pool))
  );
  console.info(JSON.stringify(await pipeline.processAll()));
} finally {
  await pool.end();
}
