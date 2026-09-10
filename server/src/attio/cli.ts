import '../env.js';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { HttpAttioClient } from './client.js';
import { AttioRepository } from './repository.js';
import { AttioSync } from './sync.js';

await migrate();
const pool = createPool();
try {
  const client = new HttpAttioClient(
    process.env.ATTIO_API_KEY ?? '',
    process.env.ATTIO_API_BASE_URL ?? 'https://api.attio.com/v2'
  );
  const lookbackHours = Number(process.env.ATTIO_MEETING_LOOKBACK_HOURS ?? 24);
  if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) {
    throw new Error('ATTIO_MEETING_LOOKBACK_HOURS must be a positive number');
  }
  const sync = new AttioSync(client, new AttioRepository(pool));
  // --records: teurer CRM-Vollabzug (eigener, seltener Cron).
  // Default: 15-Minuten-Poll für Meetings/Aufnahmen/Transkripte.
  const result = process.argv.includes('--records')
    ? await sync.syncRecords()
    : await sync.run(new Date(), lookbackHours);
  console.info(JSON.stringify(result));
} finally {
  await pool.end();
}
