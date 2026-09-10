import type { EmailWorkItem } from './types.js';

const addressPattern = /<([^<>]+)>|([^\s<>,]+@[^\s<>,]+)/;

export const extractEmailAddress = (sender: string): string => {
  const match = addressPattern.exec(sender);
  return (match?.[1] ?? match?.[2] ?? sender).trim().toLowerCase();
};

const automatedLocalPart = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|newsletter|notifications?|mailer-daemon)([._+-]|$)/i;
const newsletterSubject = /\b(newsletter|digest|weekly update|unsubscribe|abmelden)\b/i;

export const isRelevantExternalHumanMail = (mail: EmailWorkItem): boolean => {
  if (!mail.body.trim()) return false;
  const address = extractEmailAddress(mail.sender);
  const [localPart = '', domain = ''] = address.split('@');
  if (!domain || domain === 'songpush.com' || domain.endsWith('.songpush.com')) return false;
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
