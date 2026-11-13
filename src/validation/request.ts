import { RecometError } from '../errors/recomet-error.js';
import { isValidId } from '../internal/id.js';
import {
  assertPlainRecord,
  isPlainRecord,
  ownStringKeys,
  readDataProperty,
  readDenseArray,
  UnsafeStructureError,
} from '../internal/safe-object.js';
import { validateAttributes, type AttributeBudget } from './attributes.js';
import { validatePreferences } from './preferences.js';
import { validateInteractions } from './interactions.js';
import type { ResolvedConfig } from './config.js';
import {
  EMPTY_SIGNALS,
  type ContentSignals,
  type NormalizedPreferences,
} from '../content/model.js';
import { extractContentSignals } from '../content/signals.js';
import type { StrategyId } from '../contracts/result.js';
import {
  buildInteractionModel,
  type InteractionModel,
  type ValidatedInteraction,
} from '../collaborative/model.js';

export interface ValidatedItem {
  readonly id: string;
  readonly sourceIndex: number;
  readonly signals?: ContentSignals | undefined;
}

export interface ValidatedRequest {
  readonly items: readonly ValidatedItem[];
  readonly excludedIds: ReadonlySet<string>;
  readonly limit: number;
  readonly totalItems: number;
  readonly eligibleItems: number;
  readonly excludedItems: number;
  readonly preferences: NormalizedPreferences | undefined;
  readonly strategy: StrategyId;
  readonly fallbackStrategy: StrategyId;
  readonly userId: string | undefined;
  readonly interactions: readonly ValidatedInteraction[] | undefined;
  readonly interactionModel: InteractionModel | undefined;
  readonly collaborativeRequested: boolean;
  readonly hybridRequested: boolean;
}

const REQUEST_KEYS = [
  'items',
  'limit',
  'excludeItemIds',
  'preferences',
  'userId',
  'interactions',
] as const;
const ITEM_KEYS = ['id', 'attributes'] as const;

function isRequestKey(key: string): key is (typeof REQUEST_KEYS)[number] {
  return (REQUEST_KEYS as readonly string[]).includes(key);
}

function isItemKey(key: string): key is (typeof ITEM_KEYS)[number] {
  return (ITEM_KEYS as readonly string[]).includes(key);
}

function invalidRequest(message: string, path?: string): RecometError {
  return new RecometError('INVALID_REQUEST', message, path === undefined ? undefined : { path });
}

function invalidItem(index: number, message: string): RecometError {
  return new RecometError('INVALID_ITEM', message, {
    index,
    path: `items[${index}]`,
  });
}

function readItems(value: unknown, maxItems: number): unknown[] {
  try {
    return readDenseArray(value, maxItems);
  } catch (error) {
    if (error instanceof UnsafeStructureError && error.reason === 'too-long') {
      throw new RecometError(
        'LIMIT_EXCEEDED',
        'Recommendation items exceed the configured maximum.',
        { limit: maxItems },
      );
    }
    throw error;
  }
}

function readExclusions(value: unknown, maxExcludeItemIds: number): unknown[] {
  try {
    return readDenseArray(value, maxExcludeItemIds);
  } catch (error) {
    if (error instanceof UnsafeStructureError && error.reason === 'too-long') {
      throw new RecometError('LIMIT_EXCEEDED', 'Excluded item IDs exceed the configured maximum.', {
        limit: maxExcludeItemIds,
      });
    }
    throw error;
  }
}

function validateLimit(value: unknown, limits: ResolvedConfig['limits']): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > limits.maxLimit
  ) {
    throw new RecometError(
      'INVALID_LIMIT',
      'Recommendation limit must be an integer within the configured range.',
      { limit: limits.maxLimit },
    );
  }
  return value;
}

function hasCollaborativeSignal(
  userId: string | undefined,
  interactions: readonly ValidatedInteraction[] | undefined,
): boolean {
  if (userId === undefined || interactions === undefined || interactions.length === 0) {
    return false;
  }
  for (const interaction of interactions) {
    if (interaction.userId === userId) {
      return true;
    }
  }
  return false;
}

