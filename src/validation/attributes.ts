import type { EngineLimits } from '../contracts/config.js';
import { RecometError } from '../errors/recomet-error.js';
import {
  assertPlainRecord,
  ownStringKeys,
  readDataProperty,
  readDenseArray,
  UnsafeStructureError,
} from '../internal/safe-object.js';

export interface AttributeBudget {
  totalNodes: number;
  totalCharacters: number;
}

function isPrototypePollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function invalidAttributes(index: number): RecometError {
  return new RecometError(
    'INVALID_ITEM',
    `Item at index ${index} has an unsupported attribute structure.`,
    { index, path: `items[${index}].attributes` },
  );
}

function attributeLimit(index: number): RecometError {
  return new RecometError(
    'LIMIT_EXCEEDED',
    `Item at index ${index} exceeds an attribute resource budget.`,
    { index, path: `items[${index}].attributes` },
  );
}

interface AttributeFrame {
  readonly value: unknown;
  readonly depth: number;
}

/**
 * Validates a JSON-compatible attribute tree and updates the per-request budget.
 *
 * The traversal is iterative, bounded, and owns no reference after it returns.
 * Attributes are not copied into the result.
 */
export function validateAttributes(
  value: unknown,
  index: number,
  limits: EngineLimits,
  budget: AttributeBudget,
): void {
  let itemNodes = 0;
  const seen = new WeakSet<object>();
  const stack: AttributeFrame[] = [{ value, depth: 0 }];

  try {
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined) {
        break;
      }

      const { value: current, depth } = frame;

      if (depth > limits.maxAttributeDepth) {
        throw attributeLimit(index);
      }

      itemNodes += 1;
      budget.totalNodes += 1;
      if (itemNodes > limits.maxAttributeNodesPerItem) {
        throw attributeLimit(index);
      }
      if (budget.totalNodes > limits.maxTotalAttributeNodes) {
        throw attributeLimit(index);
      }

      if (current === null) {
        continue;
      }

      if (typeof current === 'string') {
        if (current.length > limits.maxAttributeStringLength) {
          throw attributeLimit(index);
        }
        budget.totalCharacters += current.length;
        if (budget.totalCharacters > limits.maxTotalAttributeCharacters) {
          throw attributeLimit(index);
        }
        continue;
      }

      if (typeof current === 'number') {
        if (!Number.isFinite(current)) {
          throw invalidAttributes(index);
        }
        continue;
      }

      if (typeof current === 'boolean') {
        continue;
      }

      if (typeof current !== 'object') {
        // undefined, bigint, symbol, and function are outside the contract.
        throw invalidAttributes(index);
      }

      if (seen.has(current)) {
        throw invalidAttributes(index);
      }
      seen.add(current);

      if (Array.isArray(current)) {
        const remainingItemNodes = limits.maxAttributeNodesPerItem - itemNodes;
        const remainingTotalNodes = limits.maxTotalAttributeNodes - budget.totalNodes;
        const elements = readDenseArray(current, Math.min(remainingItemNodes, remainingTotalNodes));
        for (const element of elements) {
          stack.push({ value: element, depth: depth + 1 });
        }
        continue;
      }

      assertPlainRecord(current);
      const keys = ownStringKeys(current);

      for (const key of keys) {
        if (isPrototypePollutionKey(key)) {
          throw invalidAttributes(index);
        }
        if (key.length > limits.maxAttributeStringLength) {
          throw attributeLimit(index);
        }

        itemNodes += 1;
        budget.totalNodes += 1;
        if (itemNodes > limits.maxAttributeNodesPerItem) {
          throw attributeLimit(index);
        }
        if (budget.totalNodes > limits.maxTotalAttributeNodes) {
          throw attributeLimit(index);
        }

        budget.totalCharacters += key.length;
        if (budget.totalCharacters > limits.maxTotalAttributeCharacters) {
          throw attributeLimit(index);
        }

        stack.push({ value: readDataProperty(current, key), depth: depth + 1 });
      }
    }
  } catch (error) {
    if (error instanceof RecometError) {
      throw error;
    }
    if (error instanceof UnsafeStructureError) {
      if (error.reason === 'too-long') {
        throw attributeLimit(index);
      }
      throw invalidAttributes(index);
    }
    throw error;
  }
}
