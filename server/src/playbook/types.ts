import { z } from 'zod';

export const playbookProposalSchema = z.object({
  shouldUpdate: z.boolean(),
  reason: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
  title: z.string().min(1).nullable(),
  markdown: z.string().min(1).nullable()
}).superRefine((value, context) => {
  if (value.shouldUpdate && (!value.slug || !value.title || !value.markdown)) {
    context.addIssue({ code: 'custom', message: 'An update requires slug, title, and markdown' });
  }
});

export type PlaybookProposal = z.infer<typeof playbookProposalSchema>;

export interface MiningSource {
  sourceType: 'reply_pair' | 'approved_reply';
  sourceId: string;
  question: string;
  answer: string;
  subject: string | null;
  existingEntries: Array<{ slug: string; title: string; content: string }>;
}

export interface PlaybookWriter {
  upsert(input: { slug: string; title: string; markdown: string }): Promise<{ slug: string }>;
}
