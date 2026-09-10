import type { Pool } from 'pg';
import type { EmailWorkItem } from '../emails/types.js';
import type { DelegationProposal } from './types.js';

export class DelegationRepository {
  constructor(private readonly pool: Pool) {}

  async claimNext(): Promise<EmailWorkItem | null> {
    const result = await this.pool.query<{
      id: string; external_id: string; thread_id: string; sender: string; recipients: string[];
      cc: string[]; subject: string | null; body_text: string; headers: Record<string, string>;
      label_ids: string[]; sent_at: Date;
    }>(
      `WITH candidate AS (
         SELECT id FROM messages
         WHERE direction = 'inbound'
           AND (delegation_status = 'unprocessed'
             OR (delegation_status = 'processing' AND delegation_started_at < now() - interval '30 minutes'))
           AND sent_at >= (SELECT queue_start_at FROM email_queue_state WHERE key = 'inbound')
         ORDER BY sent_at, id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE messages message SET
         delegation_status = 'processing', delegation_started_at = now(), delegation_error = NULL
       FROM candidate WHERE message.id = candidate.id
       RETURNING message.id, message.external_id, message.thread_id, message.sender,
                 message.recipients, message.cc, message.subject, message.body_text,
                 message.headers, message.label_ids, message.sent_at`
    );
    const row = result.rows[0];
    return row ? {
      messageDatabaseId: row.id, messageExternalId: row.external_id, threadId: row.thread_id,
      sender: row.sender, recipients: row.recipients, cc: row.cc, subject: row.subject,
      body: row.body_text, headers: row.headers, labelIds: row.label_ids, sentAt: row.sent_at
    } : null;
  }

  async createCard(mail: EmailWorkItem, proposal: DelegationProposal): Promise<{ cardId: string; existing: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO cards (type, status, urgency, title, payload, sources, source_type, source_id)
         VALUES ('delegation', 'open', 60, $1, $2, $3, 'gmail_delegation_message', $4)
         ON CONFLICT (source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
         DO NOTHING RETURNING id`,
        [`Delegation an ${proposal.colleague}: ${mail.subject ?? 'Neue Mail'}`, JSON.stringify(proposal),
          JSON.stringify([{ sourceId: `mail:${mail.messageDatabaseId}`, label: mail.subject }]), mail.messageExternalId]
      );
      const cardId = inserted.rows[0]?.id;
      if (!cardId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM cards WHERE source_type = 'gmail_delegation_message' AND source_id = $1`,
          [mail.messageExternalId]
        );
        const existingId = existing.rows[0]?.id;
        if (!existingId) throw new Error('Delegation card conflict without existing card');
        await this.mark(client, mail.messageDatabaseId, 'processed');
        await client.query('COMMIT');
        return { cardId: existingId, existing: true };
      }
      await client.query(
        `INSERT INTO actions (card_id, type, status, payload) VALUES ($1, 'gmail_forward', 'pending', $2)`,
        [cardId, JSON.stringify({
          colleague: proposal.colleague,
          sourceMessageId: mail.messageExternalId,
          subject: proposal.briefingSubject,
          body: proposal.briefingBody,
          citations: proposal.citations
        })]
      );
      if (proposal.task) {
        await client.query(
          `INSERT INTO actions (card_id, type, status, payload) VALUES ($1, 'attio_task', 'pending', $2)`,
          [cardId, JSON.stringify(proposal.task)]
        );
      }
      await this.mark(client, mail.messageDatabaseId, 'processed');
      await client.query('COMMIT');
      return { cardId, existing: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markSkipped(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE messages SET delegation_status = 'skipped', delegation_error = NULL WHERE id = $1`, [id]
    );
  }

  async markFailed(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.pool.query(
      `UPDATE messages SET delegation_status = 'failed', delegation_error = $2 WHERE id = $1`,
      [id, message.slice(0, 4_000)]
    );
  }

  private async mark(
    client: { query(query: string, values?: unknown[]): Promise<unknown> },
    id: string,
    status: 'processed'
  ): Promise<void> {
    await client.query(
      `UPDATE messages SET delegation_status = $2, delegation_error = NULL WHERE id = $1`, [id, status]
    );
  }
}
