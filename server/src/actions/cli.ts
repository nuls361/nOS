import '../env.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { createActionExecutor } from './runtime.js';

await migrate();
const pool = createPool();
try {
  const executor = createActionExecutor(pool);
  console.info(JSON.stringify({ processed: await executor.processAll() }));
} finally {
  await pool.end();
}
