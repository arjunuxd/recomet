/**
 * Opaque identifier validation.
 *
 * IDs are not trimmed, normalized, parsed, or rewritten. They are compared by
 * exact string equality.
 */
export function isValidId(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !value.includes('\u0000')
  );
}
