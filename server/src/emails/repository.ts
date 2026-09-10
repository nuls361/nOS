import type { Pool } from 'pg';
import type { MailCardProposal } from './mail-card.js';
import type { EmailWorkItem } from './types.js';

export interface CreatedEmailCard {
  cardId: string;
  existing: boolean;
}

export class EmailCardRepository {
  constructor(private readonly pool: Pool) {}

  async claimNext(): Promise<EmailWorkItem | null> {
    const result = await this.pool.query<{
      id: string; external_id: string; thread_id: string; thread_external_id: string;
      sender: string; recipients: string[];
      cc: string[]; subject: string | null; body_text: string; headers: Record<string, string>;
      label_ids: string[]; sent_at: Date;
    }>(
      `WITH candidate AS (
         SELECT message.id, thread.external_id AS thread_external_id FROM messages message
         JOIN threads thread ON thread.id = message.thread_id
         WHERE message.direction = 'inbound'
           AND (message.processing_status = 'unprocessed'
             OR (message.processing_status = 'processing' AND message.processing_started_at < now() - interval '30 minutes'))
           -- Nur Mails ab dem Aktivierungszeitpunkt: der Gmail-Backfill spielt
           -- zwölf Monate Historie ein, und ohne diese Grenze erzeugt die
           -- Warteschlange für jede alte Mail einen Entwurf.
           AND message.sent_at >= (SELECT queue_start_at FROM email_queue_state WHERE key = 'inbound')
         ORDER BY message.sent_at, message.id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE messages message SET
         processing_status = 'processing', processing_started_at = now(), processing_error = NULL
       FROM candidate WHERE message.id = candidate.id
       RETURNING message.id, message.external_id, message.thread_id, message.sender,
                 candidate.thread_external_id, message.recipients, message.cc, message.subject, message.body_text,
                 message.headers, message.label_ids, message.sent_at`
    );
    const row = result.rows[0];
    return row ? {
      messageDatabaseId: row.id,
      messageExternalId: row.external_id,
      threadId: row.thread_id,
      threadExternalId: row.thread_external_id,
      sender: row.sender,
      recipients: row.recipients,
      cc: row.cc,
      subject: row.subject,
      body: row.body_text,
      headers: row.headers,
      labelIds: row.label_ids,
      sentAt: row.sent_at
    } : null;
  }

  async createCard(mail: EmailWorkItem, proposal: MailCardProposal): Promise<CreatedEmailCard> {
    const { reply: draft, delegation } = proposal;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO cards (type, status, urgency, title, payload, sources, source_type, source_id)
         VALUES ('email_reply', 'open', 50, $1, $2, $3, 'gmail_message', $4)
         ON CONFLICT (source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
         DO NOTHING RETURNING id`,
        [mail.subject ? `Antwort: ${mail.subject}` : `Antwort an ${mail.sender}`,
          JSON.stringify({ sender: mail.sender, draft, delegation }),
          JSON.stringify([{ sourceId: `mail:${mail.messageDatabaseId}`, label: mail.subject }]),
          mail.messageExternalId]
      );
      const cardId = inserted.rows[0]?.id;
      if (!cardId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM cards WHERE source_type = 'gmail_message' AND source_id = $1`,
          [mail.messageExternalId]
        );
        const existingCardId = existing.rows[0]?.id;
        if (!existingCardId) throw new Error('Email card conflict without existing card');
        await this.setStatus(client, mail.messageDatabaseId, 'processed');
        await client.query('COMMIT');
        return { cardId: existingCardId, existing: true };
      }
      await client.query(
        `INSERT INTO actions (card_id, type, status, payload)
         VALUES ($1, 'gmail_send', 'pending', $2)`,
        [cardId, JSON.stringify({
          gmailThreadId: mail.threadExternalId,
          inReplyTo: mail.headers['message-id'] ?? null,
          references: [mail.headers.references, mail.headers['message-id']].filter(Boolean).join(' ') || null,
          to: [extractReplyAddress(mail.sender)],
          ...draft
        })]
      );
      // Delegation haengt an derselben Karte statt an einer zweiten: eine Mail,
      // eine Entscheidung, jede Aktion einzeln freizugeben.
      if (delegation.shouldDelegate) {
        await client.query(
          `INSERT INTO actions (card_id, type, status, payload)
           VALUES ($1, 'gmail_forward', 'pending', $2)`,
          [cardId, JSON.stringify({
            colleague: delegation.colleague,
            sourceMessageId: mail.messageExternalId,
            subject: delegation.briefingSubject,
            body: delegation.briefingBody,
            citations: delegation.citations
          })]
        );
        if (delegation.task) {
          await client.query(
            `INSERT INTO actions (card_id, type, status, payload)
             VALUES ($1, 'attio_task', 'pending', $2)`,
            [cardId, JSON.stringify(delegation.task)]
          );
        }
      }
      await this.setStatus(client, mail.messageDatabaseId, 'processed');
      await client.query('COMMIT');
      return { cardId, existing: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Zurueckgehaltene Mail sichtbar machen. Ohne Karte faellt eine falsch
   * eingestufte Kundenmail komplett aus dem Arbeitsablauf, ohne Hinweis.
   * Die Karte traegt bewusst KEINE Aktionen: nichts ist vorbereitet, der
   * Mensch sieht die Mail im Postfach selbst an.
   */
  async createQuarantineCard(mail: EmailWorkItem, reason: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO cards (type, status, urgency, title, payload, sources, source_type, source_id)
         VALUES ('quarantined', 'open', 55, $1, $2, $3, 'gmail_message', $4)
         ON CONFLICT (source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
         DO NOTHING`,
        [`Zurückgehalten: ${mail.subject ?? mail.sender}`,
          JSON.stringify({
            reason,
            sender: mail.sender,
            note: 'Diese Mail wurde nicht verarbeitet. Bitte im Postfach selbst ansehen.'
          }),
          JSON.stringify([{ sourceId: `mail:${mail.messageDatabaseId}`, label: mail.subject }]),
          mail.messageExternalId]
      );
      await client.query(
        `UPDATE messages SET processing_status = 'skipped', processing_error = $2 WHERE id = $1`,
        [mail.messageDatabaseId, reason]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markSkipped(id: string, reason?: string): Promise<void> {
    await this.pool.query(
      `UPDATE messages SET processing_status = 'skipped', processing_error = $2 WHERE id = $1`, [id, reason ?? null]
    );
  }

  async markFailed(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.pool.query(
      `UPDATE messages SET processing_status = 'failed', processing_error = $2 WHERE id = $1`,
      [id, message.slice(0, 4_000)]
    );
  }

  private async setStatus(
    client: { query(query: string, values?: unknown[]): Promise<unknown> },
    id: string,
    status: 'processed'
  ): Promise<void> {
    await client.query(
      `UPDATE messages SET processing_status = $2, processing_error = NULL WHERE id = $1`, [id, status]
    );
  }
}

const extractReplyAddress = (sender: string): string => {
  const angle = /<([^<>]+)>/.exec(sender)?.[1];
  return (angle ?? sender).trim();
};
