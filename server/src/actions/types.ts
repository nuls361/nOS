import { z } from 'zod';

const recipients = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export const gmailSendPayloadSchema = z.object({
  to: recipients,
  subject: z.string().min(1),
  body: z.string().min(1),
  gmailThreadId: z.string().min(1).optional(),
  inReplyTo: z.string().nullable().optional(),
  references: z.string().nullable().optional()
}).passthrough();

export const gmailForwardPayloadSchema = z.object({
  to: recipients.optional(),
  colleague: z.enum(['Lina', 'Noah', 'Robert']).optional(),
  subject: z.string().min(1),
  body: z.string().min(1)
}).passthrough().refine((value) => value.to || value.colleague, {
  message: 'Forward requires to or colleague'
});

export const attioUpdatePayloadSchema = z.object({
  objectSlug: z.enum(['companies', 'deals']),
  recordId: z.string().min(1),
  field: z.string().min(1),
  proposedValue: z.unknown()
}).passthrough();

export const attioTaskPayloadSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  assignee: z.string().nullable(),
  dueDate: z.string().nullable(),
  objectSlug: z.enum(['companies', 'deals']).nullable(),
  recordId: z.string().nullable()
}).passthrough();

export const playbookUpsertPayloadSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  markdown: z.string().min(1)
});

export type ActionType = 'gmail_send' | 'gmail_forward' | 'attio_update' | 'attio_task' | 'playbook_upsert';

export interface ActionWorkItem {
  id: string;
  type: ActionType;
  payload: unknown;
  approvedAt: Date;
  approvedBy: string;
}

export interface GmailWriter {
  send(input: {
    to: string[];
    subject: string;
    body: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  }): Promise<{ messageId: string; threadId?: string }>;
}

export interface AttioWriter {
  updateRecord(input: {
    objectSlug: 'companies' | 'deals'; recordId: string; field: string; value: unknown;
  }): Promise<{ recordId: string }>;
  createTask(input: {
    title: string; description: string; assigneeId?: string; dueDate?: string;
    objectSlug?: 'companies' | 'deals'; recordId?: string;
  }): Promise<{ taskId: string }>;
}

export interface PlaybookWriter {
  upsert(input: { slug: string; title: string; markdown: string }): Promise<{ slug: string }>;
}
