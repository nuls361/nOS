import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { WorkspaceRepository } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const cardIds: string[] = [];

afterAll(async () => {
  if (!pool) return;
  if (cardIds.length) await pool.query('DELETE FROM cards WHERE id = ANY($1::uuid[])', [cardIds]);
  await pool.end();
});

describeWithDatabase('WorkspaceRepository integration', () => {
  it('lists by urgency and allows pending edit plus audited approval', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    for (const urgency of [20, 90]) {
      const card = await pool.query<{ id: string }>(
        `INSERT INTO cards (type, status, urgency, title) VALUES ('email_reply', 'open', $1, $2) RETURNING id`,
        [urgency, `Workspace ${urgency} ${randomUUID()}`]
      );
      cardIds.push(card.rows[0]!.id);
    }
    const action = await pool.query<{ id: string }>(
      `INSERT INTO actions (card_id, type, status, payload)
       VALUES ($1, 'gmail_send', 'pending', $2) RETURNING id`,
      [cardIds[1], JSON.stringify({ to: ['customer@example.com'], subject: 'Old', body: 'Draft' })]
    );
    const actionId = action.rows[0]!.id;
    const repository = new WorkspaceRepository(pool);
    const listed = await repository.listCards() as Array<{ id: string }>;
    expect(listed.findIndex(({ id }) => id === cardIds[1])).toBeLessThan(listed.findIndex(({ id }) => id === cardIds[0]));
    expect(await repository.updateAction(actionId, { to: ['customer@example.com'], subject: 'New', body: 'Edited' })).toBe(true);
    expect(await repository.approveAction(actionId, 'niels@songpush.com')).toBe(true);
    expect(await repository.updateAction(actionId, {})).toBe(false);
    const audit = await pool.query<{ event: string; actor: string; details: { payload: { subject: string } } }>(
      `SELECT event, actor, details FROM audit_log WHERE action_id = $1 ORDER BY id`, [actionId]
    );
    expect(audit.rows).toEqual([expect.objectContaining({
      event: 'approved', actor: 'niels@songpush.com', details: expect.objectContaining({
        payload: expect.objectContaining({ subject: 'New' })
      })
    })]);
  });
});
