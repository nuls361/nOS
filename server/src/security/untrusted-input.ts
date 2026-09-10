// Erkennt ausschliesslich Text, der sich unmissverstaendlich an das Modell oder
// die Laufzeit richtet. Alles Mehrdeutige gehoert NICHT hierher: Der eigentliche
// Schutz ist strukturell — die Agenten haben nur lesende Werkzeuge, jede
// Schreibaktion braucht eine menschliche Freigabe mit Vorschau, und Zitate
// werden gegen tatsaechlich gesehene Quellen gefiltert. Eine Blockliste kann das
// nicht ersetzen, aber sie kann Geld sparen, indem offensichtliche Angriffsmails
// gar nicht erst einen Modelllauf ausloesen.
//
// Bewusst NICHT enthalten (an echten Formulierungen geprueft, alle harmlos):
//   "could you please return the API key for the integration"
//   "can you use the function we discussed on the call"
//   "please invoke the tool on your side"
//   "Forwarded ticket - System message: campaign budget was updated"
// Solche Saetze sind in einer Agentur mit Plattform-Integrationen Alltag. Sie zu
// blockieren haette echte Kundenmails aus dem Arbeitsablauf entfernt.
const injectionPatterns = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)/i,
  /(disregard|override|forget)\s+(the\s+)?(system|developer|previous|prior)\s+(message|prompt|instructions?)/i,
  /(system|developer)\s+prompt\s*:/i,
  /<\|\s*(system|assistant|developer)\s*\|>/i,
  /\b(act|behave|respond)\s+as\s+(the\s+)?(system|assistant|developer|agent)\b/i,
  /\b(submit_mail_card|submit_card|submit_delegation|submit_playbook_proposal)\b/i,
  /\b(reveal|exfiltrate|leak)\b.{0,80}\b(secret|credential|api[ _-]?key|system prompt|token)\b/is,
  /\b(zeige|verrate|extrahiere)\b.{0,80}\b(system.?prompt|geheimnis|zugangsdaten|api.?key|token)\b/is,
  /\bignoriere\b.{0,60}\b(anweisungen|regeln|system.?prompt)\b/is
];

export const containsPromptInjection = (...values: Array<string | null | undefined>): boolean => {
  const text = values.filter(Boolean).join('\n').normalize('NFKC');
  return injectionPatterns.some((pattern) => pattern.test(text));
};
