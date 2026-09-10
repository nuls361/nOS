import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { DelegationRepository } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const externalId = `delegation-${randomUUID()}`;
let threadId: string;

afterAll(async () => {
  if (!pool) return;
  await pool.query("DELETE FROM cards WHERE source_type = 'gmail_delegation_message' AND source_id = $1", [externalId]);
  if (threadId) await pool.query('DELETE FROM threads WHERE id = $1', [threadId]);
  await pool.end();
});

describeWithDatabase('DelegationRepository integration', () => {
  it('creates separate pending forward and optional task exactly once', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const thread = await pool.query<{ id: string }>(
      `INSERT INTO threads (provider, external_id, subject) VALUES ('gmail', $1, 'Campaign') RETURNING id`,
      [`thread-${randomUUID()}`]
    );
    threadId = thread.rows[0]!.id;
    await pool.query(
      `INSERT INTO messages
       (thread_id, provider, external_id, direction, sender, recipients, subject, body_text, sent_at, headers)
       VALUES ($1, 'gmail', $2, 'inbound', 'Partner <partner@example.com>', ARRAY['niels@songpush.com'],
               'Campaign', 'Please coordinate campaign assets.', now(), '{}'::jsonb)`, [threadId, externalId]
    );
    const repository = new DelegationRepository(pool);
    const claimed = await repository.claimNext();
    expect(claimed).toMatchObject({ messageExternalId: externalId });
    const proposal = {
      shouldDelegate: true as const,
      colleague: 'Noah' as const,
      reason: 'Historical precedent',
      briefingSubject: 'Fwd: Hilfe benötigt – Campaign',
      briefingBody: 'Please coordinate the assets.',
      citations: [{ sourceId: 'mail:history', reason: 'Prior forward' }],
      task: {
        title: 'Coordinate campaign assets', description: 'Follow up with partner', assignee: 'Noah' as const,
        dueDate: null, objectSlug: null, recordId: null,
        citations: [{ sourceId: 'mail:history', reason: 'Prior forward' }]
      }
    };
    const created = await repository.createCard(claimed!, proposal);
    const actions = await pool.query<{ type: string; status: string }>(
      'SELECT type, status FROM actions WHERE card_id = $1 ORDER BY type', [created.cardId]
    );
    expect(actions.rows).toEqual([
      { type: 'attio_task', status: 'pending' },
      { type: 'gmail_forward', status: 'pending' }
    ]);

    await pool.query("UPDATE messages SET delegation_status = 'unprocessed' WHERE external_id = $1", [externalId]);
    const duplicate = await repository.createCard((await repository.claimNext())!, proposal);
    expect(duplicate).toMatchObject({ cardId: created.cardId, existing: true });
    expect((await pool.query('SELECT id FROM actions WHERE card_id = $1', [created.cardId])).rowCount).toBe(2);
  });
});
