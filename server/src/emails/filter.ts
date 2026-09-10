import type { EmailWorkItem } from './types.js';

const addressPattern = /<([^<>]+)>|([^\s<>,]+@[^\s<>,]+)/;

export const extractEmailAddress = (sender: string): string => {
  const match = addressPattern.exec(sender);
  return (match?.[1] ?? match?.[2] ?? sender).trim().toLowerCase();
};

const automatedLocalPart =
  /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|newsletter|notifications?|notify|reminders?|digest|alerts?|mailer-daemon|postmaster|bounce)([._+-]|$)/i;

// Absender, die zwar wie Menschen aussehen, aber Maschinen sind — etwa die
// Erinnerungen des eigenen Mail-Clients. Am echten Postfach geprueft:
// reminder@superhuman.com traegt weder List-Unsubscribe noch Auto-Submitted
// oder Precedence, wird von Headern also nicht erfasst.
const ignoredDomains = new Set(
  (process.env.EMAIL_IGNORED_SENDER_DOMAINS ?? 'superhuman.com')
    .split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
);
const newsletterSubject = /\b(newsletter|digest|weekly update|unsubscribe|abmelden)\b/i;

export const isRelevantExternalHumanMail = (mail: EmailWorkItem): boolean => {
  if (!mail.body.trim()) return false;
  const address = extractEmailAddress(mail.sender);
  const [localPart = '', domain = ''] = address.split('@');
  if (!domain || domain === 'songpush.com' || domain.endsWith('.songpush.com')) return false;
  if (ignoredDomains.has(domain)) return false;
  if (automatedLocalPart.test(localPart)) return false;

  const headers = Object.fromEntries(
    Object.entries(mail.headers).map(([key, value]) => [key.toLowerCase(), String(value).toLowerCase()])
  );
  if (headers['list-unsubscribe'] || headers['list-id']) return false;
  if (['bulk', 'list', 'junk'].includes(headers.precedence ?? '')) return false;
  if (headers['auto-submitted'] && headers['auto-submitted'] !== 'no') return false;
  if (newsletterSubject.test(mail.subject ?? '') && /unsubscribe|abmelden/i.test(mail.body)) return false;
  return true;
};
