ALTER TABLE actions DROP CONSTRAINT actions_type_check;
ALTER TABLE actions ADD CONSTRAINT actions_type_check
  CHECK (type IN ('gmail_send', 'gmail_forward', 'attio_update', 'attio_task', 'playbook_upsert'));

CREATE TABLE playbook_mining_sources (
  source_type text NOT NULL CHECK (source_type IN ('reply_pair', 'approved_reply')),
  source_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('proposed', 'skipped')),
  card_id uuid REFERENCES cards(id) ON DELETE SET NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_type, source_id)
);

CREATE INDEX playbook_mining_sources_processed_idx
  ON playbook_mining_sources (processed_at DESC);
