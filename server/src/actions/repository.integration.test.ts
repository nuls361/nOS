import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ActionRepository } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const cardIds: string[] = [];

afterAll(async () => {
  if (!pool) return;
  if (cardIds.length) await pool.query('DELETE FROM cards WHERE id = ANY($1::uuid[])', [cardIds]);
  await pool.end();
});

const insertAction = async (status: 'pending' | 'approved', withApproval = false): Promise<string> => {
  if (!pool) throw new Error('DATABASE_URL required');
  const card = await pool.query<{ id: string }>(
    `INSERT INTO cards (type, status, title) VALUES ('email_reply', 'open', $1) RETURNING id`,
    [`Action test ${randomUUID()}`]
  );
  const cardId = card.rows[0]!.id;
  cardIds.push(cardId);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO actions (card_id, type, status, payload, approved_at, approved_by)
     VALUES ($1, 'gmail_send', $2, $3, CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN 'niels' END)
     RETURNING id`,
    [cardId, status, JSON.stringify({ to: ['customer@example.com'], subject: 'Hello', body: 'World' }), withApproval]
  );
  return result.rows[0]!.id;
};

describeWithDatabase('ActionRepository integration', () => {
  it('claims only explicitly approved actions and writes a complete audit trail', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const pendingId = await insertAction('pending');
    const incompleteApprovalId = await insertAction('approved');
    const approvedId = await insertAction('approved', true);
    const repository = new ActionRepository(pool);
    const claimed = await repository.claimNext();
    expect(claimed).toMatchObject({ id: approvedId, approvedBy: 'niels', type: 'gmail_send' });
    expect((await pool.query('SELECT status FROM actions WHERE id = $1', [pendingId])).rows[0]?.status).toBe('pending');
    expect((await pool.query('SELECT status FROM actions WHERE id = $1', [incompleteApprovalId])).rows[0]?.status).toBe('approved');

    await repository.markExecuted(claimed!, { messageId: 'gmail-sent-id', threadId: 'gmail-thread' });
    const action = await pool.query<{ status: string; executed_at: Date | null }>(
      'SELECT status, executed_at FROM actions WHERE id = $1', [approvedId]
    );
    expect(action.rows[0]).toMatchObject({ status: 'executed', executed_at: expect.any(Date) });
    const audit = await pool.query<{ event: string; details: Record<string, unknown> }>(
      'SELECT event, details FROM audit_log WHERE action_id = $1 ORDER BY id', [approvedId]
    );
    expect(audit.rows.map(({ event }) => event)).toEqual(['execution_started', 'executed']);
    expect(audit.rows[0]?.details).toMatchObject({
      approvedBy: 'niels', type: 'gmail_send', payload: expect.objectContaining({ subject: 'Hello' })
    });
    expect(audit.rows[1]?.details).toMatchObject({
      approvedBy: 'niels', result: { messageId: 'gmail-sent-id', threadId: 'gmail-thread' }
    });
  });
});
