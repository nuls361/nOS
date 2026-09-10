import { describe, expect, it, vi } from 'vitest';
import { PlaybookMiningPipeline } from './pipeline.js';
import type { MiningSource, PlaybookProposal } from './types.js';

const source: MiningSource = {
  sourceType: 'reply_pair', sourceId: 'in:out', subject: 'Payment terms',
  question: 'Can we pay by invoice?', answer: 'Yes, net 30 after approval.', existingEntries: []
};

describe('PlaybookMiningPipeline', () => {
  it('turns reusable answers into review cards and records skipped examples', async () => {
    const sources = [source, { ...source, sourceId: 'in-2:out-2' }];
    const proposals: PlaybookProposal[] = [
      { shouldUpdate: true, reason: 'Reusable', slug: 'payment-terms', title: 'Payment terms', markdown: '# Payment terms' },
      { shouldUpdate: false, reason: 'Customer-specific', slug: null, title: null, markdown: null }
    ];
    const repository = {
      nextSource: vi.fn().mockImplementation(async () => sources.shift() ?? null),
      saveOutcome: vi.fn().mockImplementation(async (_source, proposal: PlaybookProposal) =>
        proposal.shouldUpdate ? 'proposed' : 'skipped')
    };
    const generator = { generate: vi.fn().mockImplementation(async () => proposals.shift()) };

    await expect(new PlaybookMiningPipeline(repository, generator).processAll()).resolves
      .toEqual({ proposed: 1, skipped: 1 });
    expect(repository.saveOutcome).toHaveBeenCalledTimes(2);
  });
});
