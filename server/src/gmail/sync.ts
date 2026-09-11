import { parseMessage } from './message.js';
import type { GmailRepository } from './repository.js';
import type { GmailClient } from './types.js';

type GmailStore = Pick<GmailRepository,
  'saveMessage' | 'getHistoryId' | 'saveSyncState' | 'getBackfillState' | 'saveBackfillState'>;

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

  async backfillBatch(maxPages = 1): Promise<{
    mode: 'backfill'; messages: number; complete: boolean; nextPageToken: string | null;
  }> {
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) throw new Error('maxPages must be 1..10');
    const profile = await this.client.getProfile();
    const saved = await this.repository.getBackfillState(profile.emailAddress);
    if (saved?.completed) return { mode: 'backfill', messages: 0, complete: true, nextPageToken: null };
    const initialHistoryId = saved?.initialHistoryId ?? profile.historyId;
    let pageToken = saved?.pageToken ?? undefined;
    let messages = 0;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await this.client.listMessages(
        `after:${twelveMonthsAgo()} -in:chats -in:drafts -in:spam -in:trash`, pageToken
      );
      messages += await this.saveMessages(page.items.map(({ id }) => id));
      pageToken = page.nextPageToken;
      const complete = !pageToken;
      await this.repository.saveBackfillState(
        profile.emailAddress, initialHistoryId, pageToken ?? null, complete
      );
      if (complete) {
        await this.repository.saveSyncState(profile.emailAddress, initialHistoryId, true);
        return { mode: 'backfill', messages, complete: true, nextPageToken: null };
      }
    }
    return { mode: 'backfill', messages, complete: false, nextPageToken: pageToken ?? null };
  }

  async incremental(): Promise<
    { mode: 'incremental' | 'full'; messages: number; historyId: string }
    | { mode: 'backfill'; messages: number; complete: boolean; nextPageToken: string | null }
  > {
    const profile = await this.client.getProfile();
    const startHistoryId = await this.repository.getHistoryId(profile.emailAddress);
    if (!startHistoryId) return this.backfillBatch();

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
      if (isExpiredHistory(error)) {
        await this.repository.saveBackfillState(profile.emailAddress, profile.historyId, null, false);
        return this.backfillBatch();
      }
      throw error;
    }
  }
}
