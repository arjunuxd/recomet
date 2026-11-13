import type {
  CollaborativeMethod,
  CollaborativeSimilarity,
  CollaborativeStrategyConfig,
  ConfiguredStrategy,
  RecommenderConfig,
} from '../contracts/config.js';
import { RecometError } from '../errors/recomet-error.js';
import { isValidId } from '../internal/id.js';
import {
  DEFAULT_STRATEGY,
  LIMIT_BOUNDS,
  LIMIT_KEYS,
  type LimitKey,
  resolveLimitDefaults,
  type ResolvedEngineLimits,
} from '../internal/limits.js';
import {
  assertPlainRecord,
  ownStringKeys,
  readDataProperty,
  UnsafeStructureError,
} from '../internal/safe-object.js';
import {
  DEFAULT_ATTRIBUTE_MAP,
  DEFAULT_CONTENT_WEIGHTS,
  isPreferenceKind,
  MAX_PREFERENCE_WEIGHT,
  PREFERENCE_KINDS,
  type ResolvedContentConfig,
} from '../content/model.js';

export interface ResolvedCollaborativeConfig {
  readonly method: CollaborativeMethod;
  readonly similarity: CollaborativeSimilarity;
  readonly interactionTypes: Readonly<Record<string, number>>;
  readonly minOverlap: number;
  readonly maxNeighbors: number;
}

export interface ResolvedHybridConfig {
  readonly contentWeight: number;
  readonly collaborativeWeight: number;
}

export interface ResolvedConfig {
  readonly strategy: ConfiguredStrategy;
  readonly limits: ResolvedEngineLimits;
  readonly content: ResolvedContentConfig;
  readonly collaborative: ResolvedCollaborativeConfig;
  readonly hybrid: ResolvedHybridConfig;
}

const CONFIG_KEYS = ['strategy', 'limits', 'content', 'collaborative', 'hybrid'] as const;
const CONTENT_KEYS = ['attributes', 'weights', 'caseSensitive'] as const;
const COLLABORATIVE_KEYS = [
  'method',
  'similarity',
  'interactionTypes',
  'minOverlap',
  'maxNeighbors',
] as const;
const HYBRID_KEYS = ['weights'] as const;
const HYBRID_WEIGHT_KEYS = ['content', 'collaborative'] as const;
const COLLABORATIVE_METHODS = ['user', 'item', 'auto'] as const;
const COLLABORATIVE_SIMILARITIES = ['cosine', 'jaccard'] as const;
const MAX_INTERACTION_TYPE_WEIGHT = 1_000;
const MAX_COLLABORATIVE_MIN_OVERLAP = 1_000;
export const HYBRID_WEIGHT_MAX = 1_000;

