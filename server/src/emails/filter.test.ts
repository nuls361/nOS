import { describe, expect, it } from 'vitest';
import { isRelevantExternalHumanMail } from './filter.js';
import type { EmailWorkItem } from './types.js';

const mail = (overrides: Partial<EmailWorkItem> = {}): EmailWorkItem => ({
  messageDatabaseId: 'db-message',
  messageExternalId: 'gmail-message',
  threadId: 'thread',
  sender: 'Karla Kunde <karla@example.com>',
  recipients: ['niels@songpush.com'],
  cc: [],
  subject: 'Kurze Frage',
  body: 'Können wir morgen sprechen?',
  headers: {},
  labelIds: ['INBOX'],
  sentAt: new Date(),
  ...overrides
});

describe('external human mail filter', () => {
  it('accepts an external human email', () => {
    expect(isRelevantExternalHumanMail(mail())).toBe(true);
  });

  it.each([
    { sender: 'Team <person@songpush.com>' },
    { sender: 'Updates <no-reply@example.com>' },
    { sender: 'News <newsletter@example.com>' },
    { headers: { 'list-unsubscribe': '<https://example.com/unsubscribe>' } },
    { headers: { 'Auto-Submitted': 'auto-replied' } },
    { body: '   ' }
  ])('rejects irrelevant or automated mail: %j', (override) => {
    expect(isRelevantExternalHumanMail(mail(override))).toBe(false);
  });
});
