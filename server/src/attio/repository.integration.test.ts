import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { AttioRepository } from './repository.js';

const pool = createPool();
const repository = new AttioRepository(pool);
const meetingId = randomUUID();
const recordingId = randomUUID();
const companyId = randomUUID();

beforeAll(async () => migrate());

afterAll(async () => {
  await pool.query('DELETE FROM attio_meetings WHERE meeting_id = $1', [meetingId]);
  await pool.query("DELETE FROM attio_records WHERE object_slug = 'companies' AND record_id = $1", [companyId]);
  await pool.end();
});

describe('AttioRepository', () => {
  it('stores the call relationship and exposes its transcript as unprocessed', async () => {
    await repository.saveRecord('companies', {
      id: { workspace_id: 'workspace', record_id: companyId }, values: { name: [{ value: 'Customer' }] }
    });
    const databaseMeetingId = await repository.saveMeeting({
      id: { workspace_id: 'workspace', meeting_id: meetingId },
      title: 'Customer call',
      end: { datetime: new Date().toISOString() },
      linked_records: [{ object_slug: 'companies', record_id: companyId }]
    });
    await repository.saveRecording(databaseMeetingId, {
      id: { workspace_id: 'workspace', meeting_id: meetingId, call_recording_id: recordingId },
      status: 'completed'
    });
    await repository.saveTranscript(recordingId, {
      transcript: [{ speaker: { name: 'Customer' }, speech: 'Next steps' }],
      raw_transcript: 'Customer: Next steps'
    });

    const result = await pool.query(
      `SELECT recording.processing_status, recording.raw_transcript, link.object_slug, link.record_id
       FROM attio_call_recordings recording
       JOIN attio_meetings meeting ON meeting.id = recording.meeting_id
       JOIN attio_meeting_record_links link ON link.meeting_id = meeting.id
       WHERE recording.call_recording_id = $1`,
      [recordingId]
    );
    expect(result.rows).toEqual([{
      processing_status: 'unprocessed',
      raw_transcript: 'Customer: Next steps',
      object_slug: 'companies',
      record_id: companyId
    }]);
  });
});
