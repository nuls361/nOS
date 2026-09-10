-- Migration 006 setzte bestehende Mails auf 'skipped', damit das Archiv keine
-- Warteschlange erzeugt. Das greift aber nur fuer Mails, die zum Zeitpunkt der
-- Migration schon in der Tabelle stehen. Der Gmail-Backfill laeuft spaeter und
-- fuegt zwoelf Monate Historie mit dem Default 'unprocessed' ein -- die
-- Warteschlange wuerde also doch das gesamte Archiv abarbeiten.
--
-- Deshalb ein expliziter Startzeitpunkt: bearbeitet wird nur, was ab jetzt
-- eintrifft. Aeltere Mails bleiben durchsuchbar (Praezedenzfaelle), erzeugen
-- aber keine Karte.
CREATE TABLE email_queue_state (
  key text PRIMARY KEY,
  queue_start_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO email_queue_state (key, queue_start_at)
VALUES ('inbound', now())
ON CONFLICT (key) DO NOTHING;
