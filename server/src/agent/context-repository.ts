import type { Pool } from 'pg';

export interface MailSearchResult {
  sourceId: string;
  messageId: string;
  threadId: string;
  subject: string | null;
  sender: string;
  recipients: string[];
  body: string;
  direction: 'inbound' | 'outbound';
  sentAt: string;
  rank: number;
}

export class ContextRepository {
  constructor(private readonly pool: Pool) {}

  async searchMail(query: string, limit = 10): Promise<MailSearchResult[]> {
    const result = await this.pool.query<{
      id: string; thread_id: string; subject: string | null; sender: string; recipients: string[];
      body_text: string; direction: 'inbound' | 'outbound'; sent_at: Date; rank: number;
    }>(
      `SELECT id, thread_id, subject, sender, recipients, body_text, direction, sent_at,
              ts_rank_cd(search_document, websearch_to_tsquery('simple', $1))::float AS rank
       FROM messages
       WHERE search_document @@ websearch_to_tsquery('simple', $1)
       ORDER BY rank DESC, sent_at DESC
       LIMIT $2`,
      [query, Math.min(Math.max(limit, 1), 25)]
    );
    return result.rows.map((row) => ({
      sourceId: `mail:${row.id}`,
      messageId: row.id,
      threadId: row.thread_id,
      subject: row.subject,
      sender: row.sender,
      recipients: row.recipients,
      body: row.body_text,
      direction: row.direction,
      sentAt: row.sent_at.toISOString(),
      rank: row.rank
    }));
  }

  async readThread(threadId: string): Promise<{ sourceId: string; subject: string | null; messages: unknown[] } | null> {
    const thread = await this.pool.query<{ subject: string | null }>('SELECT subject FROM threads WHERE id = $1', [threadId]);
    if (!thread.rowCount) return null;
    const messages = await this.pool.query<{
      id: string; direction: string; sender: string; recipients: string[]; body_text: string; sent_at: Date;
    }>(
      `SELECT id, direction, sender, recipients, body_text, sent_at
       FROM messages WHERE thread_id = $1 ORDER BY sent_at, id`, [threadId]
    );
    return {
      sourceId: `thread:${threadId}`,
      subject: thread.rows[0]?.subject ?? null,
      messages: messages.rows.map((message) => ({
        sourceId: `mail:${message.id}`,
        direction: message.direction,
        sender: message.sender,
        recipients: message.recipients,
        body: message.body_text,
        sentAt: message.sent_at.toISOString()
      }))
    };
  }

  async searchCalls(query: string, limit = 10): Promise<unknown[]> {
    const result = await this.pool.query<{
      recording_id: string; meeting_id: string; title: string | null; raw_transcript: string;
      transcript_web_url: string | null; ends_at: Date | null; rank: number;
    }>(
      `SELECT recording.call_recording_id AS recording_id, meeting.meeting_id,
              meeting.title, recording.raw_transcript, recording.transcript_web_url, meeting.ends_at,
              ts_rank_cd(recording.search_document, websearch_to_tsquery('simple', $1))::float AS rank
       FROM attio_call_recordings recording
       JOIN attio_meetings meeting ON meeting.id = recording.meeting_id
       WHERE recording.search_document @@ websearch_to_tsquery('simple', $1)
       ORDER BY rank DESC, meeting.ends_at DESC NULLS LAST
       LIMIT $2`,
      [query, Math.min(Math.max(limit, 1), 20)]
    );
    return result.rows.map((row) => ({
      sourceId: `call:${row.recording_id}`,
      meetingId: row.meeting_id,
      title: row.title,
      transcript: row.raw_transcript,
      webUrl: row.transcript_web_url,
      endedAt: row.ends_at?.toISOString() ?? null,
      rank: row.rank
    }));
  }

  async readAttio(objectSlug: string, recordId: string): Promise<unknown | null> {
    const result = await this.pool.query<{
      object_slug: string; record_id: string; values: unknown; web_url: string | null;
    }>(
      `SELECT object_slug, record_id, values, web_url FROM attio_records
       WHERE object_slug = $1 AND record_id = $2`, [objectSlug, recordId]
    );
    const row = result.rows[0];
    return row ? { sourceId: `attio:${row.object_slug}:${row.record_id}`, ...row } : null;
  }

  async readPlaybook(query?: string): Promise<unknown[]> {
    const result = query
      ? await this.pool.query<{ slug: string; title: string; content: string }>(
        `SELECT slug, title, content FROM playbook_entries
         WHERE search_document @@ websearch_to_tsquery('simple', $1)
         ORDER BY ts_rank_cd(search_document, websearch_to_tsquery('simple', $1)) DESC LIMIT 10`, [query]
      )
      : await this.pool.query<{ slug: string; title: string; content: string }>(
        'SELECT slug, title, content FROM playbook_entries ORDER BY slug LIMIT 50'
      );
    return result.rows.map((row) => ({ sourceId: `playbook:${row.slug}`, ...row }));
  }
}
