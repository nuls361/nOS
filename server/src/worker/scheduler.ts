export interface ScheduledTask {
  name: string;
  intervalMs: number;
  run(): Promise<void>;
}

export class Scheduler {
  private readonly lastStarted = new Map<string, number>();
  private running = false;

  constructor(private readonly tasks: ScheduledTask[]) {
    for (const task of tasks) {
      if (!task.name || !Number.isFinite(task.intervalMs) || task.intervalMs < 1) {
        throw new Error('Scheduled tasks require a name and a positive interval');
      }
    }
  }

  async tick(now = Date.now()): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    const started: string[] = [];
    try {
      for (const task of this.tasks) {
        const last = this.lastStarted.get(task.name);
        if (last !== undefined && now - last < task.intervalMs) continue;
        this.lastStarted.set(task.name, now);
        started.push(task.name);
        await task.run();
      }
      return started;
    } finally {
      this.running = false;
    }
  }
}
