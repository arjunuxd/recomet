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
  /** Maximum interaction records accepted in one collaborative request. */
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

export interface RecommenderConfig {
  readonly strategy?: ConfiguredStrategy;
  readonly limits?: Partial<EngineLimits>;
  readonly content?: ContentStrategyConfig;
  readonly collaborative?: CollaborativeStrategyConfig;
  readonly hybrid?: HybridStrategyConfig;
}
