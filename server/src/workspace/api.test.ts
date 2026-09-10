import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';

const dependencies = () => ({
  workspace: {
    listCards: vi.fn().mockResolvedValue([{ id: 'card-1' }]),
    updateAction: vi.fn().mockResolvedValue(true),
    approveAction: vi.fn().mockResolvedValue(true),
    discardAction: vi.fn().mockResolvedValue(true),
    snoozeCard: vi.fn().mockResolvedValue(true),
    discardCard: vi.fn().mockResolvedValue(true)
  },
  executor: { processAction: vi.fn().mockResolvedValue(true) },
  auth: {
    password: 'a-secure-password', sessionSecret: 's'.repeat(32),
    userEmail: 'niels@songpush.com', secureCookies: false
  },
  healthToken: 'h'.repeat(32)
});

describe('workspace API', () => {
  it('protects the production readiness endpoint with its internal token', async () => {
    const app = buildApp(dependencies());
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'GET', url: '/health', headers: { authorization: `Bearer ${'h'.repeat(32)}` }
    })).json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('protects cards and executes the exact action after approval', async () => {
    const deps = dependencies();
    const app = buildApp(deps);
    expect((await app.inject({ method: 'GET', url: '/cards' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'a-secure-password' } });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toContain('HttpOnly');
    const cards = await app.inject({ method: 'GET', url: '/cards', headers: { cookie: String(cookie) } });
    expect(cards.json()).toEqual([{ id: 'card-1' }]);
    const approved = await app.inject({
      method: 'POST', url: '/actions/action-1/approve', headers: { cookie: String(cookie) }
    });
    expect(approved.statusCode).toBe(200);
    expect(deps.workspace.approveAction).toHaveBeenCalledWith('action-1', 'niels@songpush.com');
    expect(deps.executor.processAction).toHaveBeenCalledWith('action-1');
    await app.close();
  });

  it('rejects an invalid password', async () => {
    const app = buildApp(dependencies());
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'wrong' } })).statusCode).toBe(401);
    await app.close();
  });

  it('stops password guessing after repeated failures', async () => {
    const app = buildApp(dependencies());
    const attempt = () => app.inject({
      method: 'POST', url: '/auth/login', payload: { password: 'falsch' }
    });

    for (let index = 0; index < 8; index += 1) {
      expect((await attempt()).statusCode).toBe(401);
    }
    // Ab hier wird gar nicht mehr geprueft — sonst ist Durchprobieren auf einem
    // oeffentlichen Endpunkt nur eine Frage der Zeit.
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);

    // Auch mit richtigem Passwort bleibt die Bremse aktiv.
    const correct = await app.inject({
      method: 'POST', url: '/auth/login', payload: { password: 'a-secure-password' }
    });
    expect(correct.statusCode).toBe(429);
    await app.close();
  });
});
