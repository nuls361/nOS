import type { Pool } from 'pg';
import type { CallCardProposal, CallWorkItem } from './types.js';

export interface CreatedCallCard {
  cardId: string;
  actionCount: number;
  existing: boolean;
}

export class CallCardRepository {
  constructor(private readonly pool: Pool) {}

  async claimNext(): Promise<CallWorkItem | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query<{
        id: string; call_recording_id: string; raw_transcript: string; transcript_segments: unknown[];
        meeting_id: string; meeting_external_id: string; title: string | null; participants: unknown[];
      }>(
        `WITH candidate AS (
           SELECT recording.id
           FROM attio_call_recordings recording
           WHERE recording.raw_transcript IS NOT NULL
             AND (
               recording.processing_status = 'unprocessed'
               OR (recording.processing_status = 'processing'
                   AND recording.processing_started_at < now() - interval '30 minutes')
             )
           ORDER BY recording.transcript_fetched_at, recording.id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE attio_call_recordings recording SET
           processing_status = 'processing', processing_started_at = now(), processing_error = NULL
         FROM candidate, attio_meetings meeting
         WHERE recording.id = candidate.id AND meeting.id = recording.meeting_id
         RETURNING recording.id, recording.call_recording_id, recording.raw_transcript,
                   recording.transcript_segments, meeting.id AS meeting_id,
                   meeting.meeting_id AS meeting_external_id, meeting.title, meeting.participants`
      );
      const row = claimed.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      const links = await client.query<{ object_slug: string; record_id: string }>(
        `SELECT object_slug, record_id FROM attio_meeting_record_links
         WHERE meeting_id = $1 ORDER BY object_slug, record_id`, [row.meeting_id]
      );
      await client.query('COMMIT');
      return {
        recordingDatabaseId: row.id,
        callRecordingId: row.call_recording_id,
        meetingId: row.meeting_external_id,
        meetingTitle: row.title,
        participants: row.participants,
        linkedRecords: links.rows.map((link) => ({ objectSlug: link.object_slug, recordId: link.record_id })),
        rawTranscript: row.raw_transcript,
        transcriptSegments: row.transcript_segments ?? []
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createCard(workItem: CallWorkItem, proposal: CallCardProposal): Promise<CreatedCallCard> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO cards (type, status, urgency, title, payload, sources, source_type, source_id)
         VALUES ('call_followup', 'open', 70, $1, $2, $3, 'attio_call_recording', $4)
         ON CONFLICT (source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
         DO NOTHING RETURNING id`,
        [workItem.meetingTitle ?? 'Call-Nachbereitung', JSON.stringify(proposal),
          JSON.stringify([{ sourceId: `call:${workItem.callRecordingId}`, label: workItem.meetingTitle }]),
          workItem.callRecordingId]
      );
      const cardId = inserted.rows[0]?.id;
      if (!cardId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM cards WHERE source_type = 'attio_call_recording' AND source_id = $1`,
          [workItem.callRecordingId]
        );
        const existingCardId = existing.rows[0]?.id;
        if (!existingCardId) throw new Error('Call card conflict without existing card');
        await this.markProcessed(client, workItem.recordingDatabaseId);
        await client.query('COMMIT');
        return { cardId: existingCardId, actionCount: 0, existing: true };
      }

      const actions: Array<{ type: string; payload: unknown }> = [
        { type: 'gmail_send', payload: proposal.followUpEmail },
        ...proposal.attioUpdates.map((payload) => ({ type: 'attio_update', payload })),
        ...(proposal.delegation ? [{ type: 'gmail_forward', payload: proposal.delegation }] : []),
        ...(proposal.task ? [{ type: 'attio_task', payload: proposal.task }] : [])
      ];
      for (const action of actions) {
        await client.query(
          `INSERT INTO actions (card_id, type, status, payload) VALUES ($1, $2, 'pending', $3)`,
          [cardId, action.type, JSON.stringify(action.payload)]
        );
      }
      await this.markProcessed(client, workItem.recordingDatabaseId);
      await client.query('COMMIT');
      return { cardId, actionCount: actions.length, existing: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async markProcessed(client: { query(query: string, values?: unknown[]): Promise<unknown> }, id: string): Promise<void> {
    await client.query(
      `UPDATE attio_call_recordings SET processing_status = 'processed', processing_error = NULL
       WHERE id = $1`, [id]
    );
  }

  async markFailed(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.pool.query(
      `UPDATE attio_call_recordings SET processing_status = 'failed', processing_error = $2
       WHERE id = $1`, [id, message.slice(0, 4_000)]
    );
  }
}
