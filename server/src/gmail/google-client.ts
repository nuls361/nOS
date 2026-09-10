import type { gmail_v1 } from 'googleapis';
import type { GmailClient, GmailMessage, GmailPage } from './types.js';

const safeHeader = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();
const encodedSubject = (value: string): string =>
  `=?UTF-8?B?${Buffer.from(safeHeader(value), 'utf8').toString('base64')}?=`;

export const createRawEmail = (input: {
  from: string; to: string[]; subject: string; body: string; inReplyTo?: string; references?: string;
}): string => {
  const headers = [
    `From: ${safeHeader(input.from)}`,
    `To: ${input.to.map(safeHeader).join(', ')}`,
    `Subject: ${encodedSubject(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    ...(input.inReplyTo ? [`In-Reply-To: ${safeHeader(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${safeHeader(input.references)}`] : [])
  ];
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${input.body.replace(/\r?\n/g, '\r\n')}`, 'utf8')
    .toString('base64url');
};

export class GoogleGmailClient implements GmailClient {
  constructor(
    private readonly gmail: gmail_v1.Gmail,
    private readonly accountEmail = process.env.GMAIL_ACCOUNT_EMAIL ?? 'niels@songpush.com'
  ) {}

  async send(input: {
    to: string[]; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string;
  }): Promise<{ messageId: string; threadId?: string }> {
    if (!input.to.length) throw new Error('At least one Gmail recipient is required');
    const { data } = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: createRawEmail({ from: this.accountEmail, ...input }),
        ...(input.threadId ? { threadId: input.threadId } : {})
      }
    });
    if (!data.id) throw new Error('Gmail send response lacks message ID');
    return { messageId: data.id, ...(data.threadId ? { threadId: data.threadId } : {}) };
  }

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
