import type { PlaybookProposalGenerator } from './generator.js';
import type { PlaybookRepository } from './repository.js';

type Repository = Pick<PlaybookRepository, 'nextSource' | 'saveOutcome'>;

export class PlaybookMiningPipeline {
  constructor(private readonly repository: Repository, private readonly generator: PlaybookProposalGenerator) {}

  async processAll(limit = 100): Promise<{ proposed: number; skipped: number }> {
    let proposed = 0;
    let skipped = 0;
    for (let index = 0; index < limit; index += 1) {
      const source = await this.repository.nextSource();
      if (!source) break;
      const outcome = await this.repository.saveOutcome(source, await this.generator.generate(source));
      if (outcome === 'proposed') proposed += 1;
      else skipped += 1;
    }
    return { proposed, skipped };
  }
}
