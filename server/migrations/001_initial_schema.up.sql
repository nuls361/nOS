CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_id text NOT NULL,
  subject text,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  last_contact_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender text NOT NULL,
  recipients text[] NOT NULL DEFAULT '{}',
  cc text[] NOT NULL DEFAULT '{}',
  subject text,
  body_text text NOT NULL DEFAULT '',
  body_html text,
  sent_at timestamptz NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_document tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce(subject, '') || ' ' ||
      coalesce(body_text, '') || ' ' ||
      coalesce(sender, '')
    )
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE INDEX messages_thread_sent_idx ON messages (thread_id, sent_at);
CREATE INDEX messages_search_document_idx ON messages USING gin (search_document);

CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('call_followup', 'email_reply', 'delegation', 'playbook_update')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'discarded', 'snoozed', 'completed')),
  urgency smallint NOT NULL DEFAULT 0 CHECK (urgency BETWEEN 0 AND 100),
  title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  snoozed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cards_stream_idx ON cards (status, urgency DESC, created_at);

CREATE TABLE actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('gmail_send', 'gmail_forward', 'attio_update', 'attio_task')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'executing', 'executed', 'failed', 'discarded')),
  payload jsonb NOT NULL,
  approved_at timestamptz,
  approved_by text,
  executed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX actions_card_idx ON actions (card_id);
CREATE INDEX actions_pending_idx ON actions (status, created_at) WHERE status IN ('approved', 'executing');

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action_id uuid REFERENCES actions(id) ON DELETE SET NULL,
  event text NOT NULL,
  actor text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_action_idx ON audit_log (action_id, created_at);

CREATE VIEW reply_pairs AS
SELECT
  incoming.id AS incoming_message_id,
  reply.id AS reply_message_id,
  incoming.thread_id,
  incoming.subject,
  incoming.body_text AS incoming_body,
  reply.body_text AS reply_body,
  incoming.sent_at AS incoming_at,
  reply.sent_at AS replied_at
FROM messages AS incoming
CROSS JOIN LATERAL (
  SELECT candidate.*
  FROM messages AS candidate
  WHERE candidate.thread_id = incoming.thread_id
    AND candidate.direction = 'outbound'
    AND candidate.sent_at > incoming.sent_at
  ORDER BY candidate.sent_at, candidate.id
  LIMIT 1
) AS reply
WHERE incoming.direction = 'inbound';
