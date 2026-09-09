ALTER TABLE messages
  ADD COLUMN label_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN gmail_history_id text,
  ADD COLUMN snippet text;

CREATE TABLE gmail_sync_state (
  account_email text PRIMARY KEY,
  history_id text NOT NULL,
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
