import { describe, expect, it } from 'vitest';
import { createSession, readSession, verifyPassword } from './session.js';

describe('single-user session', () => {
  it('compares passwords and rejects a tampered cookie', () => {
    expect(verifyPassword('correct', 'correct')).toBe(true);
    expect(verifyPassword('wrong', 'correct')).toBe(false);
    const token = createSession('niels@songpush.com', 's'.repeat(32));
    const request = { headers: { cookie: `nos_session=${token}x` } } as never;
    expect(readSession(request, 's'.repeat(32))).toBeNull();
  });
});