function isConfigKey(key: string): key is (typeof CONFIG_KEYS)[number] {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

function isContentKey(key: string): key is (typeof CONTENT_KEYS)[number] {
  return (CONTENT_KEYS as readonly string[]).includes(key);
}

function isCollaborativeKey(key: string): key is (typeof COLLABORATIVE_KEYS)[number] {
  return (COLLABORATIVE_KEYS as readonly string[]).includes(key);
}

function isHybridKey(key: string): key is (typeof HYBRID_KEYS)[number] {
  return (HYBRID_KEYS as readonly string[]).includes(key);
}

function isHybridWeightKey(key: string): key is (typeof HYBRID_WEIGHT_KEYS)[number] {
  return (HYBRID_WEIGHT_KEYS as readonly string[]).includes(key);
}

function isLimitKey(key: string): key is LimitKey {
  return (LIMIT_KEYS as readonly string[]).includes(key);
}

function isPrototypePollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function invalidConfig(message: string, limit?: number): RecometError {
  return new RecometError('INVALID_CONFIG', message, limit === undefined ? undefined : { limit });
}

/**
 * Validates and resolves configuration into an immutable snapshot.
 *
 * The caller's object is never mutated or retained. Unknown keys, accessors,
 * invalid types, and values outside hard ceilings are rejected rather than
 * clamped.
 */
export function resolveConfig(config?: RecommenderConfig): ResolvedConfig {
  try {
    if (config === undefined) {
      const limits = resolveLimitDefaults();
      return Object.freeze({
        strategy: DEFAULT_STRATEGY,
        limits,
        content: resolveContent(undefined, limits),
        collaborative: resolveCollaborative(undefined, limits),
        hybrid: resolveHybrid(undefined),
      });
    }

    assertPlainRecord(config);

    const configKeys = ownStringKeys(config);
    for (const key of configKeys) {
      if (!isConfigKey(key)) {
        throw invalidConfig('Configuration contains an unsupported field.');
      }
    }

    let strategy: ConfiguredStrategy = DEFAULT_STRATEGY;
    if (configKeys.includes('strategy')) {
      const value = readDataProperty(config, 'strategy');
      if (
        value !== 'auto' &&
        value !== 'baseline' &&
        value !== 'content' &&
        value !== 'collaborative' &&
        value !== 'hybrid'
      ) {
        throw new RecometError(
          'UNSUPPORTED_STRATEGY',
          'The requested recommendation strategy is not supported.',
        );
      }
      strategy = value;
    }

    const limits = resolveLimits(configKeys.includes('limits'), config);
    const content = resolveContent(
      configKeys.includes('content') ? readDataProperty(config, 'content') : undefined,
      limits,
    );
    const collaborative = resolveCollaborative(
      configKeys.includes('collaborative') ? readDataProperty(config, 'collaborative') : undefined,
      limits,
    );
    const hybrid = resolveHybrid(
      configKeys.includes('hybrid') ? readDataProperty(config, 'hybrid') : undefined,
    );

    return Object.freeze({ strategy, limits, content, collaborative, hybrid });
  } catch (error) {
    if (error instanceof RecometError) {
      throw error;
    }
    if (error instanceof UnsafeStructureError) {
      throw invalidConfig('Configuration must be a plain object with supported fields.');
    }
    throw new RecometError('INTERNAL_ERROR', 'An internal error occurred.');
  }
}

function resolveLimits(hasLimits: boolean, config: Record<string, unknown>): ResolvedEngineLimits {
  const defaults = resolveLimitDefaults();
  const provided = new Map<LimitKey, number>();

  if (hasLimits) {
    const rawLimits = readDataProperty(config, 'limits');
    assertPlainRecord(rawLimits);

    const limitKeys = ownStringKeys(rawLimits);
    for (const key of limitKeys) {
      if (key === 'maxCollaborativeComparisons') {
        throw invalidConfig(
          "Configuration limit 'maxCollaborativeComparisons' was renamed to 'maxCollaborativeSimilarityEvaluations' (maximum total collaborative similarity evaluations per recommendation request). Use 'maxCollaborativeSimilarityEvaluations' instead.",
        );
      }
      if (!isLimitKey(key)) {
        throw invalidConfig('Configuration limits contain an unsupported field.');
      }
      const value = readDataProperty(rawLimits, key);
      const bounds = LIMIT_BOUNDS[key];
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < bounds.min ||
        value > bounds.max
      ) {
        throw invalidConfig(
          'Configuration limits must be safe integers within the documented range.',
          bounds.max,
        );
      }
      provided.set(key, value);
    }
  }

  const maxLimit = provided.get('maxLimit') ?? defaults.maxLimit;
  const defaultLimit =
    provided.get('defaultLimit') ?? Math.min(LIMIT_BOUNDS.defaultLimit.defaultValue, maxLimit);

  if (defaultLimit > maxLimit) {
    throw invalidConfig(
      'The default recommendation limit must not exceed the maximum limit.',
      maxLimit,
    );
  }

  return Object.freeze({
    maxItems: provided.get('maxItems') ?? defaults.maxItems,
    maxExcludeItemIds: provided.get('maxExcludeItemIds') ?? defaults.maxExcludeItemIds,
    maxLimit,
    defaultLimit,
    maxIdLength: provided.get('maxIdLength') ?? defaults.maxIdLength,
    maxAttributeNodesPerItem:
      provided.get('maxAttributeNodesPerItem') ?? defaults.maxAttributeNodesPerItem,
    maxAttributeDepth: provided.get('maxAttributeDepth') ?? defaults.maxAttributeDepth,
    maxAttributeStringLength:
      provided.get('maxAttributeStringLength') ?? defaults.maxAttributeStringLength,
    maxTotalAttributeNodes:
      provided.get('maxTotalAttributeNodes') ?? defaults.maxTotalAttributeNodes,
    maxTotalAttributeCharacters:
      provided.get('maxTotalAttributeCharacters') ?? defaults.maxTotalAttributeCharacters,
    maxPreferenceTerms: provided.get('maxPreferenceTerms') ?? defaults.maxPreferenceTerms,
    maxPreferenceValueLength:
      provided.get('maxPreferenceValueLength') ?? defaults.maxPreferenceValueLength,
    maxSignalValuesPerItem:
      provided.get('maxSignalValuesPerItem') ?? defaults.maxSignalValuesPerItem,
    maxInteractions: provided.get('maxInteractions') ?? defaults.maxInteractions,
    maxInteractionTypeLength:
      provided.get('maxInteractionTypeLength') ?? defaults.maxInteractionTypeLength,
    maxInteractionTypeWeights:
      provided.get('maxInteractionTypeWeights') ?? defaults.maxInteractionTypeWeights,
    maxCollaborativeNeighbors:
      provided.get('maxCollaborativeNeighbors') ?? defaults.maxCollaborativeNeighbors,
    maxCollaborativeSimilarityEvaluations:
      provided.get('maxCollaborativeSimilarityEvaluations') ??
      defaults.maxCollaborativeSimilarityEvaluations,
  });
}

