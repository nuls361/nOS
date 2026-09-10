import type { Pool } from 'pg';
import type { ActionType, ActionWorkItem } from './types.js';

export class ActionRepository {
  constructor(private readonly pool: Pool) {}

  async claimNext(): Promise<ActionWorkItem | null> {
    return this.claim();
  }

  async claimById(id: string): Promise<ActionWorkItem | null> {
    return this.claim(id);
  }

  private async claim(id?: string): Promise<ActionWorkItem | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        id: string; type: ActionType; payload: unknown; approved_at: Date; approved_by: string;
      }>(
        `WITH candidate AS (
           SELECT id FROM actions
           WHERE status = 'approved' AND approved_at IS NOT NULL AND approved_by IS NOT NULL
             AND ($1::uuid IS NULL OR id = $1)
           ORDER BY approved_at, id
           FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE actions action SET status = 'executing', error = NULL, updated_at = now()
         FROM candidate WHERE action.id = candidate.id
         RETURNING action.id, action.type, action.payload, action.approved_at, action.approved_by`,
        [id ?? null]
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      await client.query(
        `INSERT INTO audit_log (action_id, event, actor, details)
         VALUES ($1, 'execution_started', 'action-worker', $2)`,
        [row.id, JSON.stringify({
          approvedAt: row.approved_at.toISOString(), approvedBy: row.approved_by,
          type: row.type, payload: row.payload
        })]
      );
      await client.query('COMMIT');
      return {
        id: row.id, type: row.type, payload: row.payload,
        approvedAt: row.approved_at, approvedBy: row.approved_by
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markExecuted(action: ActionWorkItem, result: unknown): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE actions SET status = 'executed', executed_at = now(), error = NULL, updated_at = now()
         WHERE id = $1 AND status = 'executing'`, [action.id]
      );
      if (updated.rowCount !== 1) throw new Error(`Action ${action.id} is not executing`);
      await client.query(
        `INSERT INTO audit_log (action_id, event, actor, details)
         VALUES ($1, 'executed', 'action-worker', $2)`,
        [action.id, JSON.stringify({
          approvedAt: action.approvedAt.toISOString(), approvedBy: action.approvedBy,
          type: action.type, payload: action.payload, result
        })]
      );
      await client.query(
        `UPDATE cards card SET status = 'completed', updated_at = now()
         FROM actions source WHERE source.id = $1 AND card.id = source.card_id
           AND NOT EXISTS (SELECT 1 FROM actions remaining WHERE remaining.card_id = card.id
             AND remaining.status IN ('pending', 'approved', 'executing'))`, [action.id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Die Aktion wurde ausgefuehrt (Mail ist raus, CRM ist geschrieben), aber das
   * Festschreiben schlug fehl. Der Status bleibt bewusst 'executing': dieser
   * Zustand wird nie erneut geholt, also kann nichts ein zweites Mal passieren.
   * Als 'failed' zu markieren waere gefaehrlich - jemand wuerde die Aktion
   * erneut freigeben und die Mail ginge zweimal raus.
   */
  async markBookkeepingFailed(action: ActionWorkItem, result: unknown, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.pool.query(
      `INSERT INTO audit_log (action_id, event, actor, details)
       VALUES ($1, 'execution_bookkeeping_failed', 'action-worker', $2)`,
      [action.id, JSON.stringify({
        approvedAt: action.approvedAt.toISOString(), approvedBy: action.approvedBy,
        type: action.type, payload: action.payload, result, error: message.slice(0, 4_000),
        note: 'Action was executed successfully; recording the result failed. Needs manual reconciliation.'
      })]
    );
  }

  async markFailed(action: ActionWorkItem, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE actions SET status = 'failed', error = $2, updated_at = now()
         WHERE id = $1 AND status = 'executing'`, [action.id, message.slice(0, 4_000)]
      );
      await client.query(
        `INSERT INTO audit_log (action_id, event, actor, details)
         VALUES ($1, 'execution_failed', 'action-worker', $2)`,
        [action.id, JSON.stringify({
          approvedAt: action.approvedAt.toISOString(), approvedBy: action.approvedBy,
          type: action.type, payload: action.payload, error: message.slice(0, 4_000)
        })]
      );
      await client.query('COMMIT');
    } catch (auditError) {
      await client.query('ROLLBACK');
      throw auditError;
    } finally {
      client.release();
    }
  }
}
