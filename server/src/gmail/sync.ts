import { parseMessage } from './message.js';
import type { GmailRepository } from './repository.js';
import type { GmailClient } from './types.js';

type GmailStore = Pick<GmailRepository, 'saveMessage' | 'getHistoryId' | 'saveSyncState'>;

const twelveMonthsAgo = (): string => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10).replace(/-/g, '/');
};

const mapWithConcurrency = async <T>(values: T[], limit: number, task: (value: T) => Promise<void>): Promise<void> => {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const value = values[cursor];
      cursor += 1;
      if (value !== undefined) await task(value);
    }
  }));
};

const isExpiredHistory = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: number; response?: { status?: number } };
  return candidate.code === 404 || candidate.response?.status === 404;
};

export class GmailSync {
  constructor(private readonly client: GmailClient, private readonly repository: GmailStore) {}

  private async saveMessages(ids: string[]): Promise<number> {
    const uniqueIds = [...new Set(ids)];
    await mapWithConcurrency(uniqueIds, 10, async (id) => {
      const message = parseMessage(await this.client.getMessage(id));
      await this.repository.saveMessage(message);
    });
    return uniqueIds.length;
  }

  async full(): Promise<{ mode: 'full'; messages: number; historyId: string }> {
    // Den History-Cursor VOR dem Listing festhalten: Nachrichten, die während des
    // Backfills eintreffen, würden sonst weder im Listing noch im späteren
    // History-Delta auftauchen. Ein zu früher Cursor kostet nur Duplikate (Upsert).
    const profile = await this.client.getProfile();
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.client.listMessages(
        `after:${twelveMonthsAgo()} -in:chats -in:drafts -in:spam -in:trash`,
        pageToken
      );
      ids.push(...page.items.map(({ id }) => id));
      pageToken = page.nextPageToken;
    } while (pageToken);

    const messages = await this.saveMessages(ids);
    await this.repository.saveSyncState(profile.emailAddress, profile.historyId, true);
    return { mode: 'full', messages, historyId: profile.historyId };
  }

  async incremental(): Promise<{ mode: 'incremental' | 'full'; messages: number; historyId: string }> {
    const profile = await this.client.getProfile();
    const startHistoryId = await this.repository.getHistoryId(profile.emailAddress);
    if (!startHistoryId) return this.full();

    try {
      const ids: string[] = [];
      let historyId = startHistoryId;
      let pageToken: string | undefined;
      do {
        const page = await this.client.listAddedMessageIds(startHistoryId, pageToken);
        ids.push(...page.items);
        historyId = page.historyId ?? historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
      const messages = await this.saveMessages(ids);
      await this.repository.saveSyncState(profile.emailAddress, historyId, false);
      return { mode: 'incremental', messages, historyId };
    } catch (error) {
      if (isExpiredHistory(error)) return this.full();
      throw error;
    }
  }
}
