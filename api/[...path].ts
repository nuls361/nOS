import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRuntimeApp } from '../server/src/runtime-app.js';

const appPromise = createRuntimeApp().then(async (app) => { await app.ready(); return app; });

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const app = await appPromise;
  request.url = (request.url ?? '/').replace(/^\/api(?=\/|\?|$)/, '') || '/';
  await new Promise<void>((resolve, reject) => {
    response.once('finish', resolve);
    response.once('close', resolve);
    response.once('error', reject);
    app.server.emit('request', request, response);
  });
}
