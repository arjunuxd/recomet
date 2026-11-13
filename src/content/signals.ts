import { RecometError } from '../errors/recomet-error.js';
import { readDataProperty, readDenseArray, UnsafeStructureError } from '../internal/safe-object.js';
import type { ResolvedEngineLimits } from '../internal/limits.js';
import {
  EMPTY_SIGNALS,
  normalizeLabel,
  PREFERENCE_KINDS,
  type ContentSignals,
  type ResolvedContentConfig,
} from './model.js';

function invalidSignal(index: number): RecometError {
  return new RecometError(
    'INVALID_ITEM',
    `Item at index ${index} has an unsupported content signal attribute.`,
    { index, path: `items[${index}].attributes` },
  );
}

function signalLimit(index: number, limit: number): RecometError {
  return new RecometError(
    'LIMIT_EXCEEDED',
    `Item at index ${index} exceeds a content signal resource budget.`,
    { index, limit, path: `items[${index}].attributes` },
  );
}

function normalizeSignalValue(
  value: unknown,
  index: number,
  limits: ResolvedEngineLimits,
  caseSensitive: boolean,
): string {
  if (typeof value !== 'string') {
    throw invalidSignal(index);
  }
  if (value.length > limits.maxAttributeStringLength || value.includes('\u0000')) {
    throw signalLimit(index, limits.maxAttributeStringLength);
  }

  const normalized = normalizeLabel(value, caseSensitive);
  if (normalized.length === 0 || normalized.includes('\u0000')) {
    throw invalidSignal(index);
  }
  if (normalized.length > limits.maxAttributeStringLength) {
    throw signalLimit(index, limits.maxAttributeStringLength);
  }
  return normalized;
}

function readSignalValues(
  value: unknown,
  index: number,
  limits: ResolvedEngineLimits,
  caseSensitive: boolean,
): ReadonlySet<string> {
  if (typeof value === 'string') {
    return new Set([normalizeSignalValue(value, index, limits, caseSensitive)]);
  }

  if (!Array.isArray(value)) {
    throw invalidSignal(index);
  }

  let elements: unknown[];
  try {
    elements = readDenseArray(value, limits.maxSignalValuesPerItem);
  } catch (error) {
    if (error instanceof UnsafeStructureError) {
      if (error.reason === 'too-long') {
        throw signalLimit(index, limits.maxSignalValuesPerItem);
      }
      throw invalidSignal(index);
    }
    throw error;
  }

  const result = new Set<string>();
  for (const element of elements) {
    result.add(normalizeSignalValue(element, index, limits, caseSensitive));
  }
  return result;
}

/**
 * Extracts only the explicitly mapped content attributes. Other attributes are
 * ignored and are never interpreted as recommendation signals.
 *
 * The returned sets contain normalized strings created for this request; no
 * caller-owned object is retained.
 */
export function extractContentSignals(
  attributes: Record<string, unknown>,
  index: number,
  limits: ResolvedEngineLimits,
  content: ResolvedContentConfig,
): ContentSignals {
  try {
    const signals: Record<string, ReadonlySet<string>> = { ...EMPTY_SIGNALS };
    let present = false;

    for (const kind of PREFERENCE_KINDS) {
      const attributeKey = content.attributeMap[kind];
      const raw = readDataProperty(attributes, attributeKey);
      if (raw === undefined) {
        continue;
      }
      signals[kind] = readSignalValues(raw, index, limits, content.caseSensitive);
      present = true;
    }

    return present ? (Object.freeze(signals) as ContentSignals) : EMPTY_SIGNALS;
  } catch (error) {
    if (error instanceof RecometError) {
      throw error;
    }
    if (error instanceof UnsafeStructureError) {
      throw invalidSignal(index);
    }
    throw error;
  }
}
