import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { authenticate } from '@google-cloud/local-auth';
import { google, type Auth } from 'googleapis';
import { repoRoot } from '../env.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const credentialsPath = resolve(repoRoot, process.env.GOOGLE_OAUTH_CREDENTIALS_PATH ?? './secrets/google-oauth-client.json');
const tokenPath = resolve(repoRoot, process.env.GOOGLE_OAUTH_TOKEN_PATH ?? './secrets/google-oauth-token.json');

const loadSavedCredentials = async (): Promise<Auth.OAuth2Client | null> => {
  try {
    const credentials = JSON.parse(await readFile(tokenPath, 'utf8')) as Auth.JWTInput;
    return google.auth.fromJSON(credentials) as Auth.OAuth2Client;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

export const authorizeGmail = async (interactive = false): Promise<Auth.OAuth2Client> => {
  const saved = await loadSavedCredentials();
  if (saved) return saved;
  if (!interactive) throw new Error('No Gmail OAuth token found. Run `pnpm gmail:auth` first.');

  const client = await authenticate({ scopes: SCOPES, keyfilePath: credentialsPath });
  const oauthFile = JSON.parse(await readFile(credentialsPath, 'utf8')) as {
    installed?: { client_id?: string; client_secret?: string };
    web?: { client_id?: string; client_secret?: string };
  };
  const oauth = oauthFile.installed ?? oauthFile.web;
  if (!oauth?.client_id || !oauth.client_secret || !client.credentials.refresh_token) {
    throw new Error('OAuth response lacks client credentials or refresh token');
  }
  await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, JSON.stringify({
    type: 'authorized_user',
    client_id: oauth.client_id,
    client_secret: oauth.client_secret,
    refresh_token: client.credentials.refresh_token
  }, null, 2), { mode: 0o600 });
  return client;
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await authorizeGmail(true);
  console.info(`Gmail OAuth token saved to ${tokenPath}`);
}
