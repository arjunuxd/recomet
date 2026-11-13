import type { Candidate, CandidateContext, CandidateSource } from './candidate.js';
import { contentScore } from '../ranking/score.js';

/**
 * Phase 2 candidate source.
 *
 * Scores eligible items by explicit preference overlap with normalized content
 * signals. Items without matching signals receive a relevance value of zero;
 * they are not silently treated as neutral matches. The baseline source remains
 * available when no usable preferences are supplied.
 */
export const contentSource: CandidateSource = {
  id: 'content',
  *collect(context: CandidateContext): Iterable<Candidate> {
    const preferences = context.preferences;
    const weights = context.weights;
    if (preferences === undefined || weights === undefined) {
      return;
    }

    for (const item of context.items) {
      if (context.excludedIds.has(item.id)) {
        continue;
      }
      const signals = item.signals;
      if (signals === undefined) {
        throw new Error('Content signals were not extracted for a content request.');
      }
      const scored = contentScore(signals, preferences, weights);
      yield {
        itemId: item.id,
        sourceIndex: item.sourceIndex,
        score: scored.score,
        components: scored.components,
      };
    }
  },
};
