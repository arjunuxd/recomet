import { describe, expect, it } from 'vitest';
import { createRecommender, RecometError } from '../src/index.js';
import { expectRecometError, item, makeRecommender, recommendRaw, resultIds } from './helpers.js';

describe('Phase 5 strategies and ranking', () => {
  it('accepts trending and discovery strategies with required inputs', () => {
    const trending = createRecommender({ strategy: 'trending' });
    const discovery = createRecommender({ strategy: 'discovery' });
    const now = Date.UTC(2026, 10, 13);
    const resultT = trending.recommend({
      items: [item('a'), item('b')],
      interactions: [{ userId: 'u1', itemId: 'a', type: 'view', timestamp: now - 1000 }],
      now,
    });
    const resultD = discovery.recommend({
      items: [item('a'), item('b')],
      interactions: [{ userId: 'u1', itemId: 'a', type: 'view', timestamp: now - 1000 }],
      now,
    });
    expect(resultT.strategy).toBe('trending');
    expect(resultD.strategy).toBe('discovery');
  });

  it('requires interactions and now for trending/discovery (deterministic time)', () => {
    const now = Date.UTC(2026, 10, 13);
    const trending = makeRecommender({ strategy: 'trending' });
    expectRecometError(
      () => recommendRaw(trending, { items: [item('a')], now }),
      'INVALID_REQUEST',
    );
    expectRecometError(
      () =>
        recommendRaw(trending, {
          items: [item('a')],
          interactions: [{ userId: 'u1', itemId: 'a', type: 'view', timestamp: now }],
        }),
      'INVALID_REQUEST',
    );
    const discovery = makeRecommender({ strategy: 'discovery' });
    expect(() =>
      recommendRaw(discovery, {
        items: [item('a')],
        interactions: [{ userId: 'u1', itemId: 'a', type: 'view' }],
        now,
      }),
    ).not.toThrow();
  });

  it('computes trending from explicit time window deterministically', () => {
    const now = 1_000_000;
    const recommender = makeRecommender({
      strategy: 'trending',
      ranking: { trending: { windowMs: 10_000, weight: 1 } },
    });
    const result = recommender.recommend({
      items: [item('a'), item('b'), item('c')],
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'view', timestamp: now - 1_000, value: 2 },
        { userId: 'u2', itemId: 'a', type: 'view', timestamp: now - 2_000, value: 1 },
        { userId: 'u1', itemId: 'b', type: 'view', timestamp: now - 9_000, value: 1 },
        { userId: 'u3', itemId: 'c', type: 'view', timestamp: now - 20_000, value: 10 }, // outside window
      ],
      now,
    });
    expect(resultIds(result)).toEqual(['a', 'b', 'c']);
    expect(result.recommendations[0]?.score).toBeGreaterThan(result.recommendations[1]!.score);
    expect(result.recommendations[2]?.score).toBe(0);
    expect(
      result.recommendations[0]?.explanation.components.some((c) => c.factor === 'trending'),
    ).toBe(true);
  });

  it('falls back truthfully when trending has no in-window signal', () => {
    const now = 100_000_000;
    const recommender = makeRecommender({ strategy: 'trending' });
    const result = recommender.recommend({
      items: [item('a'), item('b')],
      interactions: [{ userId: 'u1', itemId: 'a', type: 'view', timestamp: 1_000 }],
      now,
    });
    expect(result.strategy).toBe('baseline');
    expect(result.recommendations[0]?.explanation.summary).toContain('fallback');
  });

  it('supports discovery cold-start fallback and excludes seen user items when userId provided', () => {
    const now = 10_000_000;
    const recommender = makeRecommender({ strategy: 'discovery' });
    const result = recommender.recommend({
      items: [item('a'), item('b'), item('c')],
      userId: 'u1',
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'view', timestamp: 0 },
        { userId: 'u2', itemId: 'b', type: 'view', timestamp: 0, value: 5 },
        { userId: 'u3', itemId: 'c', type: 'view', timestamp: 0, value: 1 },
      ],
      now,
    });
    // no in-window trending -> popularity fallback; a seen by u1 excluded
    expect(result.strategy).toBe('discovery');
    expect(resultIds(result)).toEqual(['b', 'c']);
  });

  it('applies popularity and freshness ranking factors with injectable now', () => {
    const now = 10_000;
    const recommender = makeRecommender({
      strategy: 'baseline',
      ranking: {
        popularity: { weight: 1 },
        freshness: { attribute: 'ts', unit: 'ms', window: 10_000, weight: 1 },
      },
    });
    const result = recommender.recommend({
      items: [
        { id: 'old-popular', attributes: { ts: 0 } },
        { id: 'new', attributes: { ts: 9_900 } },
        { id: 'old', attributes: { ts: 0 } },
      ],
      interactions: [
        { userId: 'u1', itemId: 'old-popular', type: 'view', value: 10 },
        { userId: 'u2', itemId: 'new', type: 'view', value: 1 },
      ],
      now,
    });
    expect(resultIds(result)[0]).toBeDefined();
    const factors = new Set(
      result.recommendations.flatMap((r) => r.explanation.components.map((c) => c.factor)),
    );
    expect(factors.has('popularity')).toBe(true);
    expect(factors.has('freshness')).toBe(true);
  });

  it('applies deterministic diversity re-ranking with bounded grouping', () => {
    const recommender = makeRecommender({
      strategy: 'baseline',
      ranking: {
        diversity: { attribute: 'cat', maxPerGroup: 1, weight: 10 },
        popularity: { weight: 1 },
      },
    });
    const result = recommender.recommend({
      items: [
        { id: 'a1', attributes: { cat: 'A' } },
        { id: 'a2', attributes: { cat: 'A' } },
        { id: 'b1', attributes: { cat: 'B' } },
      ],
      interactions: [
        { userId: 'u1', itemId: 'a1', type: 'view', value: 5 },
        { userId: 'u1', itemId: 'a2', type: 'view', value: 4 },
        { userId: 'u1', itemId: 'b1', type: 'view', value: 1 },
      ],
    });
    expect(resultIds(result)).toEqual(['a1', 'b1', 'a2']);
    expect(
      result.recommendations[2]?.explanation.components.some((c) => c.factor === 'diversity'),
    ).toBe(true);
  });

  it('validates ranking config and request time/interaction inputs', () => {
    expect(() => createRecommender({ ranking: { freshness: { unit: 'hours' as never } } })).toThrow(
      RecometError,
    );
    expect(() => createRecommender({ ranking: { diversity: { maxPerGroup: 0 } } })).toThrow(
      RecometError,
    );
    const r = makeRecommender({ strategy: 'trending' });
    expectRecometError(
      () =>
        recommendRaw(r, {
          items: [item('a')],
          interactions: [{ userId: 'u', itemId: 'a', type: 'v', timestamp: -1 }],
          now: 1,
        }),
      'INVALID_INTERACTION',
    );
    expectRecometError(
      () =>
        recommendRaw(r, {
          items: [item('a')],
          interactions: [{ userId: 'u', itemId: 'a', type: 'v', timestamp: 1 }],
          now: -1,
        }),
      'INVALID_REQUEST',
    );
  });

  it('preserves auto strategy precedence and does not auto-select trending/discovery', () => {
    const auto = makeRecommender({ strategy: 'auto', ranking: { trending: { windowMs: 10_000 } } });
    const now = 1000;
    const result = auto.recommend({
      items: [item('a'), item('b')],
      interactions: [{ userId: 'u1', itemId: 'a', type: 'view', timestamp: now - 1 }],
      now,
    });
    // auto requires collaborative context (userId + interaction by target) to choose collaborative;
    // without userId it falls back by existing precedence, not to trending.
    expect(['baseline', 'content', 'collaborative']).toContain(result.strategy);
  });

  it('keeps existing public strategy behavior compatible', () => {
    const baseline = makeRecommender({ strategy: 'baseline' });
    const r = baseline.recommend({ items: [item('a'), item('b')], excludeItemIds: ['a'] });
    expect(r.strategy).toBe('baseline');
    expect(resultIds(r)).toEqual(['b']);
  });
});
