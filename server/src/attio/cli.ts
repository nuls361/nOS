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
  const result = await new AttioSync(client, new AttioRepository(pool)).run(new Date(), lookbackHours);
  console.info(JSON.stringify(result));
} finally {
  await pool.end();
}
