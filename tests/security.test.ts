import { describe, expect, it } from 'vitest';
import { expectRecometError, item, makeRecommender, recommendRaw } from './helpers.js';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

describe('error privacy', () => {
  it('does not echo item ids, attribute keys, or attribute values', () => {
    const secrets = ['ID-SECRET-123', 'ATTRIBUTE-KEY-SECRET', 'ATTRIBUTE-VALUE-SECRET'] as const;

    const errors = [
      expectRecometError(
        () => recommendRaw(makeRecommender(), { items: [{ id: `${secrets[0]}\0` }] }),
        'INVALID_ITEM',
      ),
      expectRecometError(
        () => recommendRaw(makeRecommender(), { items: [item('a'), item('a')] }),
        'DUPLICATE_ITEM_ID',
      ),
      expectRecometError(
        () =>
          recommendRaw(makeRecommender(), {
            items: [{ id: 'a', attributes: { [secrets[1]]: 1 }, extra: secrets[2] }],
          }),
        'INVALID_ITEM',
      ),
      expectRecometError(
        () =>
          recommendRaw(makeRecommender(), {
            items: [{ id: 'a', attributes: { nested: NaN, [secrets[1]]: secrets[2] } }],
          }),
        'INVALID_ITEM',
      ),
      expectRecometError(
        () => recommendRaw(makeRecommender(), { items: [], excludeItemIds: [`${secrets[0]}\0`] }),
        'INVALID_REQUEST',
      ),
    ];

    for (const error of errors) {
      const serialized = `${error.message} ${JSON.stringify(error.details)} ${error.stack ?? ''}`;
      for (const secret of secrets) {
        expect(serialized).not.toContain(secret);
      }
      expect(error.message).not.toMatch(/items\[/);
    }
  });

  it('does not echo configuration values', () => {
    const error = expectRecometError(
      () => makeRecommender({ limits: { maxItems: 987_654_321 } }),
      'INVALID_CONFIG',
    );
    expect(error.message).not.toContain('987');
    expect(JSON.stringify(error.details)).not.toContain('987');
  });

  it('exposes only safe detail fields', () => {
    const duplicate = expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [item('a'), item('a')] }),
      'DUPLICATE_ITEM_ID',
    );
    expect(Object.keys(duplicate.details ?? {}).sort()).toEqual(['index', 'path']);
    expect(duplicate.details?.path).toBe('items[1].id');
  });

  it('never includes raw objects in error details', () => {
    const hostile = { secret: 'value' };
    const error = expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [hostile] }),
      'INVALID_ITEM',
    );
    expect(JSON.stringify(error.details)).not.toContain('secret');
    expect(error.details).not.toBe(hostile);
  });
});

describe('input handling', () => {
  it('does not mutate a deeply frozen request', () => {
    const request = deepFreeze({
      items: [
        { id: 'a', attributes: { title: 'Alpha', tags: ['one', 'two'] } },
        { id: 'b', attributes: { title: 'Beta' } },
      ],
      limit: 2,
      excludeItemIds: ['missing'],
    });

    const result = recommendRaw(makeRecommender(), request);
    expect(result.recommendations.map((entry) => entry.itemId)).toEqual(['a', 'b']);
  });

  it('does not change input order or values', () => {
    const request = {
      items: [item('c'), item('a'), item('b')],
      limit: 3,
      excludeItemIds: ['a'],
    };
    const before = JSON.stringify(request);
    recommendRaw(makeRecommender(), request);
    expect(JSON.stringify(request)).toBe(before);
  });

  it('does not retain attribute references after the call', () => {
    const attributes: Record<string, unknown> = { title: 'Original' };
    const request = { items: [{ id: 'a', attributes }] };
    const result = recommendRaw(makeRecommender(), request);

    attributes.title = 'Mutated';
    attributes.extra = 'added';

    expect(JSON.stringify(result)).not.toContain('Original');
    expect(JSON.stringify(result)).not.toContain('Mutated');
    expect(JSON.stringify(result)).not.toContain('added');
  });

  it('returns fresh, caller-owned result objects on every call', () => {
    const recommender = makeRecommender();
    const first = recommendRaw(recommender, { items: [item('a')] });
    const second = recommendRaw(recommender, { items: [item('a')] });

    expect(first).not.toBe(second);
    expect(first.recommendations).not.toBe(second.recommendations);
    expect(first.metadata).not.toBe(second.metadata);
    expect(first).toEqual(second);
  });

  it('does not expose extra enumerable fields', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a', { secret: 'hidden' })],
    });

    expect(Object.keys(result).sort()).toEqual(['metadata', 'recommendations', 'strategy']);
    expect(Object.keys(result.metadata).sort()).toEqual([
      'eligibleItems',
      'excludedItems',
      'limit',
      'returnedItems',
      'totalItems',
    ]);
    expect(Object.keys(result.recommendations[0] ?? {}).sort()).toEqual([
      'explanation',
      'itemId',
      'rank',
      'score',
    ]);
  });

  it('echoes only IDs, ranks, scores, and fixed explanation data', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a', { title: 'Secret title', userId: 'user-42' })],
    });
    const serialized = JSON.stringify(result);

    expect(serialized).toContain('"a"');
    expect(serialized).not.toContain('Secret title');
    expect(serialized).not.toContain('user-42');
    expect(serialized).not.toContain('facets');
  });
});

describe('isolation and global state', () => {
  it('keeps calls independent when interleaved', () => {
    const recommender = makeRecommender();
    const first = recommendRaw(recommender, { items: [item('a'), item('b')] });
    recommendRaw(recommender, { items: [item('z')], excludeItemIds: ['a'] });
    const second = recommendRaw(recommender, { items: [item('b'), item('a')] });

    expect(first.recommendations.map((entry) => entry.itemId)).toEqual(['a', 'b']);
    expect(second.recommendations.map((entry) => entry.itemId)).toEqual(['b', 'a']);
  });

  it('does not share configuration between instances', () => {
    const first = makeRecommender({ limits: { maxLimit: 1, defaultLimit: 1 } });
    const second = makeRecommender({ limits: { maxLimit: 100, defaultLimit: 50 } });

    const firstResult = recommendRaw(first, { items: [item('a'), item('b')] });
    const secondResult = recommendRaw(second, { items: [item('a'), item('b')] });

    expect(firstResult.metadata.limit).toBe(1);
    expect(secondResult.metadata.limit).toBe(50);
  });

  it('allows the returned result to be mutated without affecting later calls', () => {
    const recommender = makeRecommender();
    const result = recommendRaw(recommender, { items: [item('a'), item('b')] });
    (result.recommendations as unknown[]).length = 0;

    const next = recommendRaw(recommender, { items: [item('a'), item('b')] });
    expect(next.recommendations).toHaveLength(2);
  });
});
