import type { PreferenceKind } from './personalization.js';

export type StrategyId =
  'baseline' | 'content' | 'collaborative' | 'hybrid' | 'trending' | 'discovery';

export type CollaborativeFactor = 'collaborative';

/** Aggregate content component used in hybrid explanations (Phase 4). */
export type HybridContentFactor = 'content';

/** Phase 5: locally computed popularity from explicitly supplied interaction data. */
export type PopularityFactor = 'popularity';

/** Phase 5: time-based freshness from an item timestamp and injectable request time. */
export type FreshnessFactor = 'freshness';

/** Phase 5: diversity re-ranking adjustment (explained, bounded, deterministic). */
export type DiversityFactor = 'diversity';

/** Phase 5: locally computed trending intensity within an explicit time window */
export type TrendingFactor = 'trending';

export type ScoreFactor =
  | 'baseline'
  | PreferenceKind
  | CollaborativeFactor
  | HybridContentFactor
  | PopularityFactor
  | FreshnessFactor
  | DiversityFactor
  | TrendingFactor;

export interface ScoreComponent {
  readonly factor: ScoreFactor;
  /** Normalized value in the inclusive range [0, 1]. */
  readonly value: number;
  /** Raw non-negative weight; normalized during combination. */
  readonly weight: number;
  /** value multiplied by the normalized weight, in [0, 1]. */
  readonly contribution: number;
}

export interface RecommendationExplanation {
  readonly strategy: StrategyId;
  readonly summary: string;
  readonly components: readonly ScoreComponent[];
}

export interface Recommendation {
  readonly itemId: string;
  /** 1-based rank in the returned list. */
  readonly rank: number;
  /** Finite total score in the inclusive range [0, 1]. */
  readonly score: number;
  readonly explanation: RecommendationExplanation;
}

export interface RecommendationMetadata {
  readonly totalItems: number;
  readonly eligibleItems: number;
  readonly excludedItems: number;
  readonly returnedItems: number;
  readonly limit: number;
}

export interface RecommendationResult {
  readonly strategy: StrategyId;
  readonly recommendations: readonly Recommendation[];
  readonly metadata: RecommendationMetadata;
}
