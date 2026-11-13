import type { Candidate, CandidateContext, CandidateSource } from './candidate.js';
import { baselineScore } from '../ranking/score.js';

/**
 * Phase 1 candidate source.
 *
 * Every eligible item is a candidate with the same neutral score and a
 * structured baseline component. No attribute, popularity, freshness, or
 * personalization signal is used.
 */
export const baselineSource: CandidateSource = {
  id: 'baseline',
  *collect(context: CandidateContext): Iterable<Candidate> {
    for (const item of context.items) {
      if (context.excludedIds.has(item.id)) {
        continue;
      }
      const scored = baselineScore();
      yield {
        itemId: item.id,
        sourceIndex: item.sourceIndex,
        score: scored.score,
        components: scored.components,
      };
    }
  },
};
