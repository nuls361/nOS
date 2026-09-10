CREATE TABLE attio_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  object_slug text NOT NULL,
  record_id text NOT NULL,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  web_url text,
  source_created_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_slug, record_id)
);

CREATE INDEX attio_records_object_idx ON attio_records (object_slug, synced_at DESC);

CREATE TABLE attio_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  meeting_id text NOT NULL UNIQUE,
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attio_meetings_end_idx ON attio_meetings (ends_at DESC);

CREATE TABLE attio_meeting_record_links (
  meeting_id uuid NOT NULL REFERENCES attio_meetings(id) ON DELETE CASCADE,
  object_slug text NOT NULL,
  record_id text NOT NULL,
  PRIMARY KEY (meeting_id, object_slug, record_id)
);

CREATE INDEX attio_meeting_record_lookup_idx
  ON attio_meeting_record_links (object_slug, record_id);

CREATE TABLE attio_call_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES attio_meetings(id) ON DELETE CASCADE,
  call_recording_id text NOT NULL UNIQUE,
  status text NOT NULL,
  web_url text,
  source_created_at timestamptz,
  transcript_segments jsonb,
  raw_transcript text,
  transcript_web_url text,
  transcript_fetched_at timestamptz,
  processing_status text NOT NULL DEFAULT 'awaiting_transcript'
    CHECK (processing_status IN ('awaiting_transcript', 'unprocessed', 'processing', 'processed', 'failed')),
  raw jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attio_call_recordings_processing_idx
  ON attio_call_recordings (processing_status, transcript_fetched_at);

CREATE TABLE attio_sync_state (
  key text PRIMARY KEY,
  last_poll_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
