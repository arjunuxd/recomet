import type { PreferenceKind } from './personalization.js';
import type { StrategyId } from './result.js';

export interface EngineLimits {
  readonly maxItems: number;
  readonly maxExcludeItemIds: number;
  readonly maxLimit: number;
  readonly defaultLimit: number;
  readonly maxIdLength: number;
  readonly maxAttributeNodesPerItem: number;
  readonly maxAttributeDepth: number;
  readonly maxAttributeStringLength: number;
  readonly maxTotalAttributeNodes: number;
  readonly maxTotalAttributeCharacters: number;
  /**
   * Maximum number of preference entries accepted in one request.
   *
   * Optional for backward compatibility with Phase 1 `EngineLimits` literals;
   * the resolved configuration always supplies a value.
   */
  readonly maxPreferenceTerms?: number;
  /** Maximum UTF-16 length of a preference value before and after normalization. */
  readonly maxPreferenceValueLength?: number;
  /** Maximum values accepted from one mapped content-signal attribute of one item. */
  readonly maxSignalValuesPerItem?: number;
  /** Maximum interaction records accepted in one collaborative/trending request. */
  readonly maxInteractions?: number;
  /** Maximum UTF-16 length of an interaction type. */
  readonly maxInteractionTypeLength?: number;
  /** Maximum configured interaction type weight entries. */
  readonly maxInteractionTypeWeights?: number;
  /** Hard ceiling for `collaborative.maxNeighbors` (neighbors selected after evaluation). */
  readonly maxCollaborativeNeighbors?: number;
  /**
   * Maximum total collaborative similarity evaluations (`computeSimilarity`
   * invocations) per recommendation request. Applies to user-based and
   * item-based collaborative filtering and is shared across the complete
   * `auto` strategy, including fallback attempts. Bounds actual similarity
   * evaluations only (not all preselection/sorting/model-construction work).
   * Distinct from `maxCollaborativeNeighbors` / `collaborative.maxNeighbors`.
   */
  readonly maxCollaborativeSimilarityEvaluations?: number;
}

/** `auto` selects one applicable strategy by documented precedence and availability. */
export type ConfiguredStrategy = StrategyId | 'auto';

export type ContentAttributeMap = Readonly<Partial<Record<PreferenceKind, string>>>;

export type ContentWeights = Readonly<Partial<Record<PreferenceKind, number>>>;

export interface ContentStrategyConfig {
  /** Maps preference kinds to content attribute keys. Defaults cover common label fields. */
  readonly attributes?: ContentAttributeMap;
  /** Factor weights for content scoring. Values must be finite and positive. */
  readonly weights?: ContentWeights;
  /** Case-sensitive label matching; default false uses trim + NFC + lowercasing. */
  readonly caseSensitive?: boolean;
}

export type CollaborativeMethod = 'user' | 'item' | 'auto';
export type CollaborativeSimilarity = 'cosine' | 'jaccard';

/** Application-defined default weights for interaction types (finite, >= 0). */
export type CollaborativeInteractionTypeWeights = Readonly<Record<string, number>>;

export interface CollaborativeStrategyConfig {
  /** Neighborhood method: user-based, item-based, or automatic selection. */
  readonly method?: CollaborativeMethod;
  /** Similarity measure for interaction vectors/sets. */
  readonly similarity?: CollaborativeSimilarity;
  /**
   * Default type weights. Effective strength uses `interaction.value` when
   * provided (finite number), otherwise this configured type weight, otherwise
   * `1`. The integrating application controls event meanings and weighting.
   */
  readonly interactionTypes?: CollaborativeInteractionTypeWeights;
  /** Minimum overlap required before computing similarity (safe integer >= 1). */
  readonly minOverlap?: number;
  /** Maximum neighbors considered (safe integer >= 1, capped by limits). */
  readonly maxNeighbors?: number;
}

export interface HybridStrategyWeights {
  /** Weight for the content component. Default 1. Finite, >= 0, <= HYBRID_WEIGHT_MAX. */
  readonly content?: number;
  /** Weight for the collaborative component. Default 1. Finite, >= 0, <= HYBRID_WEIGHT_MAX. */
  readonly collaborative?: number;
}

export interface HybridStrategyConfig {
  /**
   * Global weights for availability-aware fusion. Both zero is invalid.
   * A zero weight disables the corresponding component.
   */
  readonly weights?: HybridStrategyWeights;
}

/** Phase 5: freshness scoring from item timestamps and an injectable reference time. */
export interface FreshnessConfig {
  /** Item attribute key containing a numeric timestamp (Unix epoch milliseconds or seconds). */
  readonly attribute?: string;
  /** Time unit for the attribute value. Default 'ms'. */
  readonly unit?: 'ms' | 's';
  /** Recency duration in the same unit as freshness timestamps (or ms). Default: 30 days. */
  readonly window?: number;
  /** Weight for freshness factor. Default 1. Finite >= 0, <= 1000. */
  readonly weight?: number;
  /** Half-life in window units for exponential decay; 0 disables decay (linear decay). */
  readonly halfLife?: number;
}

/** Phase 5: popularity scoring from explicitly supplied interactions (local only). */
export interface PopularityConfig {
  /** Weight for popularity factor. Default 1. Finite >= 0, <= 1000. */
  readonly weight?: number;
  /** Interaction types to count toward popularity; undefined counts all valid interactions. */
  readonly types?: readonly string[];
}

/** Phase 5: diversity re-ranking to reduce redundancy by an item attribute. */
export interface DiversityConfig {
  /** Item attribute key used for grouping/diversity. */
  readonly attribute?: string;
  /** Weight applied to diversity adjustment. Default 1. Finite >= 0, <= 1000. */
  readonly weight?: number;
  /** Maximum items to allow per group before penalization. Default 1. */
  readonly maxPerGroup?: number;
  /** Whether to apply penalty (true) or boost spread (true default behavior). */
  readonly penalty?: boolean;
}

/** Phase 5: trending/discovery computed locally from supplied interactions with explicit time windows. */
export interface TrendingConfig {
  /** Time window length in milliseconds. Required for time-windowed trending when `now` is used. */
  readonly windowMs?: number;
  /** Weight for trending factor. Default 1. Finite >= 0, <= 1000. */
  readonly weight?: number;
  /** Interaction types to count for trending; undefined counts all valid interactions. */
  readonly types?: readonly string[];
  /** Recency half-life in milliseconds for decay; 0 disables. */
  readonly halfLifeMs?: number;
}

export interface RankingConfig {
  readonly freshness?: FreshnessConfig;
  readonly popularity?: PopularityConfig;
  readonly diversity?: DiversityConfig;
  readonly trending?: TrendingConfig;
}

export interface RecommenderConfig {
  readonly strategy?: ConfiguredStrategy;
  readonly limits?: Partial<EngineLimits>;
  readonly content?: ContentStrategyConfig;
  readonly collaborative?: CollaborativeStrategyConfig;
  readonly hybrid?: HybridStrategyConfig;
  readonly ranking?: RankingConfig;
}
