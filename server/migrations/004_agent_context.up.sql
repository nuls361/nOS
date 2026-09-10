ALTER TABLE attio_call_recordings
  ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(raw_transcript, ''))
  ) STORED;

CREATE INDEX attio_call_recordings_search_idx
  ON attio_call_recordings USING gin (search_document);

CREATE TABLE playbook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  content text NOT NULL,
  search_document tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX playbook_entries_search_idx ON playbook_entries USING gin (search_document);
