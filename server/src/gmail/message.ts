import { convert } from 'html-to-text';
import type { GmailHeader, GmailMessage, GmailPart } from './types.js';

const decodeBase64Url = (value: string): string =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

const collectBodies = (part: GmailPart | null | undefined, bodies: { plain: string[]; html: string[] }): void => {
  if (!part) return;
  const data = part.body?.data;
  if (data && part.mimeType === 'text/plain') bodies.plain.push(decodeBase64Url(data));
  if (data && part.mimeType === 'text/html') bodies.html.push(decodeBase64Url(data));
  for (const child of part.parts ?? []) collectBodies(child, bodies);
};

export const extractBody = (payload: GmailPart | null | undefined): { text: string; html?: string } => {
  const bodies = { plain: [] as string[], html: [] as string[] };
  collectBodies(payload, bodies);
  const html = bodies.html.join('\n').trim();
  const text = bodies.plain.join('\n').trim() || (html ? convert(html, { wordwrap: false }) : '');
  return html ? { text, html } : { text };
};

const headerMap = (headers: GmailHeader[] | null | undefined): Map<string, string> =>
  new Map((headers ?? []).flatMap(({ name, value }) => name && value ? [[name.toLowerCase(), value]] : []));

export const splitAddresses = (value = ''): string[] => {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angleDepth = 0;
  for (const character of value) {
    if (character === '"') quoted = !quoted;
    if (!quoted && character === '<') angleDepth += 1;
    if (!quoted && character === '>') angleDepth = Math.max(0, angleDepth - 1);
    if (character === ',' && !quoted && angleDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

export interface ParsedMessage {
  externalId: string;
  threadExternalId: string;
  historyId?: string;
  direction: 'inbound' | 'outbound';
  sender: string;
  recipients: string[];
  cc: string[];
  subject?: string;
  bodyText: string;
  bodyHtml?: string;
  sentAt: Date;
  headers: Record<string, string>;
  labelIds: string[];
  snippet?: string;
}

export const parseMessage = (message: GmailMessage): ParsedMessage => {
  if (!message.id || !message.threadId || !message.internalDate) {
    throw new Error('Gmail message lacks id, threadId, or internalDate');
  }
  const headers = headerMap(message.payload?.headers);
  const body = extractBody(message.payload);
  const result: ParsedMessage = {
    externalId: message.id,
    threadExternalId: message.threadId,
    direction: message.labelIds?.includes('SENT') ? 'outbound' : 'inbound',
    sender: headers.get('from') ?? '',
    recipients: splitAddresses(headers.get('to')),
    cc: splitAddresses(headers.get('cc')),
    bodyText: body.text,
    sentAt: new Date(Number(message.internalDate)),
    headers: Object.fromEntries(headers),
    labelIds: message.labelIds ?? []
  };
  const historyId = message.historyId ?? undefined;
  const subject = headers.get('subject');
  const snippet = message.snippet ?? undefined;
  if (historyId) result.historyId = historyId;
  if (subject) result.subject = subject;
  if (body.html) result.bodyHtml = body.html;
  if (snippet) result.snippet = snippet;
  return result;
};
