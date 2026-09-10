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

## Produktion auf Hetzner

Das Produktions-Setup läuft vollständig per Docker Compose: Caddy terminiert TLS,
Nginx liefert die SPA aus, der Fastify-Server bleibt intern, Postgres besitzt keinen
öffentlichen Port und ein einzelner Worker führt alle Polling- und Queue-Jobs aus.

1. Einen Ubuntu-Server mit Docker Engine und Compose Plugin bereitstellen. Im DNS
   einen A/AAAA-Record für `DOMAIN` auf den Server setzen; öffentlich benötigt werden
   ausschließlich Port 80 und 443.
2. Repository klonen und `.env.production.example` als `.env.production` kopieren.
   Diese Datei enthält nur nicht geheime Konfiguration.
3. Unter `secrets/production/` separate Dateien für `postgres_password`,
   `app_password`, `session_secret`, `internal_health_token`, `openrouter_api_key`
   und `attio_api_key` anlegen. Zufallswerte beispielsweise mit
   `openssl rand -base64 48` erzeugen und das Verzeichnis auf Modus `700`, die
   Dateien auf `600` setzen.
4. `google-oauth-client.json` und das lokal nach `pnpm gmail:auth` erzeugte
   `google-oauth-token.json` ebenfalls dort ablegen. OAuth besitzt ausschließlich
   `gmail.readonly` und `gmail.send`; ein früher im Chat geteiltes Google-App-Passwort
   muss vor dem Start im Google-Konto widerrufen werden und wird von nOS nicht genutzt.
5. Für Attio einen eigenen Produktionsschlüssel nur mit
   `record_permission:read`, `object_configuration:read`, `meeting:read` und
   `call_recording:read` verwenden. Schreibzugriffe erfolgen über die vorhandenen,
   einzeln freizugebenden Actions; falls Attio dafür zusätzliche granulare Scopes
   verlangt, nur genau diese ergänzen.
6. Starten und Updates einspielen:

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
```

Der Worker startet Gmail-Sync alle 30 Minuten, Attio-Sync alle 15 Minuten,
Karten-Pipelines alle 5 Minuten, freigegebene Actions jede Minute und Playbook-Mining
wöchentlich. Jobs laufen in einem Worker seriell und überlappen nicht. Docker-Secrets
werden ausschließlich aus `/run/secrets` geladen; `.dockerignore` schließt Secrets
und lokale Env-Dateien auch aus dem Build-Kontext aus. Der externe Zugriff erfolgt
nur über HTTPS. Sämtliche Arbeitsraum-Endpunkte benötigen die signierte Session;
`/api/health` benötigt zusätzlich den internen Bearer-Token, Login ist naturgemäß
öffentlich.

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
Das gesamte freigegebene Playbook wird zusätzlich bei jedem Lauf fest in den
Kontext geladen; Quellenangaben werden gegen tatsächlich gelesene Ergebnisse validiert.

### Playbook-Feedback-Loop

`pnpm playbook:mine` destilliert neue Paare aus der Sent-Historie sowie jeden
freigegebenen Antworttext in wiederverwendbare Markdown-Vorschläge. Der Job ist für
einen wöchentlichen Cron-Lauf gedacht und verarbeitet jede Quelle genau einmal.
Kundenspezifische oder nicht verallgemeinerbare Beispiele werden protokolliert und
übersprungen. Geeignete Änderungen erscheinen als `playbook_update`-Karte: Slug,
Titel und Markdown lassen sich editieren und werden erst durch die einzeln bestätigte
`playbook_upsert`-Aktion in `playbook_entries` übernommen.

### Call-Nachbereitung

Nach dem Attio-Poll erzeugt `pnpm calls:process` aus neuen Transkripten
Call-Nachbereitungs-Karten. Follow-up-Mail, einzelne Attio-Feldänderungen,
Delegations-Forward und Attio-Task werden als getrennte Aktionen im Status
`pending` gespeichert. Der Prozess führt keine dieser Aktionen selbst aus.

### Mail-Antwortkarten

Nach dem Gmail-Poll verarbeitet `pnpm emails:process` neue eingehende Nachrichten.
Interne SongPush-Mails, No-Reply-Absender, Newsletter und automatische Antworten werden
ohne KI-Aufruf übersprungen. Für relevante externe menschliche Mails entsteht genau eine
offene Karte mit einem Antwortentwurf als `pending`-Aktion; Preise, Zusagen und andere
unsichere Details bleiben als sichtbare Platzhalter zur manuellen Freigabe markiert.

Im selben Agentenlauf wird eine mögliche Delegation an Lina, Noah oder Robert aus
historischen Sent-Forwards und vollständigen Threads abgeleitet. Nur bei belastbarer
Zuordnung ergänzt dieselbe Karte ein `pending`-Forward-Briefing und optional einen
separaten `pending`-Attio-Task; es wird nichts automatisch versendet oder verändert.

### Freigegebene Aktionen ausführen

`pnpm actions:execute` verarbeitet ausschließlich Aktionen mit Status `approved`,
gesetztem `approved_at` und `approved_by`. Gmail-Antworten verwenden Gmail-Thread-ID,
`In-Reply-To` und `References`; Forwards lösen Teamnamen über `TEAM_EMAILS_JSON` auf.
Attio-Mitglieder werden über `ATTIO_MEMBER_IDS_JSON` aufgelöst. Start, vollständiger
freigegebener Inhalt, Ergebnis oder Fehler landen unveränderlich im `audit_log`.
Ein unterbrochener `executing`-Datensatz wird bewusst nicht automatisch wiederholt,
weil ein Blind-Retry eine Mail oder einen CRM-Write doppelt ausführen könnte.
Da der Versand den zusätzlichen Gmail-Scope `gmail.send` benötigt, muss nach diesem
Update einmalig `pnpm gmail:auth` ausgeführt werden; alte Read-only-Tokens werden
bewusst nicht als sendefähig akzeptiert.

### Web-Arbeitsraum

Die Web-App zeigt nach dem Single-User-Login einen nach Dringlichkeit sortierten
Kartenstrom. Aktionen lassen sich einzeln editieren, freigeben oder verwerfen;
ganze Karten können bis morgen zurückgestellt oder verworfen werden. Freigeben
ruft ausschließlich die exakt gewählte Aktion im Action-Layer auf. Dafür müssen
`APP_PASSWORD` (mindestens 12 Zeichen) und `SESSION_SECRET` (mindestens 32 Zeichen)
gesetzt sein. Die Session liegt in einem signierten, `HttpOnly`, `SameSite=Strict`
Cookie; in Produktion zusätzlich `Secure`.

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
2. **Mail-Karte** — für jede eingehende externe menschliche Mail: Antwort-Entwurf **und** Delegations-Entscheidung aus **einem** Agentenlauf (Präzedenzfall-Suche + Playbook, siehe unten). Ergibt eine Karte mit bis zu drei einzeln freizugebenden Aktionen: Antwort senden, intern weiterleiten, Attio-Task.

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
