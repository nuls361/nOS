import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { CallCardRepository } from './repository.js';
import type { CallCardProposal } from './types.js';

const pool = createPool();
const repository = new CallCardRepository(pool);
const meetingId = randomUUID();
const recordingId = randomUUID();
let databaseMeetingId: string;

beforeAll(async () => {
  await migrate();
  const meeting = await pool.query<{ id: string }>(
    `INSERT INTO attio_meetings
      (workspace_id, meeting_id, title, participants, linked_records, raw)
     VALUES ('workspace', $1, 'Launch call', $2, $3, '{}') RETURNING id`,
    [meetingId, JSON.stringify([{ email_address: 'customer@example.com' }]),
      JSON.stringify([{ object_slug: 'deals', record_id: 'deal-1' }])]
  );
  databaseMeetingId = meeting.rows[0]?.id ?? '';
  await pool.query(
    `INSERT INTO attio_meeting_record_links (meeting_id, object_slug, record_id)
     VALUES ($1, 'deals', 'deal-1')`, [databaseMeetingId]
  );
  await pool.query(
    `INSERT INTO attio_call_recordings
      (meeting_id, call_recording_id, status, raw_transcript, transcript_segments,
       transcript_fetched_at, processing_status, raw)
     VALUES ($1, $2, 'completed', 'Customer: Please send next steps', '[]', now(), 'unprocessed', '{}')`,
    [databaseMeetingId, recordingId]
  );
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM cards WHERE source_type = 'attio_call_recording' AND source_id = $1",
    [recordingId]
  );
  await pool.query('DELETE FROM attio_meetings WHERE id = $1', [databaseMeetingId]);
  await pool.end();
});

describe('CallCardRepository', () => {
  it('atomically creates separately reviewable actions and never duplicates a card', async () => {
    const claimed = await repository.claimNext();
    expect(claimed).toEqual(expect.objectContaining({
      callRecordingId: recordingId,
      linkedRecords: [{ objectSlug: 'deals', recordId: 'deal-1' }]
    }));
    if (!claimed) throw new Error('Expected claimed call');
    const source = `call:${recordingId}`;
    const proposal: CallCardProposal = {
      summary: 'Next steps agreed',
      followUpEmail: {
        to: ['customer@example.com'], subject: 'Next steps', body: 'Hello',
        citations: [{ sourceId: source, reason: 'Call agreement' }]
      },
      attioUpdates: [{
        objectSlug: 'deals', recordId: 'deal-1', field: 'status', currentValue: 'open',
        proposedValue: 'won', rationale: 'Agreed in call', citations: [{ sourceId: source, reason: 'Agreement' }]
      }],
      delegation: {
        to: 'Lina', subject: 'Briefing', body: 'Please follow up',
        citations: [{ sourceId: source, reason: 'Owner named in call' }]
      },
      task: {
        title: 'Send assets', description: 'Send approved assets', assignee: 'Lina', dueDate: null,
        objectSlug: 'deals', recordId: 'deal-1', citations: [{ sourceId: source, reason: 'Next step' }]
      }
    };
    const created = await repository.createCard(claimed, proposal);
    expect(created).toEqual(expect.objectContaining({ actionCount: 4, existing: false }));

    const actions = await pool.query<{ type: string; status: string }>(
      'SELECT type, status FROM actions WHERE card_id = $1 ORDER BY type', [created.cardId]
    );
    expect(actions.rows).toEqual([
      { type: 'attio_task', status: 'pending' },
      { type: 'attio_update', status: 'pending' },
      { type: 'gmail_forward', status: 'pending' },
      { type: 'gmail_send', status: 'pending' }
    ]);
    expect(await repository.createCard(claimed, proposal)).toEqual({
      cardId: created.cardId, actionCount: 0, existing: true
    });
  });
});
