ALTER TABLE cards
  ADD COLUMN source_type text,
  ADD COLUMN source_id text;

CREATE UNIQUE INDEX cards_source_unique_idx
  ON cards (source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

ALTER TABLE attio_call_recordings
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN processing_error text;
