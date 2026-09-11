import { isAuthorizedCron, runGmailCron } from '../../server/src/vercel/jobs.js';

export const maxDuration = 300;
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json(await runGmailCron());
}
