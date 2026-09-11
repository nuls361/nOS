import { afterEach, describe, expect, it } from 'vitest';
import { authorizeGmail } from './auth.js';

const names = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'] as const;
afterEach(() => names.forEach((name) => { delete process.env[name]; }));

describe('Gmail serverless credentials', () => {
  it('constructs OAuth credentials entirely from environment variables', async () => {
    process.env.GMAIL_CLIENT_ID = 'client-id';
    process.env.GMAIL_CLIENT_SECRET = 'client-secret';
    process.env.GMAIL_REFRESH_TOKEN = 'refresh-token';
    const client = await authorizeGmail();
    expect(client.credentials.refresh_token).toBe('refresh-token');
  });

  it('fails closed when only part of the env credential set exists', async () => {
    process.env.GMAIL_CLIENT_ID = 'client-id';
    await expect(authorizeGmail()).rejects.toThrow('must be set together');
  });
});
