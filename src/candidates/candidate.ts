import type { PreferenceKind } from '../contracts/personalization.js';
import type { ScoreComponent } from '../contracts/result.js';
import type { NormalizedPreferences } from '../content/model.js';
import type { ValidatedItem } from '../validation/request.js';

export interface Candidate {
  readonly itemId: string;
  /** Original input position; the deterministic tie-breaker. */
  readonly sourceIndex: number;
  readonly score: number;
  readonly components: readonly ScoreComponent[];
}

export interface CandidateContext {
  readonly items: readonly ValidatedItem[];
  readonly excludedIds: ReadonlySet<string>;
  readonly preferences?: NormalizedPreferences | undefined;
  readonly weights?: Readonly<Record<PreferenceKind, number>> | undefined;
}

export interface CandidateSource {
  readonly id: 'baseline' | 'content' | 'collaborative';
  collect(context: CandidateContext): Iterable<Candidate>;
}
