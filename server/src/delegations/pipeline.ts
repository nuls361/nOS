import { isRelevantExternalHumanMail } from '../emails/filter.js';
import type { DelegationRepository } from './repository.js';
import type { DelegationGenerator } from './types.js';

type Queue = Pick<DelegationRepository, 'claimNext' | 'createCard' | 'markSkipped' | 'markFailed'>;

export class DelegationPipeline {
  constructor(private readonly repository: Queue, private readonly generator: DelegationGenerator) {}

  async processNext(): Promise<'created' | 'existing' | 'skipped' | null> {
    const mail = await this.repository.claimNext();
    if (!mail) return null;
    if (!isRelevantExternalHumanMail(mail)) {
      await this.repository.markSkipped(mail.messageDatabaseId);
      return 'skipped';
    }
    try {
      const decision = await this.generator.generate(mail);
      if (!decision.shouldDelegate) {
        await this.repository.markSkipped(mail.messageDatabaseId);
        return 'skipped';
      }
      const result = await this.repository.createCard(mail, decision);
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
