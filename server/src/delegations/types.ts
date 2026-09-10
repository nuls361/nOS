import { z } from 'zod';
import { sourceCitationSchema } from '../calls/types.js';
import type { EmailWorkItem } from '../emails/types.js';

const citations = z.array(sourceCitationSchema);
const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  assignee: z.enum(['Lina', 'Noah', 'Robert']),
  dueDate: z.string().nullable(),
  objectSlug: z.enum(['companies', 'deals']).nullable(),
  recordId: z.string().nullable(),
  citations
}).nullable();

export const delegationDecisionSchema = z.discriminatedUnion('shouldDelegate', [
  z.object({
    shouldDelegate: z.literal(false),
    reason: z.string().min(1),
    citations
  }),
  z.object({
    shouldDelegate: z.literal(true),
    colleague: z.enum(['Lina', 'Noah', 'Robert']),
    reason: z.string().min(1),
    briefingSubject: z.string().min(1),
    briefingBody: z.string().min(1),
    task: taskSchema,
    citations
  })
]);

export type DelegationDecision = z.infer<typeof delegationDecisionSchema>;
export type DelegationProposal = Extract<DelegationDecision, { shouldDelegate: true }>;

export interface DelegationGenerator {
  generate(mail: EmailWorkItem): Promise<DelegationDecision>;
}
