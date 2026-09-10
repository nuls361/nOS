import { describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from './executor.js';
import type { ActionWorkItem } from './types.js';

const action = (type: ActionWorkItem['type'], payload: unknown): ActionWorkItem => ({
  id: `action-${type}`, type, payload, approvedAt: new Date('2026-09-10T12:00:00Z'), approvedBy: 'niels'
});

describe('ActionExecutor', () => {
  it('executes each approved action through its matching adapter', async () => {
    const actions = [
      action('gmail_send', {
        to: ['kunde@example.com'], subject: 'Re: Hallo', body: 'Antwort', gmailThreadId: 'gmail-thread',
        inReplyTo: '<message@example.com>', references: '<older@example.com> <message@example.com>'
      }),
      action('gmail_forward', { colleague: 'Lina', subject: 'Fwd: Briefing', body: 'Bitte übernehmen.' }),
      action('attio_update', { objectSlug: 'companies', recordId: 'record-1', field: 'status', proposedValue: 'active' }),
      action('attio_task', {
        title: 'Nachfassen', description: 'Kunden kontaktieren', assignee: 'Noah', dueDate: null,
        objectSlug: 'deals', recordId: 'deal-1'
      })
    ];
    const repository = {
      claimNext: vi.fn().mockImplementation(async () => actions.shift() ?? null),
      markExecuted: vi.fn(), markFailed: vi.fn()
    };
    const gmail = { send: vi.fn().mockResolvedValue({ messageId: 'sent-1', threadId: 'gmail-thread' }) };
    const attio = {
      updateRecord: vi.fn().mockResolvedValue({ recordId: 'record-1' }),
      createTask: vi.fn().mockResolvedValue({ taskId: 'task-1' })
    };
    const executor = new ActionExecutor(
      repository, gmail, attio, { Lina: 'lina@songpush.com' }, { Noah: 'member-noah' }
    );
    await expect(executor.processAll()).resolves.toBe(4);
    expect(gmail.send).toHaveBeenNthCalledWith(1, expect.objectContaining({
      to: ['kunde@example.com'], threadId: 'gmail-thread', inReplyTo: '<message@example.com>'
    }));
    expect(gmail.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ to: ['lina@songpush.com'] }));
    expect(attio.updateRecord).toHaveBeenCalledWith({
      objectSlug: 'companies', recordId: 'record-1', field: 'status', value: 'active'
    });
    expect(attio.createTask).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'member-noah' }));
    expect(repository.markExecuted).toHaveBeenCalledTimes(4);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('fails closed for an unmapped or invalid recipient', async () => {
    const work = action('gmail_forward', { colleague: 'Robert', subject: 'Fwd', body: 'Briefing' });
    const repository = {
      claimNext: vi.fn().mockResolvedValueOnce(work).mockResolvedValueOnce(null),
      markExecuted: vi.fn(), markFailed: vi.fn()
    };
    const executor = new ActionExecutor(
      repository, { send: vi.fn() }, { updateRecord: vi.fn(), createTask: vi.fn() }, {}, {}
    );
    await expect(executor.processAll()).resolves.toBe(1);
    expect(repository.markFailed).toHaveBeenCalledWith(work, expect.any(Error));
    expect(repository.markExecuted).not.toHaveBeenCalled();
  });
});
