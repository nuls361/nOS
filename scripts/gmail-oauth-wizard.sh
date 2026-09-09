#!/usr/bin/env bash
# Führt durch die Google-Cloud-Schritte, die nur ein Mensch klicken kann,
# und legt am Ende secrets/google-oauth-client.json + den Refresh-Token an.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRED="$ROOT/secrets/google-oauth-client.json"
ACCOUNT="niels@songpush.com"

bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
step()  { printf '\n\033[1;34m── Schritt %s ──\033[0m %s\n' "$1" "$2"; }
warn()  { printf '\033[1;33m⚠  %s\033[0m\n' "$1"; }
ok()    { printf '\033[1;32m✓  %s\033[0m\n' "$1"; }
pause() { printf '\n   Weiter mit [Enter] '; read -r _; }
visit() { printf '   → %s\n' "$1"; command -v open >/dev/null && open "$1" >/dev/null 2>&1 || true; }

bold "nOS · Gmail-OAuth einrichten für $ACCOUNT"
cat <<'INTRO'

Das hier musst du selbst klicken — Google lässt keinen Agenten in die Console.
Dauer: ~10 Minuten. Am Ende liegt der Zugang lokal und nOS kann Mails lesen.

INTRO
pause

step 1 "Google-Cloud-Projekt anlegen"
cat <<'TXT'
   Melde dich MIT niels@songpush.com an (nicht privat!).
   Oben in der Projektauswahl: "Neues Projekt" → Name: nOS
   Wichtig: als Organisation songpush.com auswählen, falls gefragt.
TXT
visit "https://console.cloud.google.com/projectcreate"
pause

step 2 "Gmail-API aktivieren"
echo "   Im Projekt nOS auf \"Aktivieren\" klicken."
visit "https://console.cloud.google.com/apis/library/gmail.googleapis.com"
pause

step 3 "OAuth-Zustimmungsbildschirm konfigurieren"
cat <<'TXT'
   User Type: >>> INTERN <<<  (steht zur Auswahl, weil songpush.com Workspace ist)

   Das ist der wichtigste Klick des ganzen Wizards:
     • INTERN  → kein Google-Review nötig, Token laufen NICHT ab.
     • EXTERN  → App bleibt im "Test"-Status und der Refresh-Token
                 stirbt nach 7 Tagen. Dann steht nOS jede Woche still.

   App-Name: nOS
   Support-Mail + Entwickler-Mail: niels@songpush.com
   Scopes-Seite: nichts hinzufügen, einfach durchklicken (die Scopes
   fordert die App zur Laufzeit an).
TXT
visit "https://console.cloud.google.com/apis/credentials/consent"
pause

step 4 "OAuth-Client erstellen"
cat <<'TXT'
   "Anmeldedaten erstellen" → "OAuth-Client-ID"
   Anwendungstyp: >>> Desktop-App <<<   (nicht Web!)
   Name: nOS local
   Danach: JSON herunterladen (Download-Symbol rechts in der Liste).
TXT
visit "https://console.cloud.google.com/apis/credentials"
pause

step 5 "JSON ablegen"
mkdir -p "$ROOT/secrets"; chmod 700 "$ROOT/secrets"
echo "   Erwarteter Pfad: $CRED"
if [ ! -f "$CRED" ]; then
  echo "   Tipp: die Datei liegt vermutlich in ~/Downloads und heißt client_secret_*.json"
  CAND="$(ls -t "$HOME"/Downloads/client_secret_*.json 2>/dev/null | head -1 || true)"
  if [ -n "$CAND" ]; then
    printf '   Gefunden: %s\n   Dorthin kopieren? [j/N] ' "$CAND"; read -r a
    [[ "$a" =~ ^[jJyY]$ ]] && cp "$CAND" "$CRED" && chmod 600 "$CRED" && ok "kopiert"
  fi
fi
while [ ! -f "$CRED" ]; do
  warn "Datei fehlt noch."; printf '   Vollen Pfad zur JSON eingeben (oder [Enter] zum erneut prüfen): '
  read -r given
  [ -n "$given" ] && [ -f "$given" ] && cp "$given" "$CRED" && chmod 600 "$CRED"
done
python3 -c "
import json,sys
d=json.load(open('$CRED'))
k='installed' if 'installed' in d else ('web' if 'web' in d else None)
if k is None: sys.exit('JSON enthält weder \"installed\" noch \"web\" — falscher Anwendungstyp?')
if k=='web': print('   HINWEIS: Typ ist \"Web\" statt \"Desktop-App\" — funktioniert meist, Desktop ist sauberer.')
print('   Client-ID:', d[k]['client_id'][:28]+'…')
" || exit 1
ok "Client-Datei liegt richtig"

step 6 "Zugriff freigeben"
cat <<'TXT'
   Jetzt öffnet sich der Browser. Mit niels@songpush.com anmelden
   und den Zugriff bestätigen. Danach schreibt nOS den Token nach
   secrets/google-oauth-token.json (gitignored).
TXT
pause
cd "$ROOT" && pnpm gmail:auth

ok "Fertig. Nächster Schritt: pnpm gmail:sync --full  (Backfill über 12 Monate)"
