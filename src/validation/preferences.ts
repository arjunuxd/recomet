import { RecometError } from '../errors/recomet-error.js';
import {
  assertPlainRecord,
  ownStringKeys,
  readDataProperty,
  readDenseArray,
  UnsafeStructureError,
} from '../internal/safe-object.js';
import type { ResolvedEngineLimits } from '../internal/limits.js';
import {
  isPreferenceKind,
  MAX_PREFERENCE_WEIGHT,
  normalizeLabel,
  PREFERENCE_KINDS,
  type NormalizedPreferenceTerm,
  type NormalizedPreferences,
} from '../content/model.js';
import type { PreferenceKind } from '../contracts/personalization.js';

const PREFERENCES_KEYS = ['interests'] as const;
const INTEREST_KEYS = ['kind', 'value', 'weight'] as const;

function isPreferencesKey(key: string): key is (typeof PREFERENCES_KEYS)[number] {
  return (PREFERENCES_KEYS as readonly string[]).includes(key);
}

function isInterestKey(key: string): key is (typeof INTEREST_KEYS)[number] {
  return (INTEREST_KEYS as readonly string[]).includes(key);
}

function invalidPreferences(message: string, path?: string): RecometError {
  return new RecometError(
    'INVALID_PREFERENCES',
    message,
    path === undefined ? undefined : { path },
  );
}

function readInterests(value: unknown, maxTerms: number): unknown[] {
  try {
    return readDenseArray(value, maxTerms);
  } catch (error) {
    if (error instanceof UnsafeStructureError && error.reason === 'too-long') {
      throw new RecometError(
        'LIMIT_EXCEEDED',
        'Explicit preferences exceed the configured maximum.',
        { limit: maxTerms },
      );
    }
    throw error;
  }
}

function readNormalizedValue(
  value: unknown,
  index: number,
  limits: ResolvedEngineLimits,
  caseSensitive: boolean,
): string {
  if (typeof value !== 'string') {
    throw invalidPreferences(
      `Preference at index ${index} requires a string value.`,
      `preferences.interests[${index}].value`,
    );
  }
  if (
    value.length === 0 ||
    value.length > limits.maxPreferenceValueLength ||
    value.includes('\u0000')
  ) {
    throw invalidPreferences(
      `Preference at index ${index} has an invalid value.`,
      `preferences.interests[${index}].value`,
    );
  }

  const normalized = normalizeLabel(value, caseSensitive);
  if (
    normalized.length === 0 ||
    normalized.length > limits.maxPreferenceValueLength ||
    normalized.includes('\u0000')
  ) {
    throw invalidPreferences(
      `Preference at index ${index} has an invalid normalized value.`,
      `preferences.interests[${index}].value`,
    );
  }
  return normalized;
}

function readWeight(value: unknown, index: number, present: boolean): number {
  if (!present) {
    return 1;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_PREFERENCE_WEIGHT
  ) {
    throw invalidPreferences(
      `Preference at index ${index} has an invalid weight.`,
      `preferences.interests[${index}].weight`,
    );
  }
  return value;
}

/**
 * Validates and normalizes per-request explicit preferences.
 *
 * Returns `undefined` when no usable preference term remains (for example, an
 * empty `interests` array), which signals the documented baseline fallback.
 * The returned structure contains only newly created strings and numbers.
 */
export function validatePreferences(
  value: unknown,
  limits: ResolvedEngineLimits,
  caseSensitive: boolean,
): NormalizedPreferences | undefined {
  try {
    assertPlainRecord(value);

    const keys = ownStringKeys(value);
    for (const key of keys) {
      if (!isPreferencesKey(key)) {
        throw invalidPreferences('Preferences contain an unsupported field.');
      }
    }
    if (!keys.includes('interests')) {
      throw invalidPreferences('Preferences require an interests array.');
    }

    const interests = readInterests(
      readDataProperty(value, 'interests'),
      limits.maxPreferenceTerms,
    );
    const terms = new Map<string, Map<string, number>>();
    for (const kind of PREFERENCE_KINDS) {
      terms.set(kind, new Map<string, number>());
    }

    for (let index = 0; index < interests.length; index += 1) {
      const entry = interests[index];
      try {
        assertPlainRecord(entry);
      } catch (error) {
        if (error instanceof UnsafeStructureError) {
          throw invalidPreferences(
            `Preference at index ${index} must be a plain object.`,
            `preferences.interests[${index}]`,
          );
        }
        throw error;
      }

      let entryKeys: string[];
      try {
        entryKeys = ownStringKeys(entry);
      } catch (error) {
        if (error instanceof UnsafeStructureError) {
          throw invalidPreferences(
            `Preference at index ${index} has an unsupported structure.`,
            `preferences.interests[${index}]`,
          );
        }
        throw error;
      }

      for (const key of entryKeys) {
        if (!isInterestKey(key)) {
          throw invalidPreferences(
            `Preference at index ${index} contains an unsupported field.`,
            `preferences.interests[${index}]`,
          );
        }
      }
      if (!entryKeys.includes('kind') || !entryKeys.includes('value')) {
        throw invalidPreferences(
          `Preference at index ${index} requires kind and value fields.`,
          `preferences.interests[${index}]`,
        );
      }

      const kind = readDataProperty(entry, 'kind');
      if (!isPreferenceKind(kind)) {
        throw invalidPreferences(
          `Preference at index ${index} has an unsupported kind.`,
          `preferences.interests[${index}].kind`,
        );
      }

      const normalized = readNormalizedValue(
        readDataProperty(entry, 'value'),
        index,
        limits,
        caseSensitive,
      );
      const hasWeight = entryKeys.includes('weight');
      const weight = readWeight(
        hasWeight ? readDataProperty(entry, 'weight') : undefined,
        index,
        hasWeight,
      );

      const byValue = terms.get(kind);
      if (byValue === undefined) {
        throw invalidPreferences(
          `Preference at index ${index} has an unsupported kind.`,
          `preferences.interests[${index}].kind`,
        );
      }
      const merged = (byValue.get(normalized) ?? 0) + weight;
      if (!Number.isFinite(merged)) {
        throw invalidPreferences(
          `Preference at index ${index} is too large after merging.`,
          `preferences.interests[${index}].weight`,
        );
      }
      byValue.set(normalized, merged);
    }

    const byKind = {} as Record<string, readonly NormalizedPreferenceTerm[]>;
    const totals = {} as Record<string, number>;
    const activeKinds: PreferenceKind[] = [];

    for (const kind of PREFERENCE_KINDS) {
      const byValue = terms.get(kind);
      const list: NormalizedPreferenceTerm[] = [];
      let total = 0;
      if (byValue !== undefined) {
        for (const [normalized, weight] of byValue) {
          list.push(Object.freeze({ value: normalized, weight }));
          total += weight;
        }
      }
      byKind[kind] = Object.freeze(list);
      totals[kind] = total;
      if (list.length > 0) {
        activeKinds.push(kind);
      }
    }

    if (activeKinds.length === 0) {
      return undefined;
    }

    return Object.freeze({
      byKind: Object.freeze(byKind) as NormalizedPreferences['byKind'],
      totals: Object.freeze(totals) as NormalizedPreferences['totals'],
      activeKinds: Object.freeze(activeKinds),
    });
  } catch (error) {
    if (error instanceof RecometError) {
      throw error;
    }
    if (error instanceof UnsafeStructureError) {
      throw invalidPreferences('Preferences must be a plain object with supported fields.');
    }
    throw error;
  }
}
