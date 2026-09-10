import '../env.js';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scheduler, type ScheduledTask } from './scheduler.js';

const directory = dirname(fileURLToPath(import.meta.url));
const run = (relativeScript: string): Promise<void> => new Promise((done) => {
  const child = spawn(process.execPath, [resolve(directory, relativeScript)], { stdio: 'inherit' });
  child.once('error', () => {
    console.error(JSON.stringify({ event: 'worker_task_spawn_failed', script: relativeScript }));
    done();
  });
  child.once('exit', (code) => {
    if (code !== 0) console.error(JSON.stringify({ event: 'worker_task_failed', script: relativeScript, code }));
    done();
  });
});

const minute = 60_000;
const tasks: ScheduledTask[] = [
  { name: 'gmail-sync', intervalMs: 30 * minute, run: () => run('../gmail/cli.js') },
  { name: 'email-cards', intervalMs: 5 * minute, run: () => run('../emails/cli.js') },
  { name: 'attio-sync', intervalMs: 15 * minute, run: () => run('../attio/cli.js') },
  { name: 'call-cards', intervalMs: 5 * minute, run: () => run('../calls/cli.js') },
  { name: 'approved-actions', intervalMs: minute, run: () => run('../actions/cli.js') },
  { name: 'playbook-mining', intervalMs: 7 * 24 * 60 * minute, run: () => run('../playbook/cli.js') }
];

const scheduler = new Scheduler(tasks);
await scheduler.tick();
const timer = setInterval(() => void scheduler.tick(), 30_000);
const shutdown = () => { clearInterval(timer); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
