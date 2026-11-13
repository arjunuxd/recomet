import type { PreferenceKind } from '../contracts/personalization.js';

/** Fixed order keeps explanation components and tie behaviour deterministic. */
export const PREFERENCE_KINDS = [
  'category',
  'tag',
  'topic',
  'keyword',
  'contentType',
] as const satisfies readonly PreferenceKind[];

export const DEFAULT_ATTRIBUTE_MAP: Readonly<Record<PreferenceKind, string>> = Object.freeze({
  category: 'category',
  tag: 'tags',
  topic: 'topics',
  keyword: 'keywords',
  contentType: 'contentType',
});

export const DEFAULT_CONTENT_WEIGHTS: Readonly<Record<PreferenceKind, number>> = Object.freeze({
  category: 1,
  tag: 1,
  topic: 1,
  keyword: 1,
  contentType: 1,
});

export const MAX_PREFERENCE_WEIGHT = 1_000;

export interface NormalizedPreferenceTerm {
  readonly value: string;
  readonly weight: number;
}

export interface NormalizedPreferences {
  readonly byKind: Readonly<Record<PreferenceKind, readonly NormalizedPreferenceTerm[]>>;
  readonly totals: Readonly<Record<PreferenceKind, number>>;
  readonly activeKinds: readonly PreferenceKind[];
}

export type ContentSignals = Readonly<Record<PreferenceKind, ReadonlySet<string>>>;

export interface ResolvedContentConfig {
  readonly attributeMap: Readonly<Record<PreferenceKind, string>>;
  readonly weights: Readonly<Record<PreferenceKind, number>>;
  readonly caseSensitive: boolean;
}

const EMPTY_VALUES: ReadonlySet<string> = new Set<string>();

export const EMPTY_SIGNALS: ContentSignals = Object.freeze({
  category: EMPTY_VALUES,
  tag: EMPTY_VALUES,
  topic: EMPTY_VALUES,
  keyword: EMPTY_VALUES,
  contentType: EMPTY_VALUES,
});

export function isPreferenceKind(value: unknown): value is PreferenceKind {
  return typeof value === 'string' && (PREFERENCE_KINDS as readonly string[]).includes(value);
}

/**
 * Deterministic label normalization.
 *
 * Trimming and NFC normalization are always applied. Case folding uses the
 * locale-independent `toLowerCase`. No locale, environment, or time input is
 * consulted.
 */
export function normalizeLabel(value: string, caseSensitive: boolean): string {
  const normalized = value.trim().normalize('NFC');
  return caseSensitive ? normalized : normalized.toLowerCase();
}
