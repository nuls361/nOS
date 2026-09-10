import type { ActionRepository } from './repository.js';
import {
  attioTaskPayloadSchema, attioUpdatePayloadSchema, gmailForwardPayloadSchema,
  gmailSendPayloadSchema, type ActionWorkItem, type AttioWriter, type GmailWriter
} from './types.js';

type Queue = Pick<ActionRepository, 'claimNext' | 'markExecuted' | 'markFailed' | 'markBookkeepingFailed'>;

const asRecipients = (value: string | string[]): string[] => Array.isArray(value) ? value : [value];
const validateRecipients = (values: string[]): string[] =>
  values.map((value) => zEmail.parse(value));
const zEmail = { parse(value: string): string {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`Invalid email recipient: ${value}`);
  return value;
} };

export class ActionExecutor {
  constructor(
    private readonly repository: Queue,
    private readonly gmail: GmailWriter,
    private readonly attio: AttioWriter,
    private readonly teamRecipients: Record<string, string>,
    private readonly attioAssignees: Record<string, string>
  ) {}

  private async execute(action: ActionWorkItem): Promise<unknown> {
    switch (action.type) {
      case 'gmail_send': {
        const payload = gmailSendPayloadSchema.parse(action.payload);
        return this.gmail.send({
          to: validateRecipients(asRecipients(payload.to)), subject: payload.subject, body: payload.body,
          ...(payload.gmailThreadId ? { threadId: payload.gmailThreadId } : {}),
          ...(payload.inReplyTo ? { inReplyTo: payload.inReplyTo } : {}),
          ...(payload.references ? { references: payload.references } : {})
        });
      }
      case 'gmail_forward': {
        const payload = gmailForwardPayloadSchema.parse(action.payload);
        const namedRecipient = payload.colleague
          ?? (typeof payload.to === 'string' && this.teamRecipients[payload.to] ? payload.to : undefined);
        const mapped = namedRecipient ? this.teamRecipients[namedRecipient] : undefined;
        const to = mapped ? [mapped] : payload.to ? asRecipients(payload.to) : [];
        if (!to.length) throw new Error(`No email mapping for ${payload.colleague ?? 'forward recipient'}`);
        return this.gmail.send({ to: validateRecipients(to), subject: payload.subject, body: payload.body });
      }
      case 'attio_update': {
        const payload = attioUpdatePayloadSchema.parse(action.payload);
        return this.attio.updateRecord({
          objectSlug: payload.objectSlug, recordId: payload.recordId,
          field: payload.field, value: payload.proposedValue
        });
      }
      case 'attio_task': {
        const payload = attioTaskPayloadSchema.parse(action.payload);
        const assigneeId = payload.assignee ? this.attioAssignees[payload.assignee] : undefined;
        if (payload.assignee && !assigneeId) throw new Error(`No Attio member mapping for ${payload.assignee}`);
        if (Boolean(payload.objectSlug) !== Boolean(payload.recordId)) {
          throw new Error('Attio task link requires both objectSlug and recordId');
        }
        return this.attio.createTask({
          title: payload.title, description: payload.description,
          ...(assigneeId ? { assigneeId } : {}), ...(payload.dueDate ? { dueDate: payload.dueDate } : {}),
          ...(payload.objectSlug ? { objectSlug: payload.objectSlug } : {}),
          ...(payload.recordId ? { recordId: payload.recordId } : {})
        });
      }
    }
  }

  async processNext(): Promise<boolean> {
    const action = await this.repository.claimNext();
    if (!action) return false;

    let result: unknown;
    try {
      result = await this.execute(action);
    } catch (error) {
      await this.repository.markFailed(action, error);
      return true;
    }

    // Ab hier ist die Aktion passiert und nicht mehr ruecknehmbar. Schlaegt nur
    // noch das Festschreiben fehl, darf sie NICHT als 'failed' gelten - sonst
    // gibt jemand sie erneut frei und die Mail geht ein zweites Mal raus.
    try {
      await this.repository.markExecuted(action, result);
    } catch (error) {
      await this.repository.markBookkeepingFailed(action, result, error);
    }
    return true;
  }

  async processAll(limit = 50): Promise<number> {
    let processed = 0;
    while (processed < limit && await this.processNext()) processed += 1;
    return processed;
  }
}
