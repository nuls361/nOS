import { describe, expect, it, vi } from 'vitest';
import { createRawEmail, GoogleGmailClient } from './google-client.js';

describe('Gmail sending', () => {
  it('builds an RFC reply with safe threading headers', () => {
    const decoded = Buffer.from(createRawEmail({
      from: 'niels@songpush.com', to: ['kunde@example.com'], subject: 'Re: Grüße', body: 'Hallo\nWelt',
      inReplyTo: '<incoming@example.com>', references: '<first@example.com> <incoming@example.com>'
    }), 'base64url').toString('utf8');
    expect(decoded).toContain('From: niels@songpush.com\r\n');
    expect(decoded).toContain('In-Reply-To: <incoming@example.com>\r\n');
    expect(decoded).toContain('References: <first@example.com> <incoming@example.com>\r\n');
    expect(decoded).toContain('\r\n\r\nHallo\r\nWelt');
  });

  it('sends raw MIME in the supplied Gmail thread', async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: 'sent-id', threadId: 'thread-id' } });
    const client = new GoogleGmailClient({ users: { messages: { send } } } as never, 'niels@songpush.com');
    await expect(client.send({
      to: ['kunde@example.com'], subject: 'Antwort', body: 'Hallo', threadId: 'thread-id',
      inReplyTo: '<incoming@example.com>', references: '<incoming@example.com>'
    })).resolves.toEqual({ messageId: 'sent-id', threadId: 'thread-id' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'me', requestBody: expect.objectContaining({ threadId: 'thread-id', raw: expect.any(String) })
    }));
  });
});
