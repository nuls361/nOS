import '../env.js';
import { google } from 'googleapis';
import { ContextRepository } from '../agent/context-repository.js';
import { HttpAttioClient } from '../attio/client.js';
import { AttioRepository } from '../attio/repository.js';
import { AttioSync } from '../attio/sync.js';
import { CallCardPipeline } from '../calls/pipeline.js';
import { CallCardRepository } from '../calls/repository.js';
import { createCallCardGenerator } from '../calls/generator.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { EmailCardPipeline } from '../emails/pipeline.js';
import { EmailCardRepository } from '../emails/repository.js';
import { createMailCardGenerator } from '../emails/mail-card.js';
import { authorizeGmail } from '../gmail/auth.js';
import { GoogleGmailClient } from '../gmail/google-client.js';
import { GmailRepository } from '../gmail/repository.js';
import { GmailSync } from '../gmail/sync.js';

export const runGmailCron = async () => {
  await migrate();
  const pool = createPool();
  try {
    const auth = await authorizeGmail();
    const sync = new GmailSync(new GoogleGmailClient(google.gmail({ version: 'v1', auth })), new GmailRepository(pool));
    const backfill = await sync.backfillBatch(Number(process.env.GMAIL_BACKFILL_PAGES_PER_RUN ?? 1));
    const gmail = backfill.complete && backfill.messages === 0 ? await sync.incremental() : backfill;
    const cards = await new EmailCardPipeline(
      new EmailCardRepository(pool), createMailCardGenerator(new ContextRepository(pool))
    ).processAll(20);
    return { gmail, cards };
  } finally { await pool.end(); }
};

export const runRecordingsCron = async () => {
  await migrate();
  const pool = createPool();
  try {
    const client = new HttpAttioClient(process.env.ATTIO_API_KEY ?? '', process.env.ATTIO_API_BASE_URL);
    const recordings = await new AttioSync(client, new AttioRepository(pool)).run(
      new Date(), Number(process.env.ATTIO_MEETING_LOOKBACK_HOURS ?? 24)
    );
    const cards = await new CallCardPipeline(
      new CallCardRepository(pool), createCallCardGenerator(new ContextRepository(pool))
    ).processAll(10);
    return { recordings, cards };
  } finally { await pool.end(); }
};

export const isAuthorizedCron = (request: Request): boolean => Boolean(
  process.env.CRON_SECRET && request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
);
