import '../env.js';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { createPool } from './pool.js';

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

const ensureMigrationTable = async (client: PoolClient): Promise<void> => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
};

export const migrate = async (): Promise<string[]> => {
  const pool = createPool();
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [1_364_200_001]);
    await ensureMigrationTable(client);
    const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.up.sql')).sort();

    // Zwei Migrationen mit derselben Nummer sind auf einer frischen Datenbank
    // reihenfolge-mehrdeutig — das faellt erst auf, wenn eine auf die andere
    // aufbaut. Passiert leicht, wenn parallel entwickelt wird.
    const byPrefix = new Map<string, string[]>();
    for (const name of files) {
      const prefix = name.split('_')[0] ?? name;
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), name]);
    }
    const duplicates = [...byPrefix.values()].filter((group) => group.length > 1);
    if (duplicates.length) {
      throw new Error(`Duplicate migration numbers: ${duplicates.map((g) => g.join(' + ')).join('; ')}`);
    }

    for (const name of files) {
      const sql = await readFile(resolve(migrationsDirectory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [name]
      );

      if (existing.rowCount) {
        if (existing.rows[0]?.checksum !== checksum) {
          throw new Error(`Applied migration was modified: ${name}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [1_364_200_001]).catch(() => undefined);
    client.release();
    await pool.end();
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const applied = await migrate();
  console.info(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
}
