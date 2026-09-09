export interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

export interface GmailPart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
}

export interface GmailMessage {
  id?: string | null;
  threadId?: string | null;
  historyId?: string | null;
  internalDate?: string | null;
  labelIds?: string[] | null;
  snippet?: string | null;
  payload?: (GmailPart & { headers?: GmailHeader[] | null }) | null;
}

export interface GmailPage<T> {
  items: T[];
  nextPageToken?: string;
  historyId?: string;
}

export interface GmailClient {
  getProfile(): Promise<{ emailAddress: string; historyId: string }>;
  listMessages(query: string, pageToken?: string): Promise<GmailPage<{ id: string }>>;
  getMessage(id: string): Promise<GmailMessage>;
  listAddedMessageIds(startHistoryId: string, pageToken?: string): Promise<GmailPage<string>>;
}
