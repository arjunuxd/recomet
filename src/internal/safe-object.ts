/**
 * Bounded, own-property inspection helpers.
 *
 * These helpers read own data descriptors and never invoke user getters,
 * `toJSON`, `valueOf`, or similar hooks. JavaScript proxies can still run traps
 * during the unavoidable inspection operations (prototype lookup, key
 * enumeration, descriptor lookup). See SECURITY.md §4.4.
 */

export type UnsafeStructureReason =
  | 'not-object'
  | 'not-plain-object'
  | 'not-array'
  | 'not-plain-array'
  | 'symbol-key'
  | 'non-enumerable-key'
  | 'accessor'
  | 'extra-key'
  | 'hole'
  | 'too-long'
  | 'invalid-array';

export class UnsafeStructureError extends Error {
  readonly reason: UnsafeStructureReason;

  constructor(reason: UnsafeStructureReason) {
    // The message deliberately contains no key, value, or identifier.
    super('Unsafe or unsupported object structure');
    this.name = 'UnsafeStructureError';
    this.reason = reason;
  }
}

const hasOwn = Object.prototype.hasOwnProperty;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertPlainRecord(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnsafeStructureError('not-object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new UnsafeStructureError('not-plain-object');
  }
}

/**
 * Returns own enumerable string keys after rejecting symbols, accessors, and
 * non-enumerable own properties. The caller compares the result with an
 * allowlist.
 */
export function ownStringKeys(object: object): string[] {
  const keys = Reflect.ownKeys(object);
  const result: string[] = [];

  for (const key of keys) {
    if (typeof key === 'symbol') {
      throw new UnsafeStructureError('symbol-key');
    }
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor === undefined) {
      throw new UnsafeStructureError('extra-key');
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new UnsafeStructureError('accessor');
    }
    if (!descriptor.enumerable) {
      throw new UnsafeStructureError('non-enumerable-key');
    }
    result.push(key);
  }

  return result;
}

/**
 * Reads an own data property without invoking an accessor. Returns undefined
 * when the property is absent. Callers that need to distinguish absence from an
 * explicit undefined value should inspect the key list first.
 */
export function readDataProperty(object: object, key: string): unknown {
  if (!hasOwn.call(object, key)) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) {
    throw new UnsafeStructureError('extra-key');
  }
  if (descriptor.get !== undefined || descriptor.set !== undefined) {
    throw new UnsafeStructureError('accessor');
  }
  if (!descriptor.enumerable) {
    throw new UnsafeStructureError('non-enumerable-key');
  }
  return descriptor.value;
}

/**
 * Reads a dense array of own data elements, rejecting holes, accessors,
 * non-index properties, symbol keys, and non-standard array prototypes.
 *
 * A new array of references is returned. The maximum length is checked before
 * allocating the result array.
 */
export function readDenseArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new UnsafeStructureError('not-array');
  }

  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new UnsafeStructureError('not-plain-array');
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.get !== undefined ||
    lengthDescriptor.set !== undefined ||
    typeof lengthDescriptor.value !== 'number'
  ) {
    throw new UnsafeStructureError('invalid-array');
  }

  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new UnsafeStructureError('invalid-array');
  }
  if (length > maxLength) {
    throw new UnsafeStructureError('too-long');
  }

  const result = new Array<unknown>(length);
  let seen = 0;

  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') {
      continue;
    }
    if (typeof key === 'symbol') {
      throw new UnsafeStructureError('symbol-key');
    }

    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
      throw new UnsafeStructureError('extra-key');
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      throw new UnsafeStructureError('hole');
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new UnsafeStructureError('accessor');
    }
    if (!descriptor.enumerable) {
      throw new UnsafeStructureError('non-enumerable-key');
    }

    result[index] = descriptor.value;
    seen += 1;
  }

  if (seen !== length) {
    throw new UnsafeStructureError('hole');
  }

  return result;
}
