import { describe, expect, it } from 'vitest';
import { expectRecometError, makeRecommender, recommendRaw } from './helpers.js';

function attributesRequest(attributes: unknown) {
  return { items: [{ id: 'a', attributes }] };
}

function attributesRecommender(maxAttributeDepth = 4) {
  return makeRecommender({ limits: { maxAttributeDepth } });
}

describe('valid attribute trees', () => {
  it('accepts JSON-compatible primitives, arrays, and objects', () => {
    const request = attributesRequest({
      title: 'Synthetic article',
      count: 42,
      ratio: 0.25,
      published: true,
      draft: false,
      missing: null,
      tags: ['alpha', 'beta'],
      nested: { level: 1, values: [1, 2, 3] },
    });
    expect(() => recommendRaw(makeRecommender(), request)).not.toThrow();
  });

  it('accepts an empty attributes object', () => {
    expect(() => recommendRaw(makeRecommender(), attributesRequest({}))).not.toThrow();
  });

  it('accepts null-prototype records', () => {
    const attributes = Object.create(null) as Record<string, unknown>;
    attributes.key = 'value';
    expect(() => recommendRaw(makeRecommender(), attributesRequest(attributes))).not.toThrow();
  });

  it('accepts frozen attributes', () => {
    const attributes = Object.freeze({ key: Object.freeze({ nested: 'value' }) });
    expect(() => recommendRaw(makeRecommender(), attributesRequest(attributes))).not.toThrow();
  });

  it('accepts values at the configured depth boundary', () => {
    const recommender = attributesRecommender(4);
    const atBoundary = { a: { b: { c: { d: 1 } } } };
    expect(() => recommendRaw(recommender, attributesRequest(atBoundary))).not.toThrow();
  });

  it('does not expose or copy attributes into the result', () => {
    const result = recommendRaw(
      makeRecommender(),
      attributesRequest({ secret: 'do-not-echo', nested: { value: 1 } }),
    );
    expect(JSON.stringify(result)).not.toContain('do-not-echo');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

describe('invalid attribute values', () => {
  it('rejects non-finite numbers', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), attributesRequest({ value })),
        'INVALID_ITEM',
      );
    }
  });

  it('rejects values outside the JSON-compatible contract', () => {
    const values: unknown[] = [
      undefined,
      () => undefined,
      Symbol('value'),
      1n,
      new Date(),
      new Map(),
      new Set(),
      /regex/,
      new Uint8Array([1, 2, 3]),
    ];
    for (const value of values) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), attributesRequest({ value })),
        'INVALID_ITEM',
      );
    }
  });

  it('rejects cyclic references', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expectRecometError(
      () => recommendRaw(makeRecommender(), attributesRequest(cyclic)),
      'INVALID_ITEM',
    );
  });

  it('rejects shared object references', () => {
    const shared = { value: 1 };
    expectRecometError(
      () => recommendRaw(makeRecommender(), attributesRequest({ first: shared, second: shared })),
      'INVALID_ITEM',
    );
  });

  it('rejects class instances nested in attributes', () => {
    class Extra {
      readonly value = 1;
    }
    expectRecometError(
      () => recommendRaw(makeRecommender(), attributesRequest({ extra: new Extra() })),
      'INVALID_ITEM',
    );
  });

  it('rejects sparse arrays', () => {
    const sparse = new Array(3);
    sparse[0] = 'a';
    sparse[2] = 'c';
    expectRecometError(
      () => recommendRaw(makeRecommender(), attributesRequest({ list: sparse })),
      'INVALID_ITEM',
    );
  });

  it('rejects arrays with extra own properties', () => {
    const list = [1, 2] as number[] & { extra?: number };
    list.extra = 3;
    expectRecometError(
      () => recommendRaw(makeRecommender(), attributesRequest({ list })),
      'INVALID_ITEM',
    );
  });

  it('rejects accessors without invoking them', () => {
    let invoked = false;
    const attributes = {};
    Object.defineProperty(attributes, 'secret', {
      enumerable: true,
      get() {
        invoked = true;
        return 'value';
      },
    });

    expectRecometError(
      () => recommendRaw(makeRecommender(), attributesRequest(attributes)),
      'INVALID_ITEM',
    );
    expect(invoked).toBe(false);
  });

  it('rejects symbol keys', () => {
    expectRecometError(
      () => recommendRaw(makeRecommender(), attributesRequest({ [Symbol('hidden')]: 'value' })),
      'INVALID_ITEM',
    );
  });

  it('rejects non-enumerable keys', () => {
    const attributes = { visible: 1 };
    Object.defineProperty(attributes, 'hidden', { enumerable: false, value: 2 });
    expectRecometError(
      () => recommendRaw(makeRecommender(), attributesRequest(attributes)),
      'INVALID_ITEM',
    );
  });

  it('rejects prototype pollution keys', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const attributes: Record<string, unknown> = {};
      Object.defineProperty(attributes, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 'polluted',
      });
      expectRecometError(
        () => recommendRaw(makeRecommender(), attributesRequest(attributes)),
        'INVALID_ITEM',
      );
    }
  });
});

