import type { Pool } from 'pg';

export class WorkspaceRepository {
  constructor(private readonly pool: Pool) {}

  async listCards(): Promise<unknown[]> {
    const result = await this.pool.query<{
      id: string; type: string; status: string; urgency: number; title: string; payload: unknown;
      sources: unknown; snoozed_until: Date | null; created_at: Date; updated_at: Date; actions: unknown[];
    }>(
      `SELECT card.id, card.type, card.status, card.urgency, card.title, card.payload, card.sources,
              card.snoozed_until, card.created_at, card.updated_at,
              COALESCE(jsonb_agg(jsonb_build_object(
                'id', action.id, 'type', action.type, 'status', action.status,
                'payload', action.payload, 'error', action.error,
                'approvedAt', action.approved_at, 'approvedBy', action.approved_by,
                'executedAt', action.executed_at, 'updatedAt', action.updated_at
              ) ORDER BY action.created_at, action.id) FILTER (WHERE action.id IS NOT NULL), '[]'::jsonb) AS actions
       FROM cards card LEFT JOIN actions action ON action.card_id = card.id
       WHERE card.status = 'open'
          OR (card.status = 'snoozed' AND card.snoozed_until <= now())
       GROUP BY card.id
       ORDER BY card.urgency DESC, card.created_at DESC`
    );
    return result.rows.map((row) => ({
      id: row.id, type: row.type, status: row.status, urgency: row.urgency, title: row.title,
      payload: row.payload, sources: row.sources, snoozedUntil: row.snoozed_until?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), actions: row.actions
    }));
  }

  async updateAction(id: string, payload: unknown): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE actions SET payload = $2, updated_at = now()
       WHERE id = $1 AND status = 'pending'`, [id, JSON.stringify(payload)]
    );
    return result.rowCount === 1;
  }

  async approveAction(id: string, actor: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ payload: unknown; type: string }>(
        `UPDATE actions SET status = 'approved', approved_at = now(), approved_by = $2, updated_at = now()
         WHERE id = $1 AND status = 'pending' RETURNING payload, type`, [id, actor]
      );
      const action = result.rows[0];
      if (!action) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO audit_log (action_id, event, actor, details)
         VALUES ($1, 'approved', $2, $3)`,
        [id, actor, JSON.stringify({ type: action.type, payload: action.payload })]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async discardAction(id: string, actor: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ payload: unknown; type: string }>(
        `UPDATE actions SET status = 'discarded', updated_at = now()
         WHERE id = $1 AND status = 'pending' RETURNING payload, type`, [id]
      );
      const action = result.rows[0];
      if (!action) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO audit_log (action_id, event, actor, details) VALUES ($1, 'discarded', $2, $3)`,
        [id, actor, JSON.stringify({ type: action.type, payload: action.payload })]
      );
      await client.query(
        `UPDATE cards card SET status = 'completed', updated_at = now()
         FROM actions source WHERE source.id = $1 AND card.id = source.card_id
           AND NOT EXISTS (SELECT 1 FROM actions remaining WHERE remaining.card_id = card.id
             AND remaining.status IN ('pending', 'approved', 'executing'))`, [id]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async snoozeCard(id: string, until: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE cards SET status = 'snoozed', snoozed_until = $2, updated_at = now()
       WHERE id = $1 AND status IN ('open', 'snoozed')`, [id, until]
    );
    return result.rowCount === 1;
  }

  async discardCard(id: string, actor: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const card = await client.query(
        `UPDATE cards SET status = 'discarded', updated_at = now()
         WHERE id = $1 AND status IN ('open', 'snoozed') RETURNING id`, [id]
      );
      if (!card.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      const actions = await client.query<{ id: string; type: string; payload: unknown }>(
        `UPDATE actions SET status = 'discarded', updated_at = now()
         WHERE card_id = $1 AND status = 'pending' RETURNING id, type, payload`, [id]
      );
      for (const action of actions.rows) {
        await client.query(
          `INSERT INTO audit_log (action_id, event, actor, details) VALUES ($1, 'discarded', $2, $3)`,
          [action.id, actor, JSON.stringify({ type: action.type, payload: action.payload, cardDiscarded: true })]
        );
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

}
