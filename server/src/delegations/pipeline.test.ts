import { describe, expect, it, vi } from 'vitest';
import type { EmailWorkItem } from '../emails/types.js';
import { DelegationPipeline } from './pipeline.js';

const mail = (sender = 'Campaign Partner <partner@example.com>'): EmailWorkItem => ({
  messageDatabaseId: 'mail-db', messageExternalId: 'gmail-8', threadId: 'thread-db',
  threadExternalId: 'gmail-thread', sender,
  recipients: ['niels@songpush.com'], cc: [], subject: 'Campaign assets needed',
  body: 'Can you coordinate the missing assets?', headers: {}, labelIds: ['INBOX'], sentAt: new Date()
});
const proposal = {
  shouldDelegate: true as const,
  colleague: 'Lina' as const,
  reason: 'Lina owns campaign coordination in prior forwards.',
  briefingSubject: 'Fwd: Briefing Campaign assets',
  briefingBody: 'Please coordinate the missing assets with the partner.',
  task: null,
  citations: [{ sourceId: 'mail:history', reason: 'Prior routing precedent' }]
};

describe('DelegationPipeline', () => {
  it('creates a card for a positive routing decision', async () => {
    const repository = {
      claimNext: vi.fn().mockResolvedValueOnce(mail()).mockResolvedValueOnce(null),
      createCard: vi.fn().mockResolvedValue({ cardId: 'card', existing: false }),
      markSkipped: vi.fn(), markFailed: vi.fn()
    };
    const generator = { generate: vi.fn().mockResolvedValue(proposal) };
    await expect(new DelegationPipeline(repository, generator).processAll()).resolves.toEqual({ cards: 1, skipped: 0 });
    expect(repository.createCard).toHaveBeenCalledWith(expect.anything(), proposal);
  });

  it('marks a negative decision as skipped', async () => {
    const repository = {
      claimNext: vi.fn().mockResolvedValueOnce(mail()).mockResolvedValueOnce(null), createCard: vi.fn(),
      markSkipped: vi.fn(), markFailed: vi.fn()
    };
    const generator = { generate: vi.fn().mockResolvedValue({ shouldDelegate: false, reason: 'No owner needed', citations: [] }) };
    await expect(new DelegationPipeline(repository, generator).processAll()).resolves.toEqual({ cards: 0, skipped: 1 });
    expect(repository.markSkipped).toHaveBeenCalledWith('mail-db');
  });

  it('filters automatic mail without a model call', async () => {
    const repository = {
      claimNext: vi.fn().mockResolvedValue(mail('No Reply <noreply@example.com>')), createCard: vi.fn(),
      markSkipped: vi.fn(), markFailed: vi.fn()
    };
    const generator = { generate: vi.fn() };
    await expect(new DelegationPipeline(repository, generator).processNext()).resolves.toBe('skipped');
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('records model failures', async () => {
    const error = new Error('routing failed');
    const repository = {
      claimNext: vi.fn().mockResolvedValue(mail()), createCard: vi.fn(), markSkipped: vi.fn(), markFailed: vi.fn()
    };
    const generator = { generate: vi.fn().mockRejectedValue(error) };
    await expect(new DelegationPipeline(repository, generator).processNext()).rejects.toThrow('routing failed');
    expect(repository.markFailed).toHaveBeenCalledWith('mail-db', error);
  });
});
