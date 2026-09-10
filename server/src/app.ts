import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { ActionExecutor } from './actions/executor.js';
import {
  clearSessionCookie, createSession, readSession, setSessionCookie, verifyPassword, type AuthConfig
} from './auth/session.js';
import type { WorkspaceRepository } from './workspace/repository.js';

export interface AppDependencies {
  workspace: Pick<WorkspaceRepository,
    'listCards' | 'updateAction' | 'approveAction' | 'discardAction' | 'snoozeCard' | 'discardCard'>;
  executor: Pick<ActionExecutor, 'processAction'>;
  auth: AuthConfig;
  healthToken?: string | undefined;
}

const unauthorized = (reply: FastifyReply) => reply.code(401).send({ error: 'unauthorized' });

/**
 * Ein einzelnes Passwort auf einem oeffentlich erreichbaren Endpunkt braucht
 * eine Bremse, sonst ist Durchprobieren nur eine Frage der Zeit. Bewusst im
 * Speicher gehalten: ein Single-User-Dienst mit einem Prozess braucht dafuer
 * keinen zusaetzlichen Baustein.
 */
const maxFailures = 8;
const windowMs = 15 * 60 * 1_000;

export const createLoginThrottle = (now: () => number = Date.now) => {
  const failures = new Map<string, { count: number; firstAt: number }>();
  return {
    blocked(key: string): boolean {
      const entry = failures.get(key);
      if (!entry) return false;
      if (now() - entry.firstAt > windowMs) {
        failures.delete(key);
        return false;
      }
      return entry.count >= maxFailures;
    },
    recordFailure(key: string): void {
      const entry = failures.get(key);
      if (!entry || now() - entry.firstAt > windowMs) {
        failures.set(key, { count: 1, firstAt: now() });
        return;
      }
      entry.count += 1;
    },
    reset(key: string): void {
      failures.delete(key);
    }
  };
};

export const buildApp = (dependencies?: AppDependencies): FastifyInstance => {
  // Hinter Caddy steht in request.ip sonst die Proxy-Adresse, und die Bremse
  // wuerde alle Clients in einen Topf werfen.
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: true });
  const loginThrottle = createLoginThrottle();
  app.get('/health', async (request, reply) => {
    if (dependencies?.healthToken
      && request.headers.authorization !== `Bearer ${dependencies.healthToken}`) return unauthorized(reply);
    return { status: 'ok' as const };
  });
  if (!dependencies) return app;

  const currentUser = (request: FastifyRequest) => readSession(request, dependencies.auth.sessionSecret);
  const requireUser = (request: FastifyRequest, reply: FastifyReply): { email: string } | null => {
    const user = currentUser(request);
    if (!user || user.email !== dependencies.auth.userEmail) {
      void unauthorized(reply);
      return null;
    }
    return user;
  };

  app.get('/auth/session', async (request, reply) => {
    const user = currentUser(request);
    return user?.email === dependencies.auth.userEmail ? { authenticated: true, email: user.email } : unauthorized(reply);
  });
  app.post<{ Body: { password?: string } }>('/auth/login', async (request, reply) => {
    const client = request.ip;
    if (loginThrottle.blocked(client)) {
      return reply.code(429).send({ error: 'too_many_attempts' });
    }
    if (!request.body?.password || !verifyPassword(request.body.password, dependencies.auth.password)) {
      loginThrottle.recordFailure(client);
      return unauthorized(reply);
    }
    loginThrottle.reset(client);
    setSessionCookie(reply, createSession(dependencies.auth.userEmail, dependencies.auth.sessionSecret),
      dependencies.auth.secureCookies);
    return { authenticated: true, email: dependencies.auth.userEmail };
  });
  app.post('/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply, dependencies.auth.secureCookies);
    return { authenticated: false };
  });

  app.get('/cards', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return dependencies.workspace.listCards();
  });
  app.patch<{ Params: { id: string }; Body: { payload?: unknown } }>('/actions/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    if (request.body?.payload === undefined) return reply.code(400).send({ error: 'payload_required' });
    return await dependencies.workspace.updateAction(request.params.id, request.body.payload)
      ? { updated: true } : reply.code(409).send({ error: 'action_not_pending' });
  });
  app.post<{ Params: { id: string } }>('/actions/:id/approve', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!await dependencies.workspace.approveAction(request.params.id, user.email)) {
      return reply.code(409).send({ error: 'action_not_pending' });
    }
    await dependencies.executor.processAction(request.params.id);
    return { approved: true };
  });
  app.post<{ Params: { id: string } }>('/actions/:id/discard', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return await dependencies.workspace.discardAction(request.params.id, user.email)
      ? { discarded: true } : reply.code(409).send({ error: 'action_not_pending' });
  });
  app.post<{ Params: { id: string }; Body: { until?: string } }>('/cards/:id/snooze', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const until = new Date(request.body?.until ?? '');
    if (!Number.isFinite(until.getTime()) || until <= new Date()) {
      return reply.code(400).send({ error: 'future_until_required' });
    }
    return await dependencies.workspace.snoozeCard(request.params.id, until)
      ? { snoozed: true } : reply.code(409).send({ error: 'card_not_open' });
  });
  app.post<{ Params: { id: string } }>('/cards/:id/discard', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return await dependencies.workspace.discardCard(request.params.id, user.email)
      ? { discarded: true } : reply.code(409).send({ error: 'card_not_open' });
  });
  return app;
};
