// This is deliberately conservative and only catches explicit attempts to
// address the model/runtime. Ordinary customer wording must keep flowing.
const injectionPatterns = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)/i,
  /(disregard|override|forget)\s+(the\s+)?(system|developer|previous|prior)\s+(message|prompt|instructions?)/i,
  /(system|developer)\s+(message|prompt)\s*:/i,
  /<\|\s*(system|assistant|developer)\s*\|>/i,
  /\b(act|behave|respond)\s+as\s+(the\s+)?(system|assistant|developer|agent)\b/i,
  /\b(call|invoke|execute|use)\s+(the\s+)?(tool|function)\b/i,
  /\b(submit_mail_card|submit_card|submit_playbook_proposal|read_playbook)\b/i,
  /\b(reveal|print|return|exfiltrate)\b.{0,80}\b(secret|credential|api[ _-]?key|system prompt|token)\b/is,
  /\b(zeige|verrate|drucke|extrahiere)\b.{0,80}\b(system.?prompt|geheimnis|zugangsdaten|api.?key|token)\b/is,
  /\bignoriere\b.{0,60}\b(anweisungen|regeln|system.?prompt)\b/is
];

export const containsPromptInjection = (...values: Array<string | null | undefined>): boolean => {
  const text = values.filter(Boolean).join('\n').normalize('NFKC');
  return injectionPatterns.some((pattern) => pattern.test(text));
};
