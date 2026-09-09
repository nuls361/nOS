import '../env.js';
import { google } from 'googleapis';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { authorizeGmail } from './auth.js';
import { GoogleGmailClient } from './google-client.js';
import { GmailRepository } from './repository.js';
import { GmailSync } from './sync.js';

await migrate();
const auth = await authorizeGmail();
const pool = createPool();
try {
  const client = new GoogleGmailClient(google.gmail({ version: 'v1', auth }));
  const sync = new GmailSync(client, new GmailRepository(pool));
  const result = process.argv.includes('--full') ? await sync.full() : await sync.incremental();
  console.info(JSON.stringify(result));
} finally {
  await pool.end();
}
