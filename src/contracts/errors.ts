export type RecometErrorCategory = 'configuration' | 'validation' | 'limit' | 'internal';

export type RecometErrorCode =
  | 'INVALID_CONFIG'
  | 'UNSUPPORTED_STRATEGY'
  | 'INVALID_REQUEST'
  | 'INVALID_ITEM'
  | 'INVALID_PREFERENCES'
  | 'INVALID_INTERACTION'
  | 'DUPLICATE_ITEM_ID'
  | 'INVALID_LIMIT'
  | 'LIMIT_EXCEEDED'
  | 'INTERNAL_ERROR';

/**
 * Safe, value-free error details.
 *
 * `path` may contain only fixed field names and numeric indexes. It must never
 * contain item IDs, attribute keys, attribute values, or user data.
 */
export interface RecometErrorDetails {
  readonly index?: number;
  readonly path?: string;
  readonly limit?: number;
}
