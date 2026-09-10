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

  it('joins raw_transcript across every transcript page', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        data: { transcript: [{ speech: 'eins' }], raw_transcript: 'Teil eins', web_url: 'https://attio.test/call' },
        pagination: { next_cursor: 'seite-2' }
      }))
      .mockResolvedValueOnce(response({
        data: { transcript: [{ speech: 'zwei' }], raw_transcript: 'Teil zwei' },
        pagination: { next_cursor: null }
      }));
    const client = new HttpAttioClient('secret', 'https://attio.test/v2', request);

    const transcript = await client.getTranscript('meeting', 'recording');

    // Attio liefert pro Seite ein eigenes raw_transcript-Stueck; nur die erste
    // Seite zu behalten verliert bei langen Calls den Grossteil des Textes.
    expect(transcript.raw_transcript).toBe('Teil eins\nTeil zwei');
    expect(transcript.transcript).toHaveLength(2);
    expect(transcript.web_url).toBe('https://attio.test/call');
  });

  it('updates one record field with the documented values envelope', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({
      data: { id: { record_id: 'record-1', workspace_id: 'workspace' }, values: {} }
    }));
    const client = new HttpAttioClient('secret', 'https://attio.test/v2', request);
    await expect(client.updateRecord({
      objectSlug: 'companies', recordId: 'record-1', field: 'status', value: 'active'
    })).resolves.toEqual({ recordId: 'record-1' });
    expect(request).toHaveBeenCalledWith(
      'https://attio.test/v2/objects/companies/records/record-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ data: { values: { status: 'active' } } }) })
    );
  });

  it('creates a plaintext task with all required Attio fields', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({
      data: { id: { task_id: 'task-1' } }
    }));
    const client = new HttpAttioClient('secret', 'https://attio.test/v2', request);
    await expect(client.createTask({
      title: 'Follow up', description: 'Contact customer', assigneeId: 'member-1',
      objectSlug: 'companies', recordId: 'record-1'
    })).resolves.toEqual({ taskId: 'task-1' });
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as { data: Record<string, unknown> };
    expect(body.data).toEqual(expect.objectContaining({
      content: 'Follow up\n\nContact customer', format: 'plaintext', deadline_at: null,
      is_completed: false,
      assignees: [{ referenced_actor_type: 'workspace-member', referenced_actor_id: 'member-1' }],
      linked_records: [{ target_object: 'companies', target_record_id: 'record-1' }]
    }));
  });
});
