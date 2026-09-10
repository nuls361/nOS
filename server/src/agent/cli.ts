import '../env.js';
import { createPool } from '../db/pool.js';
import { ContextRepository } from './context-repository.js';
import { createOpenRouterDraftAgent } from './draft-agent.js';

const instruction = process.argv.slice(2).join(' ').trim();
if (!instruction) throw new Error('Usage: pnpm draft -- "Kunde fragt nach Zahlung auf Rechnung"');

const pool = createPool();
try {
  const draft = await createOpenRouterDraftAgent(new ContextRepository(pool)).draft({ instruction });
  console.info(JSON.stringify(draft, null, 2));
} finally {
  await pool.end();
}