function resolveAttributeKey(value: unknown, limits: ResolvedEngineLimits): string | undefined {
  if (!isValidId(value, limits.maxAttributeStringLength) || isPrototypePollutionKey(value)) {
    return undefined;
  }
  return value;
}

function resolveContent(value: unknown, limits: ResolvedEngineLimits): ResolvedContentConfig {
  const attributeMap: Record<string, string> = { ...DEFAULT_ATTRIBUTE_MAP };
  const weights: Record<string, number> = { ...DEFAULT_CONTENT_WEIGHTS };
  let caseSensitive = false;

  if (value !== undefined) {
    assertPlainRecord(value);

    const contentKeys = ownStringKeys(value);
    for (const key of contentKeys) {
      if (!isContentKey(key)) {
        throw invalidConfig('Content configuration contains an unsupported field.');
      }
    }

    if (contentKeys.includes('attributes')) {
      const rawAttributes = readDataProperty(value, 'attributes');
      assertPlainRecord(rawAttributes);
      const attributeKeys = ownStringKeys(rawAttributes);
      for (const key of attributeKeys) {
        if (!isPreferenceKind(key)) {
          throw invalidConfig('Content attribute mapping contains an unsupported signal kind.');
        }
        const attributeKey = resolveAttributeKey(readDataProperty(rawAttributes, key), limits);
        if (attributeKey === undefined) {
          throw invalidConfig(
            'Content attribute mapping requires a non-empty bounded attribute key.',
            limits.maxAttributeStringLength,
          );
        }
        attributeMap[key] = attributeKey;
      }
    }

    if (contentKeys.includes('weights')) {
      const rawWeights = readDataProperty(value, 'weights');
      assertPlainRecord(rawWeights);
      const weightKeys = ownStringKeys(rawWeights);
      for (const key of weightKeys) {
        if (!isPreferenceKind(key)) {
          throw invalidConfig('Content weights contain an unsupported signal kind.');
        }
        const weight = readDataProperty(rawWeights, key);
        if (
          typeof weight !== 'number' ||
          !Number.isFinite(weight) ||
          weight <= 0 ||
          weight > MAX_PREFERENCE_WEIGHT
        ) {
          throw invalidConfig(
            'Content weights must be finite positive numbers within the documented range.',
            MAX_PREFERENCE_WEIGHT,
          );
        }
        weights[key] = weight;
      }
    }

    if (contentKeys.includes('caseSensitive')) {
      const rawCaseSensitive = readDataProperty(value, 'caseSensitive');
      if (typeof rawCaseSensitive !== 'boolean') {
        throw invalidConfig('The caseSensitive option must be a boolean.');
      }
      caseSensitive = rawCaseSensitive;
    }
  }

  const frozenMap = {} as Record<string, string>;
  const frozenWeights = {} as Record<string, number>;
  for (const kind of PREFERENCE_KINDS) {
    frozenMap[kind] = attributeMap[kind] ?? DEFAULT_ATTRIBUTE_MAP[kind];
    frozenWeights[kind] = weights[kind] ?? DEFAULT_CONTENT_WEIGHTS[kind];
  }

  return Object.freeze({
    attributeMap: Object.freeze(frozenMap) as ResolvedContentConfig['attributeMap'],
    weights: Object.freeze(frozenWeights) as ResolvedContentConfig['weights'],
    caseSensitive,
  });
}

