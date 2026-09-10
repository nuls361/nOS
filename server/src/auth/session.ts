import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const cookieName = 'nos_session';
const maxAgeSeconds = 60 * 60 * 24 * 14;

export interface AuthConfig {
  password: string;
  sessionSecret: string;
  userEmail: string;
  secureCookies: boolean;
}

const encode = (value: string): string => Buffer.from(value).toString('base64url');
const decode = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');
const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');
const equal = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const parseCookies = (header?: string): Record<string, string> => Object.fromEntries(
  (header ?? '').split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return [];
    return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
  })
);

export const verifyPassword = (candidate: string, expected: string): boolean =>
  equal(createHmac('sha256', 'nos-password').update(candidate).digest('hex'),
    createHmac('sha256', 'nos-password').update(expected).digest('hex'));

export const createSession = (email: string, secret: string, now = new Date()): string => {
  const payload = encode(JSON.stringify({ email, expiresAt: now.getTime() + maxAgeSeconds * 1_000 }));
  return `${payload}.${sign(payload, secret)}`;
};

export const readSession = (request: FastifyRequest, secret: string): { email: string } | null => {
  const token = parseCookies(request.headers.cookie)[cookieName];
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !equal(sign(payload, secret), signature)) return null;
  try {
    const value = JSON.parse(decode(payload)) as { email?: unknown; expiresAt?: unknown };
    if (typeof value.email !== 'string' || typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now()) return null;
    return { email: value.email };
  } catch {
    return null;
  }
};

export const setSessionCookie = (reply: FastifyReply, token: string, secure: boolean): void => {
  reply.header('Set-Cookie', [
    `${cookieName}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`, ...(secure ? ['Secure'] : [])
  ].join('; '));
};

export const clearSessionCookie = (reply: FastifyReply, secure: boolean): void => {
  reply.header('Set-Cookie', [
    `${cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0', ...(secure ? ['Secure'] : [])
  ].join('; '));
};