describe('attribute resource limits', () => {
  it('rejects trees deeper than maxAttributeDepth', () => {
    const recommender = attributesRecommender(4);
    const tooDeep = { a: { b: { c: { d: { e: 1 } } } } };
    expectRecometError(
      () => recommendRaw(recommender, attributesRequest(tooDeep)),
      'LIMIT_EXCEEDED',
    );
  });

  it('rejects an item above maxAttributeNodesPerItem', () => {
    const recommender = makeRecommender({ limits: { maxAttributeNodesPerItem: 3 } });
    expectRecometError(
      () => recommendRaw(recommender, attributesRequest({ a: 1, b: 2 })),
      'LIMIT_EXCEEDED',
    );
  });

  it('rejects strings longer than maxAttributeStringLength', () => {
    const recommender = makeRecommender({ limits: { maxAttributeStringLength: 4 } });
    expect(() => recommendRaw(recommender, attributesRequest({ key: 'four' }))).not.toThrow();
    expectRecometError(
      () => recommendRaw(recommender, attributesRequest({ key: 'five!' })),
      'LIMIT_EXCEEDED',
    );
  });

  it('rejects keys longer than maxAttributeStringLength', () => {
    const recommender = makeRecommender({ limits: { maxAttributeStringLength: 4 } });
    expectRecometError(
      () => recommendRaw(recommender, attributesRequest({ ['long-key']: 1 })),
      'LIMIT_EXCEEDED',
    );
  });

  it('rejects the request above maxTotalAttributeNodes', () => {
    const recommender = makeRecommender({ limits: { maxTotalAttributeNodes: 7 } });
    // First item: root + key + value = 3 nodes; second item would exceed 7.
    expectRecometError(
      () =>
        recommendRaw(recommender, {
          items: [
            { id: 'a', attributes: { first: 1 } },
            { id: 'b', attributes: { second: 2 } },
            { id: 'c', attributes: { third: 3 } },
          ],
        }),
      'LIMIT_EXCEEDED',
    );
  });

  it('rejects the request above maxTotalAttributeCharacters', () => {
    const recommender = makeRecommender({
      limits: { maxTotalAttributeCharacters: 10 },
    });
    expectRecometError(
      () =>
        recommendRaw(recommender, {
          items: [
            { id: 'a', attributes: { first: '123456' } },
            { id: 'b', attributes: { second: '123456' } },
          ],
        }),
      'LIMIT_EXCEEDED',
    );
  });

  it('rejects oversized arrays before allocating a copy', () => {
    const recommender = makeRecommender({ limits: { maxAttributeNodesPerItem: 2 } });
    expectRecometError(
      () => recommendRaw(recommender, attributesRequest({ list: [1, 2, 3, 4] })),
      'LIMIT_EXCEEDED',
    );
  });
});
