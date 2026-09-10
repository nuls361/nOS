import { google } from 'googleapis';
import type { Pool } from 'pg';
import { HttpAttioClient } from '../attio/client.js';
import { authorizeGmail } from '../gmail/auth.js';
import { GoogleGmailClient } from '../gmail/google-client.js';
import { PlaybookRepository } from '../playbook/repository.js';
import { ActionExecutor } from './executor.js';
import { ActionRepository } from './repository.js';

const parseMap = (name: string): Record<string, string> => {
  const raw = process.env[name];
  if (!raw) return {};
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.values(value).some((entry) => typeof entry !== 'string')) {
    throw new Error(`${name} must be a JSON object with string values`);
  }
  return value as Record<string, string>;
};

export const createActionExecutor = (pool: Pool): ActionExecutor => {
  let gmailClient: GoogleGmailClient | undefined;
  const gmail = {
    send: async (input: Parameters<GoogleGmailClient['send']>[0]) => {
      if (!gmailClient) {
        const auth = await authorizeGmail();
        gmailClient = new GoogleGmailClient(google.gmail({ version: 'v1', auth }));
      }
      return gmailClient.send(input);
    }
  };
  let attioClient: HttpAttioClient | undefined;
  const getAttio = (): HttpAttioClient => {
    attioClient ??= new HttpAttioClient(
      process.env.ATTIO_API_KEY ?? '', process.env.ATTIO_API_BASE_URL ?? 'https://api.attio.com/v2'
    );
    return attioClient;
  };
  return new ActionExecutor(
    new ActionRepository(pool), gmail,
    {
      updateRecord: (input) => getAttio().updateRecord(input),
      createTask: (input) => getAttio().createTask(input)
    },
    parseMap('TEAM_EMAILS_JSON'), parseMap('ATTIO_MEMBER_IDS_JSON'), new PlaybookRepository(pool)
  );
};
