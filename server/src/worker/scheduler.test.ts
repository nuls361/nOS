import { describe, expect, it, vi } from 'vitest';
import { Scheduler } from './scheduler.js';

describe('Scheduler', () => {
  it('runs due tasks immediately and then only after their interval', async () => {
    const fast = vi.fn().mockResolvedValue(undefined);
    const slow = vi.fn().mockResolvedValue(undefined);
    const scheduler = new Scheduler([
      { name: 'fast', intervalMs: 1_000, run: fast },
      { name: 'slow', intervalMs: 5_000, run: slow }
    ]);

    await expect(scheduler.tick(10_000)).resolves.toEqual(['fast', 'slow']);
    await expect(scheduler.tick(10_500)).resolves.toEqual([]);
    await expect(scheduler.tick(11_000)).resolves.toEqual(['fast']);
    await expect(scheduler.tick(15_000)).resolves.toEqual(['fast', 'slow']);
  });

  it('does not overlap scheduler ticks', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = new Scheduler([{ name: 'job', intervalMs: 1, run: () => pending }]);
    const first = scheduler.tick(1);
    await expect(scheduler.tick(2)).resolves.toEqual([]);
    release();
    await expect(first).resolves.toEqual(['job']);
  });
});
