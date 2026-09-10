# nOS

Persönliches Chief-of-Staff-System für Niels (niels@songpush.com). Single-User, Eigenbau.

**Kein Monitoring-Cockpit** — eine **Entwurfs-Maschine für Kommunikations- und Nacharbeit** bei SongPush/WePush. Das System bereitet Arbeit vor (Mail-Entwürfe, Call-Nachbereitung, Delegation, CRM-Pflege), Niels prüft und gibt frei. Kein Auto-Send, nirgends.

## Lokale Entwicklung

Voraussetzungen: Node.js 22+ und pnpm 10.

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Die Web-App läuft unter `http://localhost:5173`, der Server unter
`http://localhost:3000`. `GET /health` dient als Readiness-Check.

CI-freundliche Prüfungen:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:db
```

### Gmail-Synchronisierung

1. Gmail API im Google-Cloud-Projekt aktivieren und einen OAuth-Client vom Typ
   „Desktop app“ erstellen.
2. Die heruntergeladene Datei als `secrets/google-oauth-client.json` speichern.
3. Einmalig `pnpm gmail:auth` ausführen.
4. Mit `pnpm gmail:sync -- --full` die letzten zwölf Monate aus Inbox und Sent
   importieren. Danach genügt `pnpm gmail:sync` für den inkrementellen Lauf.

OAuth-Dateien unter `secrets/` werden nie eingecheckt.

### Attio-Synchronisierung

Einen Attio-Zugriffsschlüssel mit den minimalen Scopes `record_permission:read`,
`object_configuration:read`, `meeting:read` und `call_recording:read` als
`ATTIO_API_KEY` in `.env` eintragen. `pnpm attio:sync` synchronisiert Companies,
Deals und die Meetings der letzten 24 Stunden. Abgeschlossene Call-Recordings
werden samt Transkript gespeichert und für die Verarbeitung als `unprocessed`
markiert. Im Betrieb wird der Befehl alle 15 Minuten ausgeführt.

### Draft-Agent

`OPENROUTER_API_KEY` und optional `OPENROUTER_MODEL` in `.env` setzen. Ein
lokaler Testlauf ist anschließend möglich mit:

```bash
pnpm draft -- "Kunde fragt nach Zahlung auf Rechnung"
```

Der Agent kann ausschließlich die fünf Read-only-Tools `search_mail`,
`read_thread`, `search_calls`, `read_attio` und `read_playbook` verwenden.
Quellenangaben werden gegen tatsächlich gelesene Tool-Ergebnisse validiert.

### Call-Nachbereitung

Nach dem Attio-Poll erzeugt `pnpm calls:process` aus neuen Transkripten
Call-Nachbereitungs-Karten. Follow-up-Mail, einzelne Attio-Feldänderungen,
Delegations-Forward und Attio-Task werden als getrennte Aktionen im Status
`pending` gespeichert. Der Prozess führt keine dieser Aktionen selbst aus.

> Revidierter Plan, Stand 08.09.2026 — ersetzt den ursprünglichen „Jarvis"-Projektplan
> (mobile-first Entscheidungs-Cockpit mit Projekt-Tabs). Begründung der Kürzungen: siehe unten.

## Warum dieser Zuschnitt

Analyse des echten Postfachs (7 Tage, niels@songpush.com):

- 88 gesendete Mails, davon **85 Antworten in laufenden Threads**, nur 3 initiative Mails → Thread-Ping-Pong, kein Outbound.
- Inhalt: Kampagnen-Betrieb mit Brands (EDEKA, About You, L'Oréal, Oatsome, MBG, Flaconi, …).
- Größter Empfänger: **das eigene Team** (79 Mails an songpush.com) — Delegation läuft über Forwards mit Briefing.
- Inbox fast rauschfrei (57/60 Mails von Menschen) → Triage ist nicht das Problem.
- 5+ Kundencalls am Tag, alle aufgezeichnet (Attio Call-Recordings mit Transkript) — **Nachbereitung bleibt heute liegen**.

Der Hebel ist nicht Information (Dashboard), sondern **vorbereitete Arbeit**.

## v1 — Scope

**Interface:** Web-App (kein React Native, kein Push — die App ist eh offen). Ein Arbeitsraum, keine Projekt-Tabs. Karten-Stream, sortiert nach Dringlichkeit.

**Drei Karten-Typen:**

1. **Call-Nachbereitung** — ~15 Min nach Call-Ende (Polling der Attio-Recordings). Aus dem Transkript:
   - Follow-up-Mail-Entwurf an den Kunden
   - Attio-Updates, Feld für Feld als Diff
   - Delegations-Forward an Lina/Noah/Robert + Attio-Task (Tasks werden im Team voll gelebt)
2. **Antwort-Entwurf** — für jede eingehende externe menschliche Mail, mit Präzedenzfall-Suche + Playbook (siehe unten).
3. **Delegations-Vorschlag** — für interne Mails: Routing-Erkennung + Forward-Entwurf mit Briefing.

**Freigabe-Modell:** Jede Karte zeigt den exakten Wortlaut / Feld-Diff, ist editierbar. Freigeben = Direktversand über Gmail im richtigen Thread (korrektes In-Reply-To/References) bzw. Attio-Write. Alles landet im Audit-Log. Kein Auto-Send — Guardrails vorerst nicht nötig, da alles geprüft wird.

**Kontextquellen v1:** Gmail (niels@songpush.com), Attio (Records + Call-Transkripte). Sonst nichts.

## Präzedenzfall-Suche (Datenmodell-Kern)

Beispiel: Kunde fragt „können wir auf Rechnung zahlen?" → System findet, wie das früher beantwortet wurde.

**Nicht embeddings-first.** Drei Schichten:

1. **Agentische Suche über Postgres-FTS.** Alle Mails werden nach Postgres gesynct (Volltext-Index). Der Draft-Agent (Vercel AI SDK, Tool-Calling-Loop über OpenRouter) bekommt Suche als Tools: `search_mail`, `read_thread`, `search_calls`, `read_attio`, `read_playbook` — er sucht iterativ („Rechnung", „Zahlungsziel", „payment terms"), liest Treffer-Threads und zitiert die Quelle auf der Karte („so beantwortet im Juni bei Flaconi").
2. **Antwort-Playbook.** Wöchentlicher Job destilliert die Sent-Historie in editierbare Markdown-Texte (`zahlungsbedingungen`, `onboarding`, …), gespeichert in Postgres und über die UI editierbar. Der Agent hat das Playbook immer im Kontext; jede freigegebene Antwort erzeugt einen Playbook-Update-Vorschlag (Hybrid-Gedächtnis: System schlägt vor, Niels bestätigt/editiert).
3. **Embeddings nur als Nachrüstung**, falls FTS-Recall nicht reicht (DE/EN-Mix, Synonyme): pgvector auf Ebene „eingehende Frage → gegebene Antwort"-Paare, als zusätzliches Ranking-Tool. Kein Umbau.

## Datenmodell (Skelett)

- `threads` — Teilnehmer, Status, letzter Kontakt
- `messages` — Richtung, Body, FTS-Spalte (tsvector)
- `reply_pairs` (View) — eingehende Nachricht → Niels' nächste Antwort im Thread (Material für Playbook & spätere Embeddings)
- `cards` — Typ, Status (offen/freigegeben/ignoriert/gesnoozt), Payload, Quellen-Referenzen
- `actions` — auszuführende/ausgeführte Aktionen je Karte
- `audit_log` — jede ausgeführte Aktion mit Zeitstempel, Freigabe, Inhalt
- `playbook` — editierbare Markdown-Texte in Postgres (kein persistentes Dateisystem auf Vercel)

## Tech-Stack

| Komponente | Wahl |
|---|---|
| Backend | TypeScript/Node + Vercel AI SDK (Provider: OpenRouter) |
| Web-App | React (SPA), ein Raum, Karten-Stream |
| DB | Postgres (+ FTS, später ggf. pgvector) |
| Agent-Kontext | Markdown-Playbook in Postgres, editierbar |
| Scheduling | Vercel Cron, Polling-Takt (Recordings ~15 Min, Mail ~30 Min) |
| Hosting | Vercel (Functions + Cron) |
| Integrationen | Gmail API, Attio API/MCP |

## Roadmap

- **v1:** wie oben.
- **v1.1:** Slack lesend (Kontext + „wo wartet jemand auf dich"), Benachrichtigung als Slack-DM. Danach: Slack-Antwort-Entwürfe.
- **Später (bewusst geparkt):** Decks, Mobile App, Projekt-Tabs, Outbound-Wellen, Inbox-Triage, Notion-/GitHub-Worker, Zeit-Agent/Wochen-Feedback, Manager-Report, Ghostty-Daemon, WhatsApp, Webhooks/Echtzeit, selektive Auto-Aktionen. Erst wenn der Kern täglich genutzt wird.

## Sicherheit

- Eingehende Inhalte (Mails, Transkripte) sind **untrusted Input**: strikte Trennung von Findings und Aktionen; Aktionen nur über den Freigabe-Flow.
- Secrets nie im Agent-Kontext/Playbook; minimale Scopes; Web-App mit Auth; Server gehärtet.
- Audit-Log für jede ausgeführte Aktion.

## Erfolgsmaß

Baseline: ~4 h/Tag Kommunikations- und Nacharbeit (E-Mail + Attio + Slack). Das System funktioniert, wenn Call-Nachbereitung zuverlässig *passiert* (heute: bleibt liegen) und Antwort-Entwürfe mehrheitlich mit minimalem Edit versendet werden.
