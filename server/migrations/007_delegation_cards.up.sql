ALTER TABLE messages
  ADD COLUMN delegation_status text,
  ADD COLUMN delegation_started_at timestamptz,
  ADD COLUMN delegation_error text;

-- Start routing with newly received mail instead of replaying the historical archive.
UPDATE messages SET delegation_status = 'skipped';

ALTER TABLE messages
  ALTER COLUMN delegation_status SET DEFAULT 'unprocessed',
  ALTER COLUMN delegation_status SET NOT NULL,
  ADD CONSTRAINT messages_delegation_status_check CHECK (
    delegation_status IN ('unprocessed', 'processing', 'processed', 'skipped', 'failed')
  );

CREATE INDEX messages_delegation_queue_idx
  ON messages (sent_at, id)
  WHERE direction = 'inbound' AND delegation_status IN ('unprocessed', 'processing');
