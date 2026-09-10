import { isRelevantExternalHumanMail } from './filter.js';
import type { EmailCardRepository } from './repository.js';
import type { MailCardGenerator } from './mail-card.js';
import { containsPromptInjection } from '../security/untrusted-input.js';

type EmailQueue = Pick<EmailCardRepository, 'claimNext' | 'createCard' | 'markSkipped' | 'markFailed'>;

export class EmailCardPipeline {
  constructor(private readonly repository: EmailQueue, private readonly generator: MailCardGenerator) {}

  async processNext(): Promise<'created' | 'existing' | 'skipped' | null> {
    const mail = await this.repository.claimNext();
    if (!mail) return null;
    if (containsPromptInjection(mail.subject, mail.body)) {
      await this.repository.markSkipped(mail.messageDatabaseId, 'quarantined_prompt_injection');
      return 'skipped';
    }
    if (!isRelevantExternalHumanMail(mail)) {
      await this.repository.markSkipped(mail.messageDatabaseId);
      return 'skipped';
    }
    try {
      const proposal = await this.generator.generate(mail);
      const result = await this.repository.createCard(mail, proposal);
      return result.existing ? 'existing' : 'created';
    } catch (error) {
      await this.repository.markFailed(mail.messageDatabaseId, error);
      throw error;
    }
  }

  async processAll(limit = 50): Promise<{ cards: number; skipped: number }> {
    let cards = 0;
    let skipped = 0;
    for (let index = 0; index < limit; index += 1) {
      const result = await this.processNext();
      if (!result) break;
      if (result === 'created') cards += 1;
      if (result === 'skipped') skipped += 1;
    }
    return { cards, skipped };
  }
}
