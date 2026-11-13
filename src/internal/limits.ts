import type { EngineLimits } from '../contracts/config.js';

export const LIMIT_KEYS = [
  'maxItems',
  'maxExcludeItemIds',
  'maxLimit',
  'defaultLimit',
  'maxIdLength',
  'maxAttributeNodesPerItem',
  'maxAttributeDepth',
  'maxAttributeStringLength',
  'maxTotalAttributeNodes',
  'maxTotalAttributeCharacters',
  'maxPreferenceTerms',
  'maxPreferenceValueLength',
  'maxSignalValuesPerItem',
  'maxInteractions',
  'maxInteractionTypeLength',
  'maxInteractionTypeWeights',
  'maxCollaborativeNeighbors',
  'maxCollaborativeSimilarityEvaluations',
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

export interface LimitBound {
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
}

export interface ResolvedEngineLimits extends EngineLimits {
  readonly maxPreferenceTerms: number;
  readonly maxPreferenceValueLength: number;
  readonly maxSignalValuesPerItem: number;
  readonly maxInteractions: number;
  readonly maxInteractionTypeLength: number;
  readonly maxInteractionTypeWeights: number;
  readonly maxCollaborativeNeighbors: number;
  /**
   * Maximum total collaborative similarity evaluations (`computeSimilarity`
   * invocations) per recommendation request. Shared across user-based and
   * item-based processing, including `auto` fallback attempts.
   */
  readonly maxCollaborativeSimilarityEvaluations: number;
}

function bound(min: number, max: number, defaultValue: number): LimitBound {
  return Object.freeze({ min, max, defaultValue });
}

/**
 * Provisional defaults and hard ceilings.
 *
 * These are not benchmark results and are not performance guarantees. The hard
 * maxima cannot be raised through configuration. See ARCHITECTURE.md §8.
 */
export const LIMIT_BOUNDS: Readonly<Record<LimitKey, LimitBound>> = Object.freeze({
  maxItems: bound(1, 100_000, 10_000),
  maxExcludeItemIds: bound(0, 100_000, 10_000),
  maxLimit: bound(1, 1_000, 100),
  defaultLimit: bound(1, 1_000, 10),
  maxIdLength: bound(1, 1_024, 256),
  maxAttributeNodesPerItem: bound(1, 1_024, 256),
  maxAttributeDepth: bound(1, 8, 4),
  maxAttributeStringLength: bound(1, 65_536, 4_096),
  maxTotalAttributeNodes: bound(1, 500_000, 50_000),
  maxTotalAttributeCharacters: bound(1, 5_000_000, 1_000_000),
  maxPreferenceTerms: bound(1, 10_000, 256),
  maxPreferenceValueLength: bound(1, 4_096, 256),
  maxSignalValuesPerItem: bound(1, 1_024, 64),
  maxInteractions: bound(0, 100_000, 10_000),
  maxInteractionTypeLength: bound(1, 256, 64),
  maxInteractionTypeWeights: bound(0, 256, 64),
  maxCollaborativeNeighbors: bound(1, 500, 50),
  // Total per-request collaborative similarity-evaluation budget (actual
  // computeSimilarity invocations). Shared across user/item methods and auto
  // fallback. Default 5000: conservative, predictable library bound; min 1
  // preserves correctness at tight budgets; hard max 50,000 caps worst-case
  // CPU while allowing explicit tuning. Bounds similarity evaluations only,
  // not all preselection/sorting/model-construction/memory work.
  maxCollaborativeSimilarityEvaluations: bound(1, 50_000, 5_000),
});

/**
 * `auto` selects one applicable strategy by documented precedence and
 * availability. It is an internal configuration value, not a result strategy
 * identifier.
 */
export const DEFAULT_STRATEGY = 'auto' as const;

export function resolveLimitDefaults(): ResolvedEngineLimits {
  const maxLimit = LIMIT_BOUNDS.maxLimit.defaultValue;
  return Object.freeze({
    maxItems: LIMIT_BOUNDS.maxItems.defaultValue,
    maxExcludeItemIds: LIMIT_BOUNDS.maxExcludeItemIds.defaultValue,
    maxLimit,
    defaultLimit: Math.min(LIMIT_BOUNDS.defaultLimit.defaultValue, maxLimit),
    maxIdLength: LIMIT_BOUNDS.maxIdLength.defaultValue,
    maxAttributeNodesPerItem: LIMIT_BOUNDS.maxAttributeNodesPerItem.defaultValue,
    maxAttributeDepth: LIMIT_BOUNDS.maxAttributeDepth.defaultValue,
    maxAttributeStringLength: LIMIT_BOUNDS.maxAttributeStringLength.defaultValue,
    maxTotalAttributeNodes: LIMIT_BOUNDS.maxTotalAttributeNodes.defaultValue,
    maxTotalAttributeCharacters: LIMIT_BOUNDS.maxTotalAttributeCharacters.defaultValue,
    maxPreferenceTerms: LIMIT_BOUNDS.maxPreferenceTerms.defaultValue,
    maxPreferenceValueLength: LIMIT_BOUNDS.maxPreferenceValueLength.defaultValue,
    maxSignalValuesPerItem: LIMIT_BOUNDS.maxSignalValuesPerItem.defaultValue,
    maxInteractions: LIMIT_BOUNDS.maxInteractions.defaultValue,
    maxInteractionTypeLength: LIMIT_BOUNDS.maxInteractionTypeLength.defaultValue,
    maxInteractionTypeWeights: LIMIT_BOUNDS.maxInteractionTypeWeights.defaultValue,
    maxCollaborativeNeighbors: LIMIT_BOUNDS.maxCollaborativeNeighbors.defaultValue,
    maxCollaborativeSimilarityEvaluations:
      LIMIT_BOUNDS.maxCollaborativeSimilarityEvaluations.defaultValue,
  });
}
