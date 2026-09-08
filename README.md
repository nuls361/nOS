# nOS

Persönliches Chief-of-Staff-System für Niels (niels@songpush.com). Single-User, Eigenbau.

**Kein Monitoring-Cockpit** — eine **Entwurfs-Maschine für Kommunikations- und Nacharbeit** bei SongPush/WePush. Das System bereitet Arbeit vor (Mail-Entwürfe, Call-Nachbereitung, Delegation, CRM-Pflege), Niels prüft und gibt frei. Kein Auto-Send, nirgends.

## Lokale Entwicklung

Voraussetzungen: Node.js 22+ und pnpm 10.

```bash
cp .env.example .env
pnpm install
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
```

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

1. **Agentische Suche über Postgres-FTS.** Alle Mails werden nach Postgres gesynct (Volltext-Index). Der Draft-Agent (Claude Agent SDK) bekommt Suche als Tools: `search_mail`, `read_thread`, `search_calls`, `read_attio`, `read_playbook` — er sucht iterativ („Rechnung", „Zahlungsziel", „payment terms"), liest Treffer-Threads und zitiert die Quelle auf der Karte („so beantwortet im Juni bei Flaconi").
2. **Antwort-Playbook.** Wöchentlicher Job destilliert die Sent-Historie in editierbare Markdown-Dateien (`playbook/zahlungsbedingungen.md`, …). Der Agent hat das Playbook immer im Kontext; jede freigegebene Antwort erzeugt einen Playbook-Update-Vorschlag (Hybrid-Gedächtnis: System schlägt vor, Niels bestätigt/editiert).
3. **Embeddings nur als Nachrüstung**, falls FTS-Recall nicht reicht (DE/EN-Mix, Synonyme): pgvector auf Ebene „eingehende Frage → gegebene Antwort"-Paare, als zusätzliches Ranking-Tool. Kein Umbau.

## Datenmodell (Skelett)

- `threads` — Teilnehmer, Status, letzter Kontakt
- `messages` — Richtung, Body, FTS-Spalte (tsvector)
- `reply_pairs` (View) — eingehende Nachricht → Niels' nächste Antwort im Thread (Material für Playbook & spätere Embeddings)
- `cards` — Typ, Status (offen/freigegeben/ignoriert/gesnoozt), Payload, Quellen-Referenzen
- `actions` — auszuführende/ausgeführte Aktionen je Karte
- `audit_log` — jede ausgeführte Aktion mit Zeitstempel, Freigabe, Inhalt
- `playbook/*.md` — editierbare Markdown-Dateien im Repo-Stil

## Tech-Stack

| Komponente | Wahl |
|---|---|
| Backend | TypeScript/Node + Claude Agent SDK |
| Web-App | React (SPA), ein Raum, Karten-Stream |
| DB | Postgres (+ FTS, später ggf. pgvector) |
| Agent-Kontext | Markdown-Playbook, editierbar |
| Scheduling | Cron/Queue, Polling-Takt (Recordings ~15 Min, Mail ~30 Min) |
| Hosting | Kleiner Server (Hetzner/Fly.io) |
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
