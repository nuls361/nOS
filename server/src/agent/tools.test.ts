import { describe, expect, it, vi } from 'vitest';
import { createContextTools } from './tools.js';

describe('draft-agent tool boundary', () => {
  it('exposes only context reads, never action or mutation tools', () => {
    const repository = {
      searchMail: vi.fn(), readThread: vi.fn(), searchCalls: vi.fn(), readAttio: vi.fn(), readPlaybook: vi.fn()
    };
    const tools = createContextTools(repository as never, new Set());
    expect(Object.keys(tools).sort()).toEqual([
      'read_attio', 'read_playbook', 'read_thread', 'search_calls', 'search_mail'
    ]);
    expect(Object.keys(tools)).not.toEqual(expect.arrayContaining([
      'gmail_send', 'attio_update', 'playbook_upsert', 'execute_action'
    ]));
  });
});
