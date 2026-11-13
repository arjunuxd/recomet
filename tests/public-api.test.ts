import { describe, expect, it } from 'vitest';
import {
  createRecommender,
  RecometError,
  type RecommendationRequest,
  type RecommendationResult,
} from '../src/index.js';
import {
  expectRecometError,
  item,
  items,
  makeRecommender,
  recommendRaw,
  resultIds,
} from './helpers.js';

describe('public API', () => {
  it('creates a recommender with no configuration', () => {
    const recommender = createRecommender();
    expect(typeof recommender.recommend).toBe('function');
  });

  it('returns a result synchronously, not a Promise', () => {
    const recommender = makeRecommender();
    const result = recommender.recommend({ items: [item('a')] });

    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof (result as RecommendationResult).recommendations.length).toBe('number');
  });

  it('accepts a strategy of baseline', () => {
    const recommender = makeRecommender({ strategy: 'baseline' });
    const result = recommender.recommend({ items: [item('a')] });
    expect(result.strategy).toBe('baseline');
  });

  it('recommends every eligible item when the limit allows', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a'), item('b'), item('c')],
    });

    expect(resultIds(result)).toEqual(['a', 'b', 'c']);
    expect(result.metadata).toEqual({
      totalItems: 3,
      eligibleItems: 3,
      excludedItems: 0,
      returnedItems: 3,
      limit: 10,
    });
  });

  it('applies the default limit to larger collections', () => {
    const result = recommendRaw(makeRecommender(), { items: items(25) });
    expect(result.recommendations).toHaveLength(10);
    expect(result.metadata.returnedItems).toBe(10);
    expect(result.metadata.limit).toBe(10);
  });

  it('returns an empty result for an empty item list', () => {
    const result = recommendRaw(makeRecommender(), { items: [] });
    expect(result.recommendations).toEqual([]);
    expect(result.metadata).toEqual({
      totalItems: 0,
      eligibleItems: 0,
      excludedItems: 0,
      returnedItems: 0,
      limit: 10,
    });
  });

  it('returns a structured neutral explanation for each recommendation', () => {
    const result = recommendRaw(makeRecommender(), { items: [item('a')] });
    const [recommendation] = result.recommendations;

    expect(recommendation).toEqual({
      itemId: 'a',
      rank: 1,
      score: 0.5,
      explanation: {
        strategy: 'baseline',
        summary: 'Neutral baseline: no personalization or relevance model was applied.',
        components: [
          {
            factor: 'baseline',
            value: 0.5,
            weight: 1,
            contribution: 0.5,
          },
        ],
      },
    });
  });

  it('ranks with 1-based contiguous ranks', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a'), item('b'), item('c')],
      limit: 2,
    });
    expect(result.recommendations.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  it('uses the request limit when provided', () => {
    const result = recommendRaw(makeRecommender(), {
      items: items(5),
      limit: 3,
    });
    expect(result.recommendations).toHaveLength(3);
    expect(result.metadata.limit).toBe(3);
  });

  it('caps the limit at the number of eligible items', () => {
    const result = recommendRaw(makeRecommender(), {
      items: items(2),
      limit: 100,
    });
    expect(result.recommendations).toHaveLength(2);
    expect(result.metadata.returnedItems).toBe(2);
  });

  it('supports configuration limits and rejects values above them', () => {
    const recommender = makeRecommender({ limits: { maxLimit: 2, defaultLimit: 2 } });
    expect(recommendRaw(recommender, { items: items(5) }).recommendations).toHaveLength(2);

    expectRecometError(
      () => recommendRaw(recommender, { items: items(5), limit: 3 }),
      'INVALID_LIMIT',
    );
  });

  it('throws RecometError for invalid configuration synchronously', () => {
    expect(() => createRecommender({ strategy: 'unknown-strategy' } as never)).toThrow(
      RecometError,
    );
  });

  it('accepts a strategy of content', () => {
    const recommender = makeRecommender({ strategy: 'content' });
    const result = recommender.recommend({
      items: [item('a', { category: 'space' })],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
    });
    expect(result.strategy).toBe('content');
  });
});

describe('exclusions', () => {
  it('removes excluded items while preserving relative order', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a'), item('b'), item('c'), item('d')],
      excludeItemIds: ['b', 'd'],
    });

    expect(resultIds(result)).toEqual(['a', 'c']);
    expect(result.metadata.excludedItems).toBe(2);
    expect(result.metadata.eligibleItems).toBe(2);
  });

  it('treats exclusions that do not match any item as no-ops', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a')],
      excludeItemIds: ['missing'],
    });

    expect(resultIds(result)).toEqual(['a']);
    expect(result.metadata.excludedItems).toBe(0);
  });

  it('allows duplicate exclusion entries', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a'), item('b')],
      excludeItemIds: ['a', 'a'],
    });

    expect(resultIds(result)).toEqual(['b']);
    expect(result.metadata.excludedItems).toBe(1);
  });

  it('returns an empty list when everything is excluded', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a'), item('b')],
      excludeItemIds: ['a', 'b'],
    });

    expect(result.recommendations).toEqual([]);
    expect(result.metadata.eligibleItems).toBe(0);
    expect(result.metadata.excludedItems).toBe(2);
  });

  it('excludes by exact, case-sensitive ID equality', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('A'), item('a')],
      excludeItemIds: ['A'],
    });

    expect(resultIds(result)).toEqual(['a']);
  });
});

describe('baseline semantics', () => {
  it('scores every eligible item exactly 0.5', () => {
    const result = recommendRaw(makeRecommender(), { items: items(20), limit: 20 });
    for (const recommendation of result.recommendations) {
      expect(recommendation.score).toBe(0.5);
    }
  });

  it('preserves input order for equal scores', () => {
    const requestItems = items(50);
    const result = recommendRaw(makeRecommender(), { items: requestItems, limit: 50 });
    expect(resultIds(result)).toEqual(requestItems.map((entry) => entry.id));
  });

  it('does not consult attributes for ranking', () => {
    const recommender = makeRecommender();
    const plain = recommendRaw(recommender, { items: [item('a'), item('b'), item('c')] });
    const withAttributes = recommendRaw(recommender, {
      items: [
        item('a', { popularity: 1_000_000, topic: 'sports' }),
        item('b', { popularity: 0, topic: 'news' }),
        item('c', { popularity: 999_999, topic: 'sports' }),
      ],
    });

    expect(resultIds(withAttributes)).toEqual(resultIds(plain));
    expect(withAttributes.recommendations.map((entry) => entry.score)).toEqual(
      plain.recommendations.map((entry) => entry.score),
    );
  });

  it('is deterministic across repeated calls', () => {
    const recommender = makeRecommender();
    const request: RecommendationRequest = { items: items(100), limit: 25 };
    const first = recommendRaw(recommender, request);
    for (let call = 0; call < 5; call += 1) {
      expect(recommendRaw(recommender, request)).toEqual(first);
    }
  });
});
