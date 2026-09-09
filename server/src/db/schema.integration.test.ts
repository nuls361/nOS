import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { createPool } from './pool.js';

const pool = createPool();
const createdThreadIds: string[] = [];

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  if (createdThreadIds.length) {
    await pool.query('DELETE FROM threads WHERE id = ANY($1::uuid[])', [createdThreadIds]);
  }
  await pool.end();
});

describe('database schema', () => {
  it('runs migrations idempotently', async () => {
    await expect(migrate()).resolves.toEqual([]);
  });

  it('finds German and English terms with simple FTS', async () => {
    const threadId = randomUUID();
    createdThreadIds.push(threadId);
    await pool.query(
      `INSERT INTO threads (id, provider, external_id, subject)
       VALUES ($1, 'test', $2, 'Zahlungsbedingungen')`,
      [threadId, randomUUID()]
    );
    await pool.query(
      `INSERT INTO messages
        (thread_id, provider, external_id, direction, sender, recipients, subject, body_text, sent_at)
       VALUES
        ($1, 'test', $2, 'inbound', 'kunde@example.com', ARRAY['niels@songpush.com'],
         'Payment terms', 'Können wir auf Rechnung mit 30 Tagen Zahlungsziel zahlen?', now()),
        ($1, 'test', $3, 'outbound', 'niels@songpush.com', ARRAY['kunde@example.com'],
         'Re: Payment terms', 'Yes, payment by invoice within 30 days is possible.', now() + interval '1 minute')`,
      [threadId, randomUUID(), randomUUID()]
    );

    const german = await pool.query(
      `SELECT id FROM messages
       WHERE thread_id = $1
         AND search_document @@ websearch_to_tsquery('simple', 'Rechnung Zahlungsziel')`,
      [threadId]
    );
    const english = await pool.query(
      `SELECT id FROM messages
       WHERE thread_id = $1
         AND search_document @@ websearch_to_tsquery('simple', 'payment invoice')`,
      [threadId]
    );
    const pairs = await pool.query('SELECT * FROM reply_pairs WHERE thread_id = $1', [threadId]);

    expect(german.rowCount).toBe(1);
    expect(english.rowCount).toBe(1);
    expect(pairs.rowCount).toBe(1);
  });
});
