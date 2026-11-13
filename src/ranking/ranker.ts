import type { Candidate } from '../candidates/candidate.js';
import { BoundedTopK } from './top-k.js';

/**
 * Total ordering: higher score first, then original input order, then exact ID.
 * `sourceIndex` is unique per request, so the ID comparison is only a defensive
 * final fallback.
 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  if (a.sourceIndex !== b.sourceIndex) {
    return a.sourceIndex - b.sourceIndex;
  }
  if (a.itemId < b.itemId) {
    return -1;
  }
  if (a.itemId > b.itemId) {
    return 1;
  }
  return 0;
}

export interface Ranker {
  select(candidates: Iterable<Candidate>, limit: number): Candidate[];
}

export const deterministicRanker: Ranker = {
  select(candidates, limit) {
    const top = new BoundedTopK<Candidate>(limit, compareCandidates);
    for (const candidate of candidates) {
      top.offer(candidate);
    }
    return top.toSortedArray();
  },
};
