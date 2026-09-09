import { describe, expect, it, vi } from 'vitest';
import { HttpAttioClient } from './client.js';

const response = (body: unknown): Response => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' }
});

describe('HttpAttioClient', () => {
  it('queries records with offset pagination and bearer auth', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [] }));
    const client = new HttpAttioClient('secret', 'https://attio.test/v2', request);
    await client.listRecords('companies', 500);
    expect(request).toHaveBeenCalledWith(
      'https://attio.test/v2/objects/companies/records/query',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ limit: 500, offset: 500 }),
        headers: expect.objectContaining({ Authorization: 'Bearer secret' })
      })
    );
  });

  it('combines cursor-paginated transcript segments', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        data: { transcript: [{ speech: 'Hello' }], raw_transcript: 'Hello world' },
        pagination: { next_cursor: 'next' }
      }))
      .mockResolvedValueOnce(response({
        data: { transcript: [{ speech: 'world' }], web_url: 'https://attio.test/transcript' },
        pagination: { next_cursor: null }
      }));
    const transcript = await new HttpAttioClient('secret', 'https://attio.test/v2', request)
      .getTranscript('meeting', 'recording');
    expect(transcript.transcript.map(({ speech }) => speech)).toEqual(['Hello', 'world']);
    expect(transcript.raw_transcript).toBe('Hello world');
  });
});
