import type { gmail_v1 } from 'googleapis';
import type { GmailClient, GmailMessage, GmailPage } from './types.js';

export class GoogleGmailClient implements GmailClient {
  constructor(private readonly gmail: gmail_v1.Gmail) {}

  async getProfile(): Promise<{ emailAddress: string; historyId: string }> {
    const { data } = await this.gmail.users.getProfile({ userId: 'me' });
    if (!data.emailAddress || !data.historyId) throw new Error('Gmail profile is incomplete');
    return { emailAddress: data.emailAddress, historyId: data.historyId };
  }

  async listMessages(query: string, pageToken?: string): Promise<GmailPage<{ id: string }>> {
    const params: gmail_v1.Params$Resource$Users$Messages$List = {
      userId: 'me', q: query, maxResults: 500, includeSpamTrash: false
    };
    if (pageToken) params.pageToken = pageToken;
    const { data } = await this.gmail.users.messages.list(params);
    const page: GmailPage<{ id: string }> = {
      items: (data.messages ?? []).flatMap(({ id }) => id ? [{ id }] : [])
    };
    if (data.nextPageToken) page.nextPageToken = data.nextPageToken;
    return page;
  }

  async getMessage(id: string): Promise<GmailMessage> {
    const { data } = await this.gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    return data as GmailMessage;
  }

  async listAddedMessageIds(startHistoryId: string, pageToken?: string): Promise<GmailPage<string>> {
    const params: gmail_v1.Params$Resource$Users$History$List = {
      userId: 'me', startHistoryId, maxResults: 500, historyTypes: ['messageAdded']
    };
    if (pageToken) params.pageToken = pageToken;
    const { data } = await this.gmail.users.history.list(params);
    const page: GmailPage<string> = {
      items: [...new Set((data.history ?? []).flatMap((entry) =>
        (entry.messagesAdded ?? []).flatMap(({ message }) => message?.id ? [message.id] : [])
      ))]
    };
    if (data.nextPageToken) page.nextPageToken = data.nextPageToken;
    if (data.historyId) page.historyId = data.historyId;
    return page;
  }
}
