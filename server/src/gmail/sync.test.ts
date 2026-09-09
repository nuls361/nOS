import { describe, expect, it, vi } from 'vitest';
import { GmailSync } from './sync.js';
import type { ParsedMessage } from './message.js';
import type { GmailClient, GmailMessage } from './types.js';

const gmailMessage = (id: string): GmailMessage => ({
  id,
  threadId: `thread-${id}`,
  historyId: '20',
  internalDate: '1700000000000',
  labelIds: ['INBOX'],
  payload: {
    mimeType: 'text/plain',
    body: { data: Buffer.from(`body-${id}`).toString('base64url') },
    headers: [{ name: 'From', value: 'customer@example.com' }]
  }
});

const store = (historyId: string | null) => ({
  saveMessage: vi.fn<(message: ParsedMessage) => Promise<void>>().mockResolvedValue(undefined),
  getHistoryId: vi.fn<() => Promise<string | null>>().mockResolvedValue(historyId),
  saveSyncState: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
});

const client = (): GmailClient => ({
  getProfile: vi.fn().mockResolvedValue({ emailAddress: 'niels@songpush.com', historyId: '20' }),
  listMessages: vi.fn().mockResolvedValue({ items: [] }),
  getMessage: vi.fn<(id: string) => Promise<GmailMessage>>().mockImplementation(async (id) => gmailMessage(id)),
  listAddedMessageIds: vi.fn().mockResolvedValue({ items: [], historyId: '20' })
});

describe('GmailSync', () => {
  it('paginates full sync, deduplicates IDs, and stores the latest history ID', async () => {
    const api = client();
    vi.mocked(api.listMessages)
      .mockResolvedValueOnce({ items: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'next' })
      .mockResolvedValueOnce({ items: [{ id: 'b' }, { id: 'c' }] });
    const repository = store(null);

    const result = await new GmailSync(api, repository).full();

    expect(vi.mocked(api.listMessages).mock.calls[0]?.[0]).toContain('-in:trash');

    expect(result).toEqual({ mode: 'full', messages: 3, historyId: '20' });
    expect(api.getMessage).toHaveBeenCalledTimes(3);
    expect(repository.saveMessage).toHaveBeenCalledTimes(3);
    expect(repository.saveSyncState).toHaveBeenCalledWith('niels@songpush.com', '20', true);
    // Cursor stammt aus dem Profilabruf VOR dem Listing (nur ein Aufruf nötig).
    expect(api.getProfile).toHaveBeenCalledOnce();
  });

  it('uses history for incremental sync', async () => {
    const api = client();
    vi.mocked(api.listAddedMessageIds).mockResolvedValue({ items: ['new-message'], historyId: '21' });
    const repository = store('20');

    const result = await new GmailSync(api, repository).incremental();

    expect(result).toEqual({ mode: 'incremental', messages: 1, historyId: '21' });
    expect(api.listAddedMessageIds).toHaveBeenCalledWith('20', undefined);
    expect(repository.saveSyncState).toHaveBeenCalledWith('niels@songpush.com', '21', false);
  });

  it('falls back to full sync when Gmail history has expired', async () => {
    const api = client();
    vi.mocked(api.listAddedMessageIds).mockRejectedValue({ response: { status: 404 } });
    vi.mocked(api.listMessages).mockResolvedValue({ items: [{ id: 'fresh' }] });
    const repository = store('old-history');

    const result = await new GmailSync(api, repository).incremental();

    expect(result.mode).toBe('full');
    expect(api.listMessages).toHaveBeenCalledOnce();
  });
});
