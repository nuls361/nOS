import type { CallCardRepository } from './repository.js';
import type { CallCardGenerator } from './types.js';
import { containsPromptInjection } from '../security/untrusted-input.js';

type CallQueue = Pick<CallCardRepository, 'claimNext' | 'createCard' | 'markFailed'>;

export class CallCardPipeline {
  constructor(private readonly repository: CallQueue, private readonly generator: CallCardGenerator) {}

  async processNext(): Promise<{ cardId: string; actionCount: number; existing: boolean } | null> {
    let workItem = await this.repository.claimNext();
    while (workItem && containsPromptInjection(workItem.meetingTitle, workItem.rawTranscript)) {
      await this.repository.markFailed(workItem.recordingDatabaseId, new Error('quarantined_prompt_injection'));
      workItem = await this.repository.claimNext();
    }
    if (!workItem) return null;
    try {
      const proposal = await this.generator.generate(workItem);
      return await this.repository.createCard(workItem, proposal);
    } catch (error) {
      await this.repository.markFailed(workItem.recordingDatabaseId, error);
      throw error;
    }
  }

  async processAll(limit = 20): Promise<{ cards: number; actions: number }> {
    let cards = 0;
    let actions = 0;
    for (let index = 0; index < limit; index += 1) {
      const result = await this.processNext();
      if (!result) break;
      if (!result.existing) cards += 1;
      actions += result.actionCount;
    }
    return { cards, actions };
  }
}
