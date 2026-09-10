ALTER TABLE messages
  ADD COLUMN processing_status text,
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN processing_error text;

-- The pipeline starts with mail received after this feature is deployed. Importing the
-- existing twelve-month archive would create a large, stale review queue.
UPDATE messages SET processing_status = 'skipped';

ALTER TABLE messages
  ALTER COLUMN processing_status SET DEFAULT 'unprocessed',
  ALTER COLUMN processing_status SET NOT NULL,
  ADD CONSTRAINT messages_processing_status_check CHECK (
    processing_status IN ('unprocessed', 'processing', 'processed', 'skipped', 'failed')
  );

CREATE INDEX messages_processing_queue_idx
  ON messages (sent_at, id)
  WHERE direction = 'inbound' AND processing_status IN ('unprocessed', 'processing');
