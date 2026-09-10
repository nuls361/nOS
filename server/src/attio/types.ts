export interface AttioId {
  workspace_id: string;
  meeting_id?: string;
  call_recording_id?: string;
  record_id?: string;
}

export interface AttioRecord {
  id: AttioId;
  values: Record<string, unknown>;
  web_url?: string | null;
  created_at?: string | null;
}

export interface AttioLinkedRecord {
  object_slug: string;
  object_id?: string;
  record_id: string;
}

export interface AttioMeeting {
  id: AttioId & { meeting_id: string };
  title?: string | null;
  description?: string | null;
  start?: { datetime?: string | null; timezone?: string | null } | null;
  end?: { datetime?: string | null; timezone?: string | null } | null;
  participants?: Array<Record<string, unknown>> | null;
  linked_records?: AttioLinkedRecord[] | null;
  [key: string]: unknown;
}

export interface AttioCallRecording {
  id: AttioId & { meeting_id: string; call_recording_id: string };
  status: string;
  web_url?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface AttioTranscriptSegment {
  speech: string;
  start_time?: number | null;
  end_time?: number | null;
  speaker?: { name?: string | null } | null;
}

export interface AttioTranscript {
  transcript: AttioTranscriptSegment[];
  raw_transcript?: string | null;
  web_url?: string | null;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface AttioClient {
  listRecords(objectSlug: 'companies' | 'deals', offset: number): Promise<AttioRecord[]>;
  listMeetings(filters: { endsFrom: string; startsBefore: string }, cursor?: string): Promise<CursorPage<AttioMeeting>>;
  listCallRecordings(meetingId: string, cursor?: string): Promise<CursorPage<AttioCallRecording>>;
  getTranscript(meetingId: string, recordingId: string): Promise<AttioTranscript>;
}
