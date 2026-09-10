-- Antwortentwurf und Delegations-Entscheidung entstehen jetzt in einem einzigen
-- Agentenlauf pro Mail (siehe src/emails/mail-card.ts). Die zweite Warteschlange
-- entfaellt damit; ihre Spalten werden von keinem Code mehr gelesen.
--
-- Grund: getrennt durchlief jede eingehende Mail zwei Laeufe, die beide dieselbe
-- Historie durchsuchten -- bei ~1-2 USD je Lauf der groesste Kostenposten.
DROP INDEX IF EXISTS messages_delegation_queue_idx;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_delegation_status_check,
  DROP COLUMN IF EXISTS delegation_status,
  DROP COLUMN IF EXISTS delegation_started_at,
  DROP COLUMN IF EXISTS delegation_error;
