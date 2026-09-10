import { describe, expect, it, vi } from 'vitest';
import { CallCardPipeline } from './pipeline.js';
import type { CallWorkItem } from './types.js';

const workItem: CallWorkItem = {
  recordingDatabaseId: 'database-recording', callRecordingId: 'recording', meetingId: 'meeting',
  meetingTitle: 'Customer call', participants: [], linkedRecords: [], rawTranscript: 'Next steps',
  transcriptSegments: []
};

const proposal = {
  summary: 'Agreed next steps',
  followUpEmail: { to: ['customer@example.com'], subject: 'Next steps', body: 'Hello', citations: [] },
  attioUpdates: [], delegation: null, task: null
};

describe('CallCardPipeline', () => {
  it('generates one card from a claimed transcript', async () => {
    const repository = {
      claimNext: vi.fn().mockResolvedValueOnce(workItem).mockResolvedValueOnce(null),
      createCard: vi.fn().mockResolvedValue({ cardId: 'card', actionCount: 1, existing: false }),
      markFailed: vi.fn()
    };
    const generator = { generate: vi.fn().mockResolvedValue(proposal) };
    await expect(new CallCardPipeline(repository, generator).processAll()).resolves.toEqual({ cards: 1, actions: 1 });
    expect(repository.createCard).toHaveBeenCalledWith(workItem, proposal);
  });

  it('marks the recording failed when generation fails', async () => {
    const error = new Error('model unavailable');
    const repository = {
      claimNext: vi.fn().mockResolvedValue(workItem), createCard: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(undefined)
    };
    const pipeline = new CallCardPipeline(repository, { generate: vi.fn().mockRejectedValue(error) });
    await expect(pipeline.processNext()).rejects.toThrow('model unavailable');
    expect(repository.markFailed).toHaveBeenCalledWith('database-recording', error);
  });
});
