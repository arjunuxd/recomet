import type {
  RecometErrorCategory,
  RecometErrorCode,
  RecometErrorDetails,
} from '../contracts/errors.js';

const CATEGORY_BY_CODE: Readonly<Record<RecometErrorCode, RecometErrorCategory>> = {
  INVALID_CONFIG: 'configuration',
  UNSUPPORTED_STRATEGY: 'configuration',
  INVALID_REQUEST: 'validation',
  INVALID_ITEM: 'validation',
  INVALID_PREFERENCES: 'validation',
  INVALID_INTERACTION: 'validation',
  DUPLICATE_ITEM_ID: 'validation',
  INVALID_LIMIT: 'validation',
  LIMIT_EXCEEDED: 'limit',
  INTERNAL_ERROR: 'internal',
};

/**
 * Typed, value-free error raised by Recomet.
 *
 * Messages and details must never include input values, identifiers, attribute
 * keys, configuration values, or raw objects. Constructors are internal; callers
 * receive instances and may read `code`, `category`, and `details`.
 */
export class RecometError extends Error {
  readonly code: RecometErrorCode;
  readonly category: RecometErrorCategory;
  readonly details: RecometErrorDetails | undefined;

  constructor(code: RecometErrorCode, message: string, details?: RecometErrorDetails) {
    super(message);
    this.name = 'RecometError';
    this.code = code;
    this.category = CATEGORY_BY_CODE[code];
    this.details = details === undefined ? undefined : Object.freeze({ ...details });
  }
}

export function isRecometError(value: unknown): value is RecometError {
  return value instanceof RecometError;
}
