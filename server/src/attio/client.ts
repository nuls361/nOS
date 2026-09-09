import type {
  AttioCallRecording,
  AttioClient,
  AttioMeeting,
  AttioRecord,
  AttioTranscript,
  AttioTranscriptSegment,
  CursorPage
} from './types.js';

interface AttioEnvelope<T> {
  data: T;
  pagination?: { next_cursor?: string | null };
}

export class AttioApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'AttioApiError';
  }
}

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class HttpAttioClient implements AttioClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.attio.com/v2',
    private readonly request: typeof fetch = fetch
  ) {
    if (!apiKey) throw new Error('ATTIO_API_KEY is required');
  }

  private async call<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<AttioEnvelope<T>> {
    const response = await this.request(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers
      }
    });
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after') ?? 1);
      await delay(Math.max(1, retryAfter) * 1_000);
      return this.call<T>(path, init, attempt + 1);
    }
    if (!response.ok) {
      throw new AttioApiError(response.status, `Attio ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<AttioEnvelope<T>>;
  }

  async listRecords(objectSlug: 'companies' | 'deals', offset: number): Promise<AttioRecord[]> {
    const response = await this.call<AttioRecord[]>(`/objects/${objectSlug}/records/query`, {
      method: 'POST', body: JSON.stringify({ limit: 500, offset })
    });
    return response.data;
  }

  async listMeetings(
    filters: { endsFrom: string; startsBefore: string },
    cursor?: string
  ): Promise<CursorPage<AttioMeeting>> {
    const params = new URLSearchParams({
      limit: '200', sort: 'start_asc', ends_from: filters.endsFrom, starts_before: filters.startsBefore
    });
    if (cursor) params.set('cursor', cursor);
    const response = await this.call<AttioMeeting[]>(`/meetings?${params}`);
    const page: CursorPage<AttioMeeting> = { items: response.data };
    if (response.pagination?.next_cursor) page.nextCursor = response.pagination.next_cursor;
    return page;
  }

  async listCallRecordings(meetingId: string, cursor?: string): Promise<CursorPage<AttioCallRecording>> {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('cursor', cursor);
    const response = await this.call<AttioCallRecording[]>(
      `/meetings/${encodeURIComponent(meetingId)}/call_recordings?${params}`
    );
    const page: CursorPage<AttioCallRecording> = { items: response.data };
    if (response.pagination?.next_cursor) page.nextCursor = response.pagination.next_cursor;
    return page;
  }

  async getTranscript(meetingId: string, recordingId: string): Promise<AttioTranscript> {
    const segments: AttioTranscriptSegment[] = [];
    let rawTranscript: string | undefined;
    let webUrl: string | undefined;
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      const suffix = params.size ? `?${params}` : '';
      const response = await this.call<AttioTranscript>(
        `/meetings/${encodeURIComponent(meetingId)}/call_recordings/${encodeURIComponent(recordingId)}/transcript${suffix}`
      );
      segments.push(...response.data.transcript);
      rawTranscript ??= response.data.raw_transcript ?? undefined;
      webUrl ??= response.data.web_url ?? undefined;
      cursor = response.pagination?.next_cursor ?? undefined;
    } while (cursor);
    const result: AttioTranscript = { transcript: segments };
    if (rawTranscript) result.raw_transcript = rawTranscript;
    if (webUrl) result.web_url = webUrl;
    return result;
  }
}
