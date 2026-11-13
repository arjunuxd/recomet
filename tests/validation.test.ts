import { describe, expect, it } from 'vitest';
import { expectRecometError, item, items, makeRecommender, recommendRaw } from './helpers.js';

describe('request validation', () => {
  it('rejects null, primitives, arrays, dates, and class instances', () => {
    class RequestLike {
      readonly items: unknown[] = [];
    }
    for (const value of [null, undefined, 1, 'request', true, [], new Date(), new RequestLike()]) {
      expectRecometError(() => recommendRaw(makeRecommender(), value), 'INVALID_REQUEST');
    }
  });

  it('requires an items field', () => {
    expectRecometError(() => recommendRaw(makeRecommender(), {}), 'INVALID_REQUEST');
  });

  it('rejects unknown request keys', () => {
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [], unknownField: 'u-1' }),
      'INVALID_REQUEST',
    );
  });

  it('rejects a non-array items value', () => {
    for (const value of [null, {}, 'items', 1, new Set()]) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), { items: value }),
        'INVALID_REQUEST',
      );
    }
  });

  it('rejects symbol and non-enumerable request keys', () => {
    const withSymbol = { items: [], [Symbol('extra')]: true };
    expectRecometError(() => recommendRaw(makeRecommender(), withSymbol), 'INVALID_REQUEST');

    const withHidden = { items: [] };
    Object.defineProperty(withHidden, 'metadata', { enumerable: false, value: 1 });
    expectRecometError(() => recommendRaw(makeRecommender(), withHidden), 'INVALID_REQUEST');
  });

  it('rejects accessor properties without invoking them', () => {
    let invoked = false;
    const request = {};
    Object.defineProperty(request, 'items', {
      enumerable: true,
      get() {
        invoked = true;
        return [];
      },
    });

    expectRecometError(() => recommendRaw(makeRecommender(), request), 'INVALID_REQUEST');
    expect(invoked).toBe(false);
  });

  it('rejects sparse arrays', () => {
    const sparse = new Array(3);
    sparse[0] = item('a');
    sparse[2] = item('c');
    expectRecometError(() => recommendRaw(makeRecommender(), { items: sparse }), 'INVALID_REQUEST');
  });

  it('rejects arrays with non-index own properties', () => {
    const withExtra = [item('a')] as unknown[] & { extra?: number };
    withExtra.extra = 1;
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: withExtra }),
      'INVALID_REQUEST',
    );
  });

  it('rejects item arrays that exceed the configured maximum', () => {
    const recommender = makeRecommender({ limits: { maxItems: 2 } });
    expectRecometError(() => recommendRaw(recommender, { items: items(3) }), 'LIMIT_EXCEEDED');
  });

  it('rejects non-object items', () => {
    for (const value of [null, 1, 'item', [], new Date(), () => undefined]) {
      expectRecometError(() => recommendRaw(makeRecommender(), { items: [value] }), 'INVALID_ITEM');
    }
  });

  it('rejects items with missing, empty, non-string, or oversized IDs', () => {
    expectRecometError(() => recommendRaw(makeRecommender(), { items: [{}] }), 'INVALID_ITEM');
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [{ id: '' }] }),
      'INVALID_ITEM',
    );
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [{ id: 1 }] }),
      'INVALID_ITEM',
    );
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [{ id: 'x'.repeat(257) }] }),
      'INVALID_ITEM',
    );
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [{ id: 'a\0b' }] }),
      'INVALID_ITEM',
    );
  });

  it('accepts IDs at the maximum length', () => {
    const id = 'x'.repeat(256);
    const result = recommendRaw(makeRecommender(), { items: [{ id }] });
    expect(result.recommendations[0]?.itemId).toBe(id);
  });

  it('rejects unknown item keys', () => {
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [{ id: 'a', score: 1 }] }),
      'INVALID_ITEM',
    );
  });

  it('rejects accessor item properties without invoking them', () => {
    let invoked = false;
    const rawItem = {};
    Object.defineProperty(rawItem, 'id', {
      enumerable: true,
      get() {
        invoked = true;
        return 'a';
      },
    });

    expectRecometError(() => recommendRaw(makeRecommender(), { items: [rawItem] }), 'INVALID_ITEM');
    expect(invoked).toBe(false);
  });

  it('rejects duplicate item IDs', () => {
    const error = expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('duplicate-secret'), item('duplicate-secret')],
        }),
      'DUPLICATE_ITEM_ID',
    );
    expect(error.message).not.toContain('duplicate-secret');
  });

  it('treats IDs as opaque and case-sensitive', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('A'), item('a'), item(' a '), item('a ')],
    });
    expect(result.recommendations.map((entry) => entry.itemId)).toEqual(['A', 'a', ' a ', 'a ']);
  });

  it('validates item attributes as a plain object', () => {
    for (const attributes of [null, 1, 'attributes', [], new Date()]) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), { items: [{ id: 'a', attributes }] }),
        'INVALID_ITEM',
      );
    }
  });

  it('rejects an explicit undefined attributes value', () => {
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [{ id: 'a', attributes: undefined }] }),
      'INVALID_ITEM',
    );
  });
});

describe('limit validation', () => {
  it('rejects invalid limit values', () => {
    const invalid: unknown[] = [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '10',
      null,
      true,
    ];
    for (const limit of invalid) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), { items: [item('a')], limit }),
        'INVALID_LIMIT',
      );
    }
  });

  it('rejects limits above the configured maximum', () => {
    const recommender = makeRecommender({ limits: { maxLimit: 2, defaultLimit: 2 } });
    expectRecometError(
      () => recommendRaw(recommender, { items: [item('a')], limit: 3 }),
      'INVALID_LIMIT',
    );
  });

  it('accepts boundary limits', () => {
    const recommender = makeRecommender({ limits: { maxLimit: 2, defaultLimit: 2 } });
    expect(() => recommendRaw(recommender, { items: [item('a')], limit: 1 })).not.toThrow();
    expect(() => recommendRaw(recommender, { items: [item('a')], limit: 2 })).not.toThrow();
  });
});

describe('exclusion validation', () => {
  it('rejects a non-array excludeItemIds value', () => {
    for (const value of [null, 'a', {}, new Set(['a'])]) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), { items: [], excludeItemIds: value }),
        'INVALID_REQUEST',
      );
    }
  });

  it('rejects invalid exclusion IDs', () => {
    for (const value of ['', 1, null, 'x'.repeat(257), 'a\0b']) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), { items: [], excludeItemIds: [value] }),
        'INVALID_REQUEST',
      );
    }
  });

  it('rejects exclusions above the configured maximum', () => {
    const recommender = makeRecommender({ limits: { maxExcludeItemIds: 1 } });
    expectRecometError(
      () => recommendRaw(recommender, { items: [], excludeItemIds: ['a', 'b'] }),
      'LIMIT_EXCEEDED',
    );
  });

  it('accepts an empty exclusion list', () => {
    expect(() =>
      recommendRaw(makeRecommender(), { items: [item('a')], excludeItemIds: [] }),
    ).not.toThrow();
  });
});
