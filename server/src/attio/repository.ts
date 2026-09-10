import type { Pool } from 'pg';
import type { AttioCallRecording, AttioMeeting, AttioRecord, AttioTranscript } from './types.js';

export class AttioRepository {
  constructor(private readonly pool: Pool) {}

  async saveRecord(objectSlug: 'companies' | 'deals', record: AttioRecord): Promise<void> {
    if (!record.id.record_id) throw new Error(`Attio ${objectSlug} record lacks record_id`);
    await this.pool.query(
      `INSERT INTO attio_records
        (workspace_id, object_slug, record_id, values, web_url, source_created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (object_slug, record_id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         values = EXCLUDED.values,
         web_url = EXCLUDED.web_url,
         source_created_at = EXCLUDED.source_created_at,
         synced_at = now()`,
      [record.id.workspace_id, objectSlug, record.id.record_id, JSON.stringify(record.values),
        record.web_url ?? null, record.created_at ?? null]
    );
  }

  async saveMeeting(meeting: AttioMeeting): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `INSERT INTO attio_meetings
          (workspace_id, meeting_id, title, description, starts_at, ends_at, participants, linked_records, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (meeting_id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           starts_at = EXCLUDED.starts_at,
           ends_at = EXCLUDED.ends_at,
           participants = EXCLUDED.participants,
           linked_records = EXCLUDED.linked_records,
           raw = EXCLUDED.raw,
           synced_at = now()
         RETURNING id`,
        [meeting.id.workspace_id, meeting.id.meeting_id, meeting.title ?? null, meeting.description ?? null,
          meeting.start?.datetime ?? null, meeting.end?.datetime ?? null,
          JSON.stringify(meeting.participants ?? []), JSON.stringify(meeting.linked_records ?? []),
          JSON.stringify(meeting)]
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error('Failed to save Attio meeting');
      await client.query('DELETE FROM attio_meeting_record_links WHERE meeting_id = $1', [id]);
      for (const link of meeting.linked_records ?? []) {
        await client.query(
          `INSERT INTO attio_meeting_record_links (meeting_id, object_slug, record_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, link.object_slug, link.record_id]
        );
      }
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveRecording(meetingDatabaseId: string, recording: AttioCallRecording): Promise<void> {
    await this.pool.query(
      `INSERT INTO attio_call_recordings
        (meeting_id, call_recording_id, status, web_url, source_created_at, raw)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (call_recording_id) DO UPDATE SET
         meeting_id = EXCLUDED.meeting_id,
         status = EXCLUDED.status,
         web_url = EXCLUDED.web_url,
         source_created_at = EXCLUDED.source_created_at,
         raw = EXCLUDED.raw,
         synced_at = now()`,
      [meetingDatabaseId, recording.id.call_recording_id, recording.status,
        recording.web_url ?? null, recording.created_at ?? null, JSON.stringify(recording)]
    );
  }

  async needsTranscript(recordingId: string): Promise<boolean> {
    const result = await this.pool.query<{ needed: boolean }>(
      `SELECT transcript_fetched_at IS NULL AS needed
       FROM attio_call_recordings WHERE call_recording_id = $1`, [recordingId]
    );
    return result.rows[0]?.needed ?? true;
  }

  async saveTranscript(recordingId: string, transcript: AttioTranscript): Promise<void> {
    await this.pool.query(
      `UPDATE attio_call_recordings SET
         transcript_segments = $2,
         raw_transcript = $3,
         transcript_web_url = $4,
         transcript_fetched_at = now(),
         processing_status = 'unprocessed',
         synced_at = now()
       WHERE call_recording_id = $1`,
      [recordingId, JSON.stringify(transcript.transcript), transcript.raw_transcript ?? null,
        transcript.web_url ?? null]
    );
  }

  async savePollTime(time: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO attio_sync_state (key, last_poll_at) VALUES ('call_recordings', $1)
       ON CONFLICT (key) DO UPDATE SET last_poll_at = EXCLUDED.last_poll_at, updated_at = now()`,
      [time]
    );
  }
}
