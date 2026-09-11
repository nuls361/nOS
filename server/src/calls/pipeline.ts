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

  /**
   * Ein Kartenlauf dauert gemessen 1-3 Minuten. Ohne Zeitbudget wird eine
   * Vercel-Function (300s) mitten im Lauf abgeschnitten: das gerade geholte
   * Element haengt dann bis zur Wiederaufnahme nach 30 Minuten fest, und die
   * Warteschlange leert sich nie. Deshalb wird kein neues Element mehr
   * begonnen, wenn das Budget aufgebraucht ist.
   */
  async processAll(limit = 20, budgetMs = Number.POSITIVE_INFINITY, now = () => Date.now()): Promise<{ cards: number; actions: number }> {
    let cards = 0;
    let actions = 0;
    const startedAt = now();
    for (let index = 0; index < limit; index += 1) {
      if (now() - startedAt >= budgetMs) break;
      const result = await this.processNext();
      if (!result) break;
      if (!result.existing) cards += 1;
      actions += result.actionCount;
    }
    return { cards, actions };
  }
}