/**
 * Validates the request envelope, item identifiers, exclusions, limit,
 * preferences, collaborative inputs, and attribute trees.
 *
 * The returned structure references only newly created values and bounded
 * normalized models. It does not retain caller-owned objects.
 */
export function validateRequest(request: unknown, config: ResolvedConfig): ValidatedRequest {
  const limits = config.limits;
  try {
    assertPlainRecord(request);

    const requestKeys = ownStringKeys(request);
    for (const key of requestKeys) {
      if (!isRequestKey(key)) {
        throw invalidRequest('Recommendation request contains an unsupported field.');
      }
    }

    if (!requestKeys.includes('items')) {
      throw invalidRequest('Recommendation request requires an items array.');
    }

    const items = readItems(readDataProperty(request, 'items'), limits.maxItems);

    const excludedIds = new Set<string>();
    if (requestKeys.includes('excludeItemIds')) {
      const exclusions = readExclusions(
        readDataProperty(request, 'excludeItemIds'),
        limits.maxExcludeItemIds,
      );
      for (let index = 0; index < exclusions.length; index += 1) {
        const candidate = exclusions[index];
        if (!isValidId(candidate, limits.maxIdLength)) {
          throw invalidRequest(
            `Excluded item ID at index ${index} must be a non-empty bounded string.`,
            `excludeItemIds[${index}]`,
          );
        }
        excludedIds.add(candidate);
      }
    }

    const limit = requestKeys.includes('limit')
      ? validateLimit(readDataProperty(request, 'limit'), limits)
      : limits.defaultLimit;

    const hasPreferences = requestKeys.includes('preferences');
    const preferences = hasPreferences
      ? validatePreferences(
          readDataProperty(request, 'preferences'),
          limits,
          config.content.caseSensitive,
        )
      : undefined;

    let userId: string | undefined;
    if (requestKeys.includes('userId')) {
      const rawUserId = readDataProperty(request, 'userId');
      if (!isValidId(rawUserId, limits.maxIdLength)) {
        throw invalidRequest('userId must be a non-empty bounded string.', 'userId');
      }
      userId = rawUserId;
    }

    let interactions: readonly ValidatedInteraction[] | undefined;
    if (requestKeys.includes('interactions')) {
      interactions = validateInteractions(readDataProperty(request, 'interactions'), limits);
    }

    if (config.strategy === 'baseline') {
      if (hasPreferences) {
        throw invalidRequest('Preferences cannot be used with the baseline strategy.');
      }
      if (userId !== undefined || interactions !== undefined) {
        throw invalidRequest('Collaborative inputs cannot be used with the baseline strategy.');
      }
    }

    if (config.strategy === 'content') {
      if (userId !== undefined || interactions !== undefined) {
        throw invalidRequest('Collaborative inputs cannot be used with the content strategy.');
      }
    }

    if (config.strategy === 'collaborative') {
      if (userId === undefined) {
        throw invalidRequest('userId is required for the collaborative strategy.', 'userId');
      }
      if (interactions === undefined) {
        throw invalidRequest(
          'interactions are required for the collaborative strategy.',
          'interactions',
        );
      }
    }

    const hasUsablePreferences = preferences !== undefined;
    const collaborativeRequested = config.strategy === 'collaborative';
    const hybridRequested = config.strategy === 'hybrid';
    const hasCollaborativeContext =
      (config.strategy === 'collaborative' || config.strategy === 'auto' || hybridRequested) &&
      hasCollaborativeSignal(userId, interactions);

    const fallbackStrategy: StrategyId = hasUsablePreferences ? 'content' : 'baseline';
    let strategy: StrategyId;
    if (config.strategy === 'baseline') {
      strategy = 'baseline';
    } else if (config.strategy === 'content') {
      strategy = hasUsablePreferences ? 'content' : 'baseline';
    } else if (collaborativeRequested) {
      strategy = 'collaborative';
    } else if (hybridRequested) {
      strategy = 'hybrid';
    } else if (config.strategy === 'auto' && hasCollaborativeContext) {
      strategy = 'collaborative';
    } else if (config.strategy === 'auto' && hasUsablePreferences) {
      strategy = 'content';
    } else {
      strategy = 'baseline';
    }

    // Extract content signals when content may be used now, as fallback, or by hybrid.
    const needsContentSignals =
      strategy === 'content' ||
      strategy === 'hybrid' ||
      (strategy === 'collaborative' && hasUsablePreferences) ||
      (collaborativeRequested && hasUsablePreferences);
    const interactionModel =
      hasCollaborativeContext && userId !== undefined && interactions !== undefined
        ? buildInteractionModel(interactions, config.collaborative, limits)
        : undefined;

    const validatedItems: ValidatedItem[] = [];
    const seenIds = new Set<string>();
    const attributeBudget: AttributeBudget = { totalNodes: 0, totalCharacters: 0 };
    let excludedItems = 0;

    for (let index = 0; index < items.length; index += 1) {
      const rawItem = items[index];
      try {
        assertPlainRecord(rawItem);
      } catch (error) {
        if (error instanceof UnsafeStructureError) {
          throw invalidItem(index, `Item at index ${index} must be a plain object.`);
        }
        throw error;
      }

      let itemKeys: string[];
      try {
        itemKeys = ownStringKeys(rawItem);
      } catch (error) {
        if (error instanceof UnsafeStructureError) {
          throw invalidItem(index, `Item at index ${index} has an unsupported structure.`);
        }
        throw error;
      }

      for (const key of itemKeys) {
        if (!isItemKey(key)) {
          throw invalidItem(index, `Item at index ${index} contains an unsupported field.`);
        }
      }

      if (!itemKeys.includes('id')) {
        throw invalidItem(index, `Item at index ${index} requires an id string.`);
      }

      const id = readDataProperty(rawItem, 'id');
      if (!isValidId(id, limits.maxIdLength)) {
        throw invalidItem(index, `Item at index ${index} requires a non-empty bounded id string.`);
      }

      if (seenIds.has(id)) {
        throw new RecometError(
          'DUPLICATE_ITEM_ID',
          `Item at index ${index} duplicates an earlier item id.`,
          { index, path: `items[${index}].id` },
        );
      }
      seenIds.add(id);

      let signals: ContentSignals | undefined;
      if (itemKeys.includes('attributes')) {
        const attributes = readDataProperty(rawItem, 'attributes');
        if (attributes === undefined || !isPlainRecord(attributes)) {
          throw invalidItem(index, `Item at index ${index} has invalid attributes.`);
        }
        validateAttributes(attributes, index, limits, attributeBudget);
        if (needsContentSignals) {
          signals = extractContentSignals(attributes, index, limits, config.content);
        }
      }

      if (needsContentSignals && signals === undefined) {
        signals = EMPTY_SIGNALS;
      }

      if (excludedIds.has(id)) {
        excludedItems += 1;
      }

      validatedItems.push({ id, sourceIndex: index, signals });
    }

    return {
      items: validatedItems,
      excludedIds,
      limit,
      totalItems: validatedItems.length,
      eligibleItems: validatedItems.length - excludedItems,
      excludedItems,
      preferences,
      strategy,
      fallbackStrategy,
      userId,
      interactions,
      interactionModel,
      collaborativeRequested,
      hybridRequested,
    };
  } catch (error) {
    if (error instanceof RecometError) {
      throw error;
    }
    if (error instanceof UnsafeStructureError) {
      throw invalidRequest('Recommendation request has an unsupported structure.');
    }
    throw new RecometError('INTERNAL_ERROR', 'An internal error occurred.');
  }
}
