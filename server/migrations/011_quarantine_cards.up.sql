-- Zurueckgehaltene Mails verschwanden bisher lautlos: processing_status
-- 'skipped', keine Karte, kein Hinweis. Bei einer Fehlklassifikation waere eine
-- echte Kundenmail damit aus dem Arbeitsablauf gefallen, ohne dass es jemand
-- bemerkt. Zurueckhalten ist richtig -- unsichtbar zurueckhalten nicht.
ALTER TABLE cards DROP CONSTRAINT cards_type_check;
ALTER TABLE cards ADD CONSTRAINT cards_type_check
  CHECK (type IN ('call_followup', 'email_reply', 'delegation', 'playbook_update', 'quarantined'));
