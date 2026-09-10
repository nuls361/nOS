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
      savePollTime: vi.fn().mockResolvedValue(undefined),
      getPollTime: vi.fn().mockResolvedValue(null)
    };

    const result = await new AttioSync(client, repository).run(new Date('2026-09-09T12:00:00Z'));

    expect(result).toEqual({ meetings: 1, recordings: 1, transcripts: 1 });
    // Der 15-Minuten-Lauf fasst die 40k+ Companies nicht an.
    expect(client.listRecords).not.toHaveBeenCalled();
    expect(repository.saveTranscript).toHaveBeenCalledWith('recording', {
      transcript: [{ speech: 'Next steps' }]
    });
    expect(repository.savePollTime).toHaveBeenCalledOnce();
  });

  it('starts the window at the last poll instead of the fixed lookback', async () => {
    const client: AttioClient = {
      listRecords: vi.fn(),
      listMeetings: vi.fn().mockResolvedValue({ items: [] }),
      listCallRecordings: vi.fn(),
      getTranscript: vi.fn()
    };
    const repository = {
      saveRecord: vi.fn(), saveMeeting: vi.fn(), saveRecording: vi.fn(),
      needsTranscript: vi.fn(), saveTranscript: vi.fn(), savePollTime: vi.fn(),
      getPollTime: vi.fn().mockResolvedValue(new Date('2026-09-09T11:00:00Z'))
    };

    await new AttioSync(client, repository).run(new Date('2026-09-09T12:00:00Z'));

    // 11:00 minus eine Stunde Überlappung — nicht 24 Stunden zurück.
    expect(vi.mocked(client.listMeetings).mock.calls[0]?.[0]).toEqual({
      endsFrom: '2026-09-09T10:00:00.000Z',
      startsBefore: '2026-09-09T12:00:00.000Z'
    });
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
      saveTranscript: vi.fn(), savePollTime: vi.fn(), getPollTime: vi.fn().mockResolvedValue(null)
    };
    await new AttioSync(client, repository).run();
    expect(client.getTranscript).not.toHaveBeenCalled();
  });

  it('syncs CRM records only in the separate records run', async () => {
    const client: AttioClient = {
      listRecords: vi.fn().mockResolvedValue([]),
      listMeetings: vi.fn(), listCallRecordings: vi.fn(), getTranscript: vi.fn()
    };
    const repository = {
      saveRecord: vi.fn(), saveMeeting: vi.fn(), saveRecording: vi.fn(),
      needsTranscript: vi.fn(), saveTranscript: vi.fn(), savePollTime: vi.fn(), getPollTime: vi.fn()
    };

    const result = await new AttioSync(client, repository).syncRecords();

    expect(result).toEqual({ companies: 0, deals: 0 });
    expect(client.listMeetings).not.toHaveBeenCalled();
  });
});
