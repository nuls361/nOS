import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { MailCardProposal } from './mail-card.js';
import { EmailCardRepository } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const messageExternalId = `email-card-${randomUUID()}`;
let threadId: string;
let messageId: string;
let archiveThreadId: string;

afterAll(async () => {
  if (!pool) return;
  await pool.query("DELETE FROM cards WHERE source_type = 'gmail_message' AND source_id = $1", [messageExternalId]);
  if (threadId) await pool.query('DELETE FROM threads WHERE id = $1', [threadId]);
  if (archiveThreadId) await pool.query('DELETE FROM threads WHERE id = $1', [archiveThreadId]);
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

    // Ein Lauf liefert Antwort UND Delegation; beide haengen als getrennt
    // freizugebende Aktionen an derselben Karte.
    const draft: MailCardProposal = {
      reply: {
        subject: 'Re: Angebot', body: 'Der Preis ist [PREIS BESTÄTIGEN].', tone: 'sie', confidence: 0.7,
        sensitivePlaceholders: [{ label: '[PREIS BESTÄTIGEN]', reason: 'Freigabe nötig' }], citations: []
      },
      delegation: {
        shouldDelegate: true, colleague: 'Lina', reason: 'Lina uebernimmt Briefings',
        briefingSubject: 'Fwd: Angebot', briefingBody: 'Bitte Angebot pruefen.',
        task: null, citations: [{ sourceId: 'mail:historisch', reason: 'Fwd: Briefing CW an Lina' }]
      }
    };
    const created = await repository.createCard(claimed!, draft);
    expect(created.existing).toBe(false);
    const actions = await pool.query<{ type: string; status: string; payload: { body: string } }>(
      'SELECT type, status, payload FROM actions WHERE card_id = $1', [created.cardId]
    );
    expect(actions.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'gmail_send', status: 'pending',
        payload: expect.objectContaining({ body: draft.reply.body })
      }),
      expect.objectContaining({
        type: 'gmail_forward', status: 'pending',
        payload: expect.objectContaining({ colleague: 'Lina' })
      })
    ]));
    expect(actions.rows).toHaveLength(2);
    expect((await pool.query('SELECT id FROM messages WHERE id = $1 AND processing_status = $2', [messageId, 'processed'])).rowCount).toBe(1);

    await pool.query("UPDATE messages SET processing_status = 'unprocessed' WHERE id = $1", [messageId]);
    const duplicate = await repository.createCard((await repository.claimNext())!, draft);
    expect(duplicate).toMatchObject({ cardId: created.cardId, existing: true });
    expect((await pool.query('SELECT id FROM actions WHERE card_id = $1', [created.cardId])).rowCount).toBe(2);
  });

  it('never claims mail older than the queue start', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const thread = await pool.query<{ id: string }>(
      `INSERT INTO threads (provider, external_id, subject) VALUES ('gmail', $1, 'Altes Archiv') RETURNING id`,
      [`thread-${randomUUID()}`]
    );
    archiveThreadId = thread.rows[0]!.id;
    // So sieht eine Mail aus, die der Zwoelf-Monats-Backfill einspielt: alt,
    // aber mit dem Default 'unprocessed'. Sie darf keine Karte ausloesen.
    const archived = await pool.query<{ id: string }>(
      `INSERT INTO messages
       (thread_id, provider, external_id, direction, sender, recipients, subject, body_text, sent_at, headers)
       VALUES ($1, 'gmail', $2, 'inbound', 'Alt <alt@example.com>', ARRAY['niels@songpush.com'],
               'Aus dem Archiv', 'Alte Anfrage', now() - interval '90 days', '{}'::jsonb) RETURNING id`,
      [archiveThreadId, `archive-${randomUUID()}`]
    );

    const repository = new EmailCardRepository(pool);
    const claimed = await repository.claimNext();

    expect(claimed?.messageDatabaseId).not.toBe(archived.rows[0]!.id);
    const status = await pool.query<{ processing_status: string }>(
      'SELECT processing_status FROM messages WHERE id = $1', [archived.rows[0]!.id]
    );
    expect(status.rows[0]?.processing_status).toBe('unprocessed');
  });
});
