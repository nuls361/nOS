import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Draft } from '../agent/draft-agent.js';
import { EmailCardRepository } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const messageExternalId = `email-card-${randomUUID()}`;
let threadId: string;
let messageId: string;

afterAll(async () => {
  if (!pool) return;
  await pool.query("DELETE FROM cards WHERE source_type = 'gmail_message' AND source_id = $1", [messageExternalId]);
  if (threadId) await pool.query('DELETE FROM threads WHERE id = $1', [threadId]);
  await pool.end();
});

describeWithDatabase('EmailCardRepository integration', () => {
  it('claims mail and creates exactly one pending reply action', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const thread = await pool.query<{ id: string }>(
      `INSERT INTO threads (provider, external_id, subject) VALUES ('gmail', $1, 'Angebot') RETURNING id`,
      [`thread-${randomUUID()}`]
    );
    threadId = thread.rows[0]!.id;
    const message = await pool.query<{ id: string }>(
      `INSERT INTO messages
       (thread_id, provider, external_id, direction, sender, recipients, subject, body_text, sent_at, headers)
       VALUES ($1, 'gmail', $2, 'inbound', 'Karla <karla@example.com>', ARRAY['niels@songpush.com'],
               'Angebot', 'Was kostet das?', now(), '{}'::jsonb) RETURNING id`,
      [threadId, messageExternalId]
    );
    messageId = message.rows[0]!.id;
    const repository = new EmailCardRepository(pool);
    const claimed = await repository.claimNext();
    expect(claimed).toMatchObject({ messageDatabaseId: messageId, messageExternalId });

    const draft: Draft = {
      subject: 'Re: Angebot', body: 'Der Preis ist [PREIS BESTÄTIGEN].', tone: 'sie', confidence: 0.7,
      sensitivePlaceholders: [{ label: '[PREIS BESTÄTIGEN]', reason: 'Freigabe nötig' }], citations: []
    };
    const created = await repository.createCard(claimed!, draft);
    expect(created.existing).toBe(false);
    const actions = await pool.query<{ type: string; status: string; payload: { body: string } }>(
      'SELECT type, status, payload FROM actions WHERE card_id = $1', [created.cardId]
    );
    expect(actions.rows).toEqual([
      expect.objectContaining({ type: 'gmail_send', status: 'pending', payload: expect.objectContaining({ body: draft.body }) })
    ]);
    expect((await pool.query('SELECT id FROM messages WHERE id = $1 AND processing_status = $2', [messageId, 'processed'])).rowCount).toBe(1);

    await pool.query("UPDATE messages SET processing_status = 'unprocessed' WHERE id = $1", [messageId]);
    const duplicate = await repository.createCard((await repository.claimNext())!, draft);
    expect(duplicate).toMatchObject({ cardId: created.cardId, existing: true });
    expect((await pool.query('SELECT id FROM actions WHERE card_id = $1', [created.cardId])).rowCount).toBe(1);
  });
});
