import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { ContextRepository } from './context-repository.js';

const pool = createPool();
const repository = new ContextRepository(pool);
const threadId = randomUUID();
const inboundId = randomUUID();
const replyId = randomUUID();
const playbookSlug = `payment-terms-${randomUUID()}`;

beforeAll(async () => {
  await migrate();
  await pool.query(
    `INSERT INTO threads (id, provider, external_id, subject)
     VALUES ($1, 'test-agent', $2, 'Zahlung auf Rechnung')`, [threadId, randomUUID()]
  );
  await pool.query(
    `INSERT INTO messages
      (id, thread_id, provider, external_id, direction, sender, recipients, subject, body_text, sent_at)
     VALUES
      ($1, $3, 'test-agent', $4, 'inbound', 'customer@example.com', ARRAY['niels@songpush.com'],
       'Zahlung auf Rechnung', 'Können wir per Rechnung mit Zahlungsziel zahlen?', now() - interval '2 minutes'),
      ($2, $3, 'test-agent', $5, 'outbound', 'niels@songpush.com', ARRAY['customer@example.com'],
       'Re: Zahlung auf Rechnung', 'Ja, Zahlung auf Rechnung mit 30 Tagen Zahlungsziel ist möglich.', now() - interval '1 minute')`,
    [inboundId, replyId, threadId, randomUUID(), randomUUID()]
  );
  await pool.query(
    `INSERT INTO playbook_entries (slug, title, content) VALUES ($1, 'Zahlungsbedingungen', 'Keine Zusage ohne Prüfung.')`,
    [playbookSlug]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM threads WHERE id = $1', [threadId]);
  await pool.query('DELETE FROM playbook_entries WHERE slug = $1', [playbookSlug]);
  await pool.end();
});

describe('agent context retrieval', () => {
  it('finds and cites the invoice precedent, then reads the full thread', async () => {
    const hits = await repository.searchMail('Rechnung Zahlungsziel');
    expect(hits.some(({ sourceId }) => sourceId === `mail:${replyId}`)).toBe(true);
    const thread = await repository.readThread(threadId);
    expect(thread?.sourceId).toBe(`thread:${threadId}`);
    expect(thread?.messages).toHaveLength(2);
  });

  it('loads approved playbook context through FTS', async () => {
    const entries = await repository.readPlaybook('Zahlungsbedingungen');
    expect(entries).toContainEqual(expect.objectContaining({ sourceId: `playbook:${playbookSlug}` }));
  });
});
