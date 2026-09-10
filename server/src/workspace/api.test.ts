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
  }
});

describe('workspace API', () => {
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
});