function resolveCollaborative(
  value: unknown,
  limits: ResolvedEngineLimits,
): ResolvedCollaborativeConfig {
  let method: CollaborativeMethod = 'auto';
  let similarity: CollaborativeSimilarity = 'cosine';
  let interactionTypes: Record<string, number> = Object.create(null) as Record<string, number>;
  let minOverlap = 1;
  let maxNeighbors = Math.min(50, limits.maxCollaborativeNeighbors);

  if (value !== undefined) {
    assertPlainRecord(value);
    const raw = value as Record<string, unknown> & CollaborativeStrategyConfig;
    const keys = ownStringKeys(raw);
    for (const key of keys) {
      if (!isCollaborativeKey(key)) {
        throw invalidConfig('Collaborative configuration contains an unsupported field.');
      }
    }

    if (keys.includes('method')) {
      const methodValue = readDataProperty(raw, 'method');
      if (
        methodValue !== 'user' &&
        methodValue !== 'item' &&
        methodValue !== 'auto' &&
        !(COLLABORATIVE_METHODS as readonly string[]).includes(methodValue as string)
      ) {
        throw invalidConfig('Collaborative method must be "user", "item", or "auto".');
      }
      method = methodValue as CollaborativeMethod;
    }

    if (keys.includes('similarity')) {
      const similarityValue = readDataProperty(raw, 'similarity');
      if (
        similarityValue !== 'cosine' &&
        similarityValue !== 'jaccard' &&
        !(COLLABORATIVE_SIMILARITIES as readonly string[]).includes(similarityValue as string)
      ) {
        throw invalidConfig('Collaborative similarity must be "cosine" or "jaccard".');
      }
      similarity = similarityValue as CollaborativeSimilarity;
    }

    if (keys.includes('interactionTypes')) {
      interactionTypes = resolveInteractionTypeWeights(
        readDataProperty(raw, 'interactionTypes'),
        limits,
      );
    }

    if (keys.includes('minOverlap')) {
      const minOverlapValue = readDataProperty(raw, 'minOverlap');
      if (
        typeof minOverlapValue !== 'number' ||
        !Number.isSafeInteger(minOverlapValue) ||
        minOverlapValue < 1 ||
        minOverlapValue > MAX_COLLABORATIVE_MIN_OVERLAP
      ) {
        throw invalidConfig(
          'Collaborative minOverlap must be a safe integer within the documented range.',
          MAX_COLLABORATIVE_MIN_OVERLAP,
        );
      }
      minOverlap = minOverlapValue;
    }

    if (keys.includes('maxNeighbors')) {
      const maxNeighborsValue = readDataProperty(raw, 'maxNeighbors');
      if (
        typeof maxNeighborsValue !== 'number' ||
        !Number.isSafeInteger(maxNeighborsValue) ||
        maxNeighborsValue < 1 ||
        maxNeighborsValue > limits.maxCollaborativeNeighbors
      ) {
        throw invalidConfig(
          'Collaborative maxNeighbors must be a safe integer within the documented range.',
          limits.maxCollaborativeNeighbors,
        );
      }
      maxNeighbors = maxNeighborsValue;
    }
  }

  return Object.freeze({
    method,
    similarity,
    interactionTypes: Object.freeze(interactionTypes) as Readonly<Record<string, number>>,
    minOverlap,
    maxNeighbors,
  });
}

