import '../env.js';
import { ContextRepository } from '../agent/context-repository.js';
import { createOpenRouterDraftAgent } from '../agent/draft-agent.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { DraftAgentEmailGenerator } from './generator.js';
import { EmailCardPipeline } from './pipeline.js';
import { EmailCardRepository } from './repository.js';

await migrate();
const pool = createPool();
try {
  const agent = createOpenRouterDraftAgent(new ContextRepository(pool));
  const result = await new EmailCardPipeline(
    new EmailCardRepository(pool),
    new DraftAgentEmailGenerator(agent)
  ).processAll();
  console.info(JSON.stringify(result));
} finally {
  await pool.end();
}
