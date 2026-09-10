import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { PlaybookRepository } from './repository.js';
import type { MiningSource } from './types.js';

const pool = createPool();
const sourceId = randomUUID();
const slug = `payment-terms-${sourceId}`;
const trivialThreadId = randomUUID();

beforeAll(() => migrate());
afterAll(async () => {
  await pool.query('DELETE FROM playbook_entries WHERE slug = $1', [slug]);
  await pool.query("DELETE FROM playbook_mining_sources WHERE source_type = 'approved_reply' AND source_id = $1", [sourceId]);
  await pool.query("DELETE FROM threads WHERE provider = 'test' AND external_id = $1", [trivialThreadId]);
  await pool.end();
});

describe('PlaybookRepository', () => {
  it('creates an editable proposal and applies only its approved action payload', async () => {
    const repository = new PlaybookRepository(pool);
    const source: MiningSource = {
      sourceType: 'approved_reply', sourceId, question: 'Invoice?', answer: 'Net 30.', subject: 'Terms',
      existingEntries: []
    };
    await expect(repository.saveOutcome(source, {
      shouldUpdate: true, reason: 'Recurring policy', slug, title: 'Payment terms', markdown: '# Payment terms\n\nNet 30.'
    })).resolves.toBe('proposed');
    const card = await pool.query<{ id: string; type: string; status: string; payload: { markdown: string } }>(
      `SELECT card.id, card.type, action.status, action.payload FROM cards card
       JOIN actions action ON action.card_id = card.id
       WHERE card.source_type = 'playbook_mining' AND card.source_id = $1`,
      [`approved_reply:${sourceId}`]
    );
    expect(card.rows[0]).toMatchObject({ type: 'playbook_update', status: 'pending' });
    expect(card.rows[0]?.payload.markdown).toContain('Net 30');

    await expect(repository.upsert({ slug, title: 'Payment terms', markdown: '# Updated' }))
      .resolves.toEqual({ slug });
    expect((await pool.query('SELECT content FROM playbook_entries WHERE slug = $1', [slug])).rows[0]?.content)
      .toBe('# Updated');

    await pool.query('DELETE FROM cards WHERE id = $1', [card.rows[0]?.id]);
  });

  it('skips short exchanges instead of paying a model run for them', async () => {
    const thread = await pool.query<{ id: string }>(
      `INSERT INTO threads (provider, external_id, subject) VALUES ('test', $1, 'Danke') RETURNING id`,
      [trivialThreadId]
    );
    const threadId = thread.rows[0]!.id;
    // Genau die Sorte Wortwechsel, die das Archiv massenhaft enthaelt.
    await pool.query(
      `INSERT INTO messages (thread_id, provider, external_id, direction, sender, recipients, subject, body_text, sent_at)
       VALUES ($1, 'test', $2, 'inbound', 'kunde@example.com', ARRAY['niels@songpush.com'], 'Danke', 'Danke dir!', now()),
              ($1, 'test', $3, 'outbound', 'niels@songpush.com', ARRAY['kunde@example.com'], 'Re: Danke', 'Gerne!', now() + interval '1 minute')`,
      [threadId, randomUUID(), randomUUID()]
    );

    const pairs = await pool.query(
      'SELECT 1 FROM reply_pairs WHERE thread_id = $1', [threadId]
    );
    expect(pairs.rowCount).toBe(1);

    // Das Paar existiert, wird aber nicht als Mining-Quelle angeboten:
    // entweder kommt gar nichts zurueck oder etwas anderes.
    const source = await new PlaybookRepository(pool).nextSource();
    expect(source?.answer).not.toBe('Gerne!');
    expect(source?.question).not.toBe('Danke dir!');
  });
});
