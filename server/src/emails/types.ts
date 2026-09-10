import type { Draft } from '../agent/draft-agent.js';

export interface EmailWorkItem {
  messageDatabaseId: string;
  messageExternalId: string;
  threadId: string;
  threadExternalId: string;
  sender: string;
  recipients: string[];
  cc: string[];
  subject: string | null;
  body: string;
  headers: Record<string, string>;
  labelIds: string[];
  sentAt: Date;
}

export interface EmailDraftGenerator {
  generate(workItem: EmailWorkItem): Promise<Draft>;
}
