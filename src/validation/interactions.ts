import { RecometError } from '../errors/recomet-error.js';
import { isValidId } from '../internal/id.js';
import type { ResolvedEngineLimits } from '../internal/limits.js';
import {
  assertPlainRecord,
  ownStringKeys,
  readDataProperty,
  readDenseArray,
  UnsafeStructureError,
} from '../internal/safe-object.js';
import type { ValidatedInteraction } from '../collaborative/model.js';

const INTERACTION_KEYS = ['userId', 'itemId', 'type', 'value'] as const;

function isInteractionKey(key: string): key is (typeof INTERACTION_KEYS)[number] {
  return (INTERACTION_KEYS as readonly string[]).includes(key);
}

function invalidInteraction(index: number, message: string, path?: string): RecometError {
  return new RecometError('INVALID_INTERACTION', message, {
    index,
    path: path ?? `interactions[${index}]`,
  });
}

function isPrototypePollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

export function validateInteractions(
  value: unknown,
  limits: ResolvedEngineLimits,
): readonly ValidatedInteraction[] {
  let records: unknown[];
  try {
    records = readDenseArray(value, limits.maxInteractions);
  } catch (error) {
    if (error instanceof UnsafeStructureError && error.reason === 'too-long') {
      throw new RecometError('LIMIT_EXCEEDED', 'Interactions exceed the configured maximum.', {
        limit: limits.maxInteractions,
        path: 'interactions',
      });
    }
    if (error instanceof UnsafeStructureError) {
      throw new RecometError('INVALID_INTERACTION', 'Interactions have an unsupported structure.', {
        path: 'interactions',
      });
    }
    throw error;
  }

  const result: ValidatedInteraction[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const raw = records[index];
    try {
      assertPlainRecord(raw);
    } catch (error) {
      if (error instanceof UnsafeStructureError) {
        throw invalidInteraction(index, `Interaction at index ${index} must be a plain object.`);
      }
      throw error;
    }

    let keys: string[];
    try {
      keys = ownStringKeys(raw);
    } catch (error) {
      if (error instanceof UnsafeStructureError) {
        throw invalidInteraction(
          index,
          `Interaction at index ${index} has an unsupported structure.`,
        );
      }
      throw error;
    }
    for (const key of keys) {
      if (!isInteractionKey(key)) {
        throw invalidInteraction(
          index,
          `Interaction at index ${index} contains an unsupported field.`,
        );
      }
    }

    if (!keys.includes('userId') || !keys.includes('itemId') || !keys.includes('type')) {
      throw invalidInteraction(
        index,
        `Interaction at index ${index} requires userId, itemId, and type.`,
      );
    }

    let userId: unknown;
    let itemId: unknown;
    let type: unknown;
    try {
      userId = readDataProperty(raw, 'userId');
      itemId = readDataProperty(raw, 'itemId');
      type = readDataProperty(raw, 'type');
    } catch (error) {
      if (error instanceof UnsafeStructureError) {
        throw invalidInteraction(
          index,
          `Interaction at index ${index} has an unsupported structure.`,
        );
      }
      throw error;
    }

    if (!isValidId(userId, limits.maxIdLength)) {
      throw invalidInteraction(
        index,
        `Interaction at index ${index} has an invalid userId.`,
        `interactions[${index}].userId`,
      );
    }

    if (!isValidId(itemId, limits.maxIdLength)) {
      throw invalidInteraction(
        index,
        `Interaction at index ${index} has an invalid itemId.`,
        `interactions[${index}].itemId`,
      );
    }

    if (
      typeof type !== 'string' ||
      type.length === 0 ||
      type.length > limits.maxInteractionTypeLength ||
      type.includes('\u0000') ||
      isPrototypePollutionKey(type)
    ) {
      throw invalidInteraction(
        index,
        `Interaction at index ${index} has an invalid type.`,
        `interactions[${index}].type`,
      );
    }

    let numericValue: number | undefined;
    if (keys.includes('value')) {
      let value: unknown;
      try {
        value = readDataProperty(raw, 'value');
      } catch (error) {
        if (error instanceof UnsafeStructureError) {
          throw invalidInteraction(
            index,
            `Interaction at index ${index} has an unsupported structure.`,
            `interactions[${index}].value`,
          );
        }
        throw error;
      }
      // Phase 3: explicit interaction values must be finite and non-negative.
      // Negative values are rejected (no dislike-aware semantics in this phase).
      // Signed zero (-0) is canonicalized to 0; this is not negative-input clamping.
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw invalidInteraction(
          index,
          `Interaction at index ${index} has an invalid value.`,
          `interactions[${index}].value`,
        );
      }
      numericValue = Object.is(value, -0) ? 0 : value;
    }

    result.push(Object.freeze({ userId, itemId, type, value: numericValue }));
  }

  return result;
}
