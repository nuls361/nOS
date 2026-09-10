import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { PlaybookRepository } from './repository.js';
import type { MiningSource } from './types.js';

const pool = createPool();
const sourceId = randomUUID();
const slug = `payment-terms-${sourceId}`;

beforeAll(() => migrate());
afterAll(async () => {
  await pool.query('DELETE FROM playbook_entries WHERE slug = $1', [slug]);
  await pool.query("DELETE FROM playbook_mining_sources WHERE source_type = 'approved_reply' AND source_id = $1", [sourceId]);
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
});
