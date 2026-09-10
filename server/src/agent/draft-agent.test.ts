import { describe, expect, it } from 'vitest';
import { filterCitations, type Draft } from './draft-agent.js';

describe('draft source validation', () => {
  it('removes citations the tools did not return', () => {
    const draft: Draft = {
      subject: 'Re: Payment terms', body: 'Hallo', tone: 'sie', confidence: 0.8,
      sensitivePlaceholders: [],
      citations: [
        { sourceId: 'mail:real', reason: 'Prior answer' },
        { sourceId: 'mail:invented', reason: 'Hallucinated' }
      ]
    };
    expect(filterCitations(draft, new Set(['mail:real'])).citations)
      .toEqual([{ sourceId: 'mail:real', reason: 'Prior answer' }]);
  });
});
