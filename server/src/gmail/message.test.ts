import { describe, expect, it } from 'vitest';
import { extractBody, parseMessage, splitAddresses } from './message.js';

const encode = (value: string): string => Buffer.from(value).toString('base64url');

describe('Gmail MIME parsing', () => {
  it('prefers plain text and retains HTML', () => {
    const result = extractBody({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: encode('Hallo Welt') } },
        { mimeType: 'text/html', body: { data: encode('<p>Hallo <b>Welt</b></p>') } }
      ]
    });
    expect(result).toEqual({ text: 'Hallo Welt', html: '<p>Hallo <b>Welt</b></p>' });
  });

  it('converts HTML when no plain part exists', () => {
    expect(extractBody({ mimeType: 'text/html', body: { data: encode('<p>Hello<br>world</p>') } }).text)
      .toContain('Hello');
  });

  it('parses direction, thread, headers, and recipients', () => {
    const message = parseMessage({
      id: 'm1', threadId: 't1', historyId: '42', internalDate: '1700000000000',
      labelIds: ['SENT'], snippet: 'Hi',
      payload: {
        mimeType: 'text/plain', body: { data: encode('Antwort') },
        headers: [
          { name: 'From', value: 'Niels <niels@songpush.com>' },
          { name: 'To', value: '"Doe, Jane" <jane@example.com>, john@example.com' },
          { name: 'Subject', value: 'Re: Angebot' }
        ]
      }
    });
    expect(message.direction).toBe('outbound');
    expect(message.threadExternalId).toBe('t1');
    expect(message.recipients).toEqual(['"Doe, Jane" <jane@example.com>', 'john@example.com']);
    expect(message.bodyText).toBe('Antwort');
  });

  it('splits address lists without splitting quoted names', () => {
    expect(splitAddresses('"Doe, Jane" <jane@example.com>, john@example.com')).toHaveLength(2);
  });
});