function readHybridWeight(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > HYBRID_WEIGHT_MAX
  ) {
    throw invalidConfig(
      'Hybrid weights must be finite numbers within the documented range.',
      HYBRID_WEIGHT_MAX,
    );
  }
  return value;
}

function resolveHybrid(value: unknown): ResolvedHybridConfig {
  let contentWeight = 1;
  let collaborativeWeight = 1;

  if (value !== undefined) {
    assertPlainRecord(value);
    const raw = value as Record<string, unknown>;
    const keys = ownStringKeys(raw);
    for (const key of keys) {
      if (!isHybridKey(key)) {
        throw invalidConfig('Hybrid configuration contains an unsupported field.');
      }
    }

    if (keys.includes('weights')) {
      const weightsRaw = readDataProperty(raw, 'weights');
      assertPlainRecord(weightsRaw);
      const wKeys = ownStringKeys(weightsRaw as Record<string, unknown>);
      for (const key of wKeys) {
        if (!isHybridWeightKey(key)) {
          throw invalidConfig('Hybrid weights contain an unsupported field.');
        }
      }
      const w = weightsRaw as Record<string, unknown>;
      if (wKeys.includes('content')) {
        contentWeight = readHybridWeight(readDataProperty(w, 'content'));
      }
      if (wKeys.includes('collaborative')) {
        collaborativeWeight = readHybridWeight(readDataProperty(w, 'collaborative'));
      }
    }
  }

  if (contentWeight === 0 && collaborativeWeight === 0) {
    throw invalidConfig('Hybrid configuration requires at least one non-zero weight.');
  }

  return Object.freeze({ contentWeight, collaborativeWeight });
}

function resolveInteractionTypeWeights(
  value: unknown,
  limits: ResolvedEngineLimits,
): Record<string, number> {
  assertPlainRecord(value);
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  const keys = ownStringKeys(value);
  if (keys.length > limits.maxInteractionTypeWeights) {
    throw new RecometError(
      'LIMIT_EXCEEDED',
      'The collaborative interaction type configuration exceeds a resource budget.',
      {
        limit: limits.maxInteractionTypeWeights,
        path: 'collaborative.interactionTypes',
      },
    );
  }
  for (const key of keys) {
    if (isPrototypePollutionKey(key)) {
      throw invalidConfig('Collaborative interaction type configuration is not supported.');
    }
    if (!isValidId(key, limits.maxInteractionTypeLength)) {
      throw invalidConfig(
        'Collaborative interaction types must be non-empty bounded identifiers.',
        limits.maxInteractionTypeLength,
      );
    }
    const weight = readDataProperty(value, key);
    if (
      typeof weight !== 'number' ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      weight > MAX_INTERACTION_TYPE_WEIGHT
    ) {
      throw invalidConfig(
        'Collaborative interaction type weights must be finite numbers within the documented range.',
        MAX_INTERACTION_TYPE_WEIGHT,
      );
    }
    result[key] = weight;
  }
  return result;
}
