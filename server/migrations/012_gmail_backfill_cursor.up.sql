CREATE TABLE gmail_backfill_state (
  account_email text PRIMARY KEY,
  page_token text,
  initial_history_id text NOT NULL,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
