import type { Pool } from 'pg';
import type { ParsedMessage } from './message.js';

export class GmailRepository {
  constructor(private readonly pool: Pool) {}

  async saveMessage(message: ParsedMessage): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const thread = await client.query<{ id: string }>(
        `INSERT INTO threads (provider, external_id, subject, participants, last_contact_at)
         VALUES ('gmail', $1, $2, $3, $4)
         ON CONFLICT (provider, external_id) DO UPDATE SET
           subject = COALESCE(EXCLUDED.subject, threads.subject),
           participants = EXCLUDED.participants,
           last_contact_at = GREATEST(threads.last_contact_at, EXCLUDED.last_contact_at),
           updated_at = now()
         RETURNING id`,
        [
          message.threadExternalId,
          message.subject ?? null,
          JSON.stringify([...new Set([message.sender, ...message.recipients, ...message.cc].filter(Boolean))]),
          message.sentAt
        ]
      );
      const threadId = thread.rows[0]?.id;
      if (!threadId) throw new Error('Failed to upsert Gmail thread');

      await client.query(
        `INSERT INTO messages
          (thread_id, provider, external_id, direction, sender, recipients, cc, subject, body_text,
           body_html, sent_at, headers, label_ids, gmail_history_id, snippet)
         VALUES ($1, 'gmail', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (provider, external_id) DO UPDATE SET
           thread_id = EXCLUDED.thread_id,
           direction = EXCLUDED.direction,
           sender = EXCLUDED.sender,
           recipients = EXCLUDED.recipients,
           cc = EXCLUDED.cc,
           subject = EXCLUDED.subject,
           body_text = EXCLUDED.body_text,
           body_html = EXCLUDED.body_html,
           sent_at = EXCLUDED.sent_at,
           headers = EXCLUDED.headers,
           label_ids = EXCLUDED.label_ids,
           gmail_history_id = EXCLUDED.gmail_history_id,
           snippet = EXCLUDED.snippet`,
        [threadId, message.externalId, message.direction, message.sender, message.recipients, message.cc,
          message.subject ?? null, message.bodyText, message.bodyHtml ?? null, message.sentAt,
          message.headers, message.labelIds, message.historyId ?? null, message.snippet ?? null]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getHistoryId(accountEmail: string): Promise<string | null> {
    const result = await this.pool.query<{ history_id: string }>(
      'SELECT history_id FROM gmail_sync_state WHERE account_email = $1', [accountEmail]
    );
    return result.rows[0]?.history_id ?? null;
  }

  async saveSyncState(accountEmail: string, historyId: string, full: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO gmail_sync_state
        (account_email, history_id, last_full_sync_at, last_incremental_sync_at)
       VALUES ($1, $2, CASE WHEN $3 THEN now() END, CASE WHEN NOT $3 THEN now() END)
       ON CONFLICT (account_email) DO UPDATE SET
         history_id = EXCLUDED.history_id,
         last_full_sync_at = CASE WHEN $3 THEN now() ELSE gmail_sync_state.last_full_sync_at END,
         last_incremental_sync_at = CASE WHEN NOT $3 THEN now() ELSE gmail_sync_state.last_incremental_sync_at END,
         updated_at = now()`,
      [accountEmail, historyId, full]
    );
  }

  async getBackfillState(accountEmail: string): Promise<{
    pageToken: string | null; initialHistoryId: string; completed: boolean;
  } | null> {
    const result = await this.pool.query<{
      page_token: string | null; initial_history_id: string; completed_at: Date | null;
    }>('SELECT page_token, initial_history_id, completed_at FROM gmail_backfill_state WHERE account_email = $1', [accountEmail]);
    const row = result.rows[0];
    return row ? {
      pageToken: row.page_token, initialHistoryId: row.initial_history_id, completed: Boolean(row.completed_at)
    } : null;
  }

  async saveBackfillState(
    accountEmail: string, initialHistoryId: string, pageToken: string | null, completed: boolean
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO gmail_backfill_state (account_email, page_token, initial_history_id, completed_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END)
       ON CONFLICT (account_email) DO UPDATE SET page_token = EXCLUDED.page_token,
         initial_history_id = EXCLUDED.initial_history_id,
         completed_at = CASE WHEN $4 THEN now() ELSE NULL END, updated_at = now()`,
      [accountEmail, pageToken, initialHistoryId, completed]
    );
  }
}
