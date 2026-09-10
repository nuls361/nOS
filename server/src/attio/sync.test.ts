import { describe, expect, it, vi } from 'vitest';
import { AttioSync } from './sync.js';
import type { AttioClient, AttioMeeting } from './types.js';

const meeting: AttioMeeting = {
  id: { workspace_id: 'workspace', meeting_id: 'meeting' },
  title: 'Customer call',
  linked_records: [{ object_slug: 'companies', record_id: 'company' }]
};

describe('AttioSync', () => {
  it('syncs records and turns completed recordings into unprocessed transcripts', async () => {
    const client: AttioClient = {
      listRecords: vi.fn().mockResolvedValue([]),
      listMeetings: vi.fn().mockResolvedValue({ items: [meeting] }),
      listCallRecordings: vi.fn().mockResolvedValue({ items: [{
        id: { workspace_id: 'workspace', meeting_id: 'meeting', call_recording_id: 'recording' },
        status: 'completed'
      }] }),
      getTranscript: vi.fn().mockResolvedValue({ transcript: [{ speech: 'Next steps' }] })
    };
    const repository = {
      saveRecord: vi.fn().mockResolvedValue(undefined),
      saveMeeting: vi.fn().mockResolvedValue('database-meeting'),
      saveRecording: vi.fn().mockResolvedValue(undefined),
      needsTranscript: vi.fn().mockResolvedValue(true),
      saveTranscript: vi.fn().mockResolvedValue(undefined),
      savePollTime: vi.fn().mockResolvedValue(undefined)
    };

    const result = await new AttioSync(client, repository).run(new Date('2026-09-09T12:00:00Z'));

    expect(result).toEqual({ companies: 0, deals: 0, meetings: 1, recordings: 1, transcripts: 1 });
    expect(repository.saveTranscript).toHaveBeenCalledWith('recording', {
      transcript: [{ speech: 'Next steps' }]
    });
    expect(repository.savePollTime).toHaveBeenCalledOnce();
  });

  it('does not fetch transcripts twice', async () => {
    const client: AttioClient = {
      listRecords: vi.fn().mockResolvedValue([]),
      listMeetings: vi.fn().mockResolvedValue({ items: [meeting] }),
      listCallRecordings: vi.fn().mockResolvedValue({ items: [{
        id: { workspace_id: 'workspace', meeting_id: 'meeting', call_recording_id: 'recording' },
        status: 'completed'
      }] }),
      getTranscript: vi.fn()
    };
    const repository = {
      saveRecord: vi.fn(), saveMeeting: vi.fn().mockResolvedValue('database-meeting'),
      saveRecording: vi.fn(), needsTranscript: vi.fn().mockResolvedValue(false),
      saveTranscript: vi.fn(), savePollTime: vi.fn()
    };
    await new AttioSync(client, repository).run();
    expect(client.getTranscript).not.toHaveBeenCalled();
  });
});
