import { z } from 'zod';

export const sourceCitationSchema = z.object({
  sourceId: z.string().min(1),
  reason: z.string().min(1)
});

const citations = z.array(sourceCitationSchema);

export const callCardSchema = z.object({
  summary: z.string().min(1),
  followUpEmail: z.object({
    to: z.array(z.string()).min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    citations
  }),
  attioUpdates: z.array(z.object({
    objectSlug: z.enum(['companies', 'deals']),
    recordId: z.string().min(1),
    field: z.string().min(1),
    currentValue: z.unknown(),
    proposedValue: z.unknown(),
    // Nur echte Änderungen dürfen zu einer freigebbaren Aktion werden. Ohne
    // dieses Flag hängt das Modell Hinweise wie "(keine Änderung)" an den Wert
    // — freigegeben landet genau dieser Text im CRM.
    changesValue: z.boolean(),
    rationale: z.string().min(1),
    citations
  })),
  delegation: z.object({
    to: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    citations
  }).nullable(),
  task: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    assignee: z.string().nullable(),
    dueDate: z.string().nullable(),
    objectSlug: z.enum(['companies', 'deals']).nullable(),
    recordId: z.string().nullable(),
    citations
  }).nullable()
});

export type CallCardProposal = z.infer<typeof callCardSchema>;

export interface CallWorkItem {
  recordingDatabaseId: string;
  callRecordingId: string;
  meetingId: string;
  meetingTitle: string | null;
  participants: unknown[];
  linkedRecords: Array<{ objectSlug: string; recordId: string }>;
  rawTranscript: string;
  transcriptSegments: unknown[];
}

export interface CallCardGenerator {
  generate(workItem: CallWorkItem): Promise<CallCardProposal>;
}
