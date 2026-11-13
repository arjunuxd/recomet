import { describe, expect, it } from 'vitest';
import {
  expectRecometError,
  item,
  items,
  makeRecommender,
  recommendRaw,
  resultIds,
} from './helpers.js';

function fullSignalItem(id: string, category = 'space') {
  return item(id, {
    category,
    tags: ['ai', 'robotics'],
    topics: ['exploration'],
    keywords: ['orbit'],
    contentType: 'article',
  });
}

const fullPreferences = {
  interests: [
    { kind: 'category' as const, value: 'space', weight: 3 },
    { kind: 'tag' as const, value: 'ai', weight: 2 },
    { kind: 'tag' as const, value: 'robotics' },
    { kind: 'topic' as const, value: 'exploration' },
    { kind: 'keyword' as const, value: 'orbit' },
    { kind: 'contentType' as const, value: 'article' },
  ],
};

describe('content-based scoring', () => {
  it('ranks a fully matching item first with explainable factors', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [
        item('mismatch', {
          category: 'cooking',
          tags: ['recipes'],
          topics: ['food'],
          keywords: ['dinner'],
          contentType: 'video',
        }),
        fullSignalItem('match'),
        item('cold-start'),
      ],
      preferences: fullPreferences,
      limit: 3,
    });

    expect(result.strategy).toBe('content');
    expect(resultIds(result)).toEqual(['match', 'mismatch', 'cold-start']);
    expect(result.recommendations.map((entry) => entry.score)).toEqual([1, 0, 0]);

    const explanation = result.recommendations[0]?.explanation;
    expect(explanation?.strategy).toBe('content');
    expect(explanation?.summary).toBe(
      'Content-based relevance from explicit preferences; no interaction history was used.',
    );
    expect(explanation?.components.map((component) => component.factor)).toEqual([
      'category',
      'tag',
      'topic',
      'keyword',
      'contentType',
    ]);
    expect(explanation?.components.map((component) => component.value)).toEqual([1, 1, 1, 1, 1]);
    expect(explanation?.components.map((component) => component.weight)).toEqual([1, 1, 1, 1, 1]);
    const contributionTotal = explanation?.components.reduce(
      (sum, component) => sum + component.contribution,
      0,
    );
    expect(contributionTotal).toBeCloseTo(1, 12);
  });

  it('uses weighted coverage within a preference kind', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('partial', { tags: ['ai'] })],
      preferences: {
        interests: [
          { kind: 'tag', value: 'ai', weight: 2 },
          { kind: 'tag', value: 'robotics', weight: 1 },
        ],
      },
    });

    expect(result.recommendations[0]?.score).toBeCloseTo(2 / 3, 12);
    expect(result.recommendations[0]?.explanation.components).toEqual([
      { factor: 'tag', value: 2 / 3, weight: 1, contribution: 2 / 3 },
    ]);
  });

  it('combines kinds with documented default weights', () => {
    const request = {
      items: [item('a', { category: 'space' })],
      preferences: {
        interests: [
          { kind: 'category' as const, value: 'space' },
          { kind: 'tag' as const, value: 'ai' },
        ],
      },
    };

    const defaultResult = recommendRaw(makeRecommender(), request);
    expect(defaultResult.recommendations[0]?.score).toBe(0.5);

    const weightedResult = recommendRaw(
      makeRecommender({ content: { weights: { category: 3, tag: 1 } } }),
      request,
    );
    expect(weightedResult.recommendations[0]?.score).toBe(0.75);
  });

  it('matches content types and keywords as categorical labels', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [
        item('article', { contentType: 'article', keywords: ['orbit'] }),
        item('video', { contentType: 'video', keywords: ['orbit'] }),
      ],
      preferences: {
        interests: [
          { kind: 'contentType', value: 'article' },
          { kind: 'keyword', value: 'orbit' },
        ],
      },
    });

    expect(resultIds(result)).toEqual(['article', 'video']);
    expect(result.recommendations[0]?.score).toBe(1);
    expect(result.recommendations[1]?.score).toBe(0.5);
  });

  it('deduplicates duplicate content labels', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a', { tags: ['ai', ' AI ', 'ai'] })],
      preferences: { interests: [{ kind: 'tag', value: 'ai' }] },
    });
    expect(result.recommendations[0]?.score).toBe(1);
  });

  it('normalizes labels case-insensitively unless configured otherwise', () => {
    const request = {
      items: [item('a', { category: 'Space' })],
      preferences: { interests: [{ kind: 'category' as const, value: ' space ' }] },
    };
    expect(recommendRaw(makeRecommender(), request).recommendations[0]?.score).toBe(1);
    expect(
      recommendRaw(makeRecommender({ content: { caseSensitive: true } }), request)
        .recommendations[0]?.score,
    ).toBe(0);
  });

  it('supports developer-defined attribute mappings', () => {
    const result = recommendRaw(
      makeRecommender({
        strategy: 'content',
        content: {
          attributes: {
            category: 'section',
            tag: 'labels',
            topic: 'subjects',
            keyword: 'terms',
            contentType: 'kind',
          },
        },
      }),
      {
        items: [
          item('a', {
            section: 'space',
            labels: ['ai', 'robotics'],
            subjects: ['exploration'],
            terms: ['orbit'],
            kind: 'article',
          }),
          item('b', { category: 'space' }),
        ],
        preferences: fullPreferences,
      },
    );

    expect(resultIds(result)).toEqual(['a', 'b']);
    expect(result.recommendations[0]?.score).toBe(1);
    expect(result.recommendations[1]?.score).toBe(0);
  });

  it('does not interpret nested attributes as signals', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a', { metadata: { category: 'space' } })],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
    });
    expect(result.recommendations[0]?.score).toBe(0);
  });

  it('handles missing optional attributes as zero relevance, not an error', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a'), item('b', { category: 'space' })],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
    });

    expect(result.strategy).toBe('content');
    expect(resultIds(result)).toEqual(['b', 'a']);
    expect(result.recommendations.map((entry) => entry.score)).toEqual([1, 0]);
  });
});

describe('content request integration', () => {
  it('falls back to the exact Phase 1 baseline when preferences are omitted', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a', { category: 'space' })],
    });

    expect(result).toEqual({
      strategy: 'baseline',
      recommendations: [
        {
          itemId: 'a',
          rank: 1,
          score: 0.5,
          explanation: {
            strategy: 'baseline',
            summary: 'Neutral baseline: no personalization or relevance model was applied.',
            components: [{ factor: 'baseline', value: 0.5, weight: 1, contribution: 0.5 }],
          },
        },
      ],
      metadata: {
        totalItems: 1,
        eligibleItems: 1,
        excludedItems: 0,
        returnedItems: 1,
        limit: 10,
      },
    });
  });

  it('falls back to baseline when explicit preferences are empty', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a')],
      preferences: { interests: [] },
    });
    expect(result.strategy).toBe('baseline');
    expect(result.recommendations[0]?.score).toBe(0.5);
  });

  it('falls back to baseline when content is configured but no preferences exist', () => {
    const result = recommendRaw(makeRecommender({ strategy: 'content' }), {
      items: [item('a')],
    });
    expect(result.strategy).toBe('baseline');
    expect(result.recommendations[0]?.score).toBe(0.5);
  });

  it('selects content automatically for usable preferences', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a', { category: 'space' })],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
    });
    expect(result.strategy).toBe('content');
  });

  it('applies exclusions and top-k after content ranking', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [
        item('high', { category: 'space', tags: ['ai'] }),
        item('excluded', { category: 'space', tags: ['ai'] }),
        item('medium', { category: 'space' }),
        item('low', { category: 'cooking' }),
      ],
      preferences: {
        interests: [
          { kind: 'category', value: 'space' },
          { kind: 'tag', value: 'ai' },
        ],
      },
      excludeItemIds: ['excluded'],
      limit: 2,
    });

    expect(resultIds(result)).toEqual(['high', 'medium']);
    expect(result.metadata.excludedItems).toBe(1);
    expect(result.metadata.eligibleItems).toBe(3);
    expect(result.metadata.returnedItems).toBe(2);
  });

  it('preserves input order for equal content scores', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [
        item('third', { category: 'space' }),
        item('first', { category: 'space' }),
        item('second', { category: 'space' }),
      ],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
      limit: 3,
    });
    expect(resultIds(result)).toEqual(['third', 'first', 'second']);
  });

  it('returns an empty successful content result for an empty item list', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
    });
    expect(result.strategy).toBe('content');
    expect(result.recommendations).toEqual([]);
    expect(result.metadata.totalItems).toBe(0);
  });

  it('is deterministic across repeated content calls', () => {
    const recommender = makeRecommender();
    const request = {
      items: Array.from({ length: 200 }, (_, index) =>
        item(`item-${index}`, {
          category: index % 3 === 0 ? 'space' : 'cooking',
          tags: index % 2 === 0 ? ['ai'] : ['recipes'],
        }),
      ),
      preferences: {
        interests: [
          { kind: 'category' as const, value: 'space', weight: 2 },
          { kind: 'tag' as const, value: 'ai' },
        ],
      },
      limit: 50,
    };

    const first = recommendRaw(recommender, request);
    for (let call = 0; call < 5; call += 1) {
      expect(recommendRaw(recommender, request)).toEqual(first);
    }
  });

  it('keeps all content scores finite and within [0, 1]', () => {
    const recommender = makeRecommender({ limits: { maxLimit: 500 } });
    const result = recommendRaw(recommender, {
      items: Array.from({ length: 500 }, (_, index) =>
        item(`item-${index}`, {
          category: index % 5 === 0 ? 'space' : 'cooking',
          tags: index % 4 === 0 ? ['ai'] : ['recipes'],
          topics: index % 7 === 0 ? ['exploration'] : ['food'],
        }),
      ),
      preferences: {
        interests: [
          { kind: 'category', value: 'space', weight: 0.25 },
          { kind: 'tag', value: 'ai', weight: 2.5 },
          { kind: 'topic', value: 'exploration', weight: 999 },
        ],
      },
      limit: 500,
    });

    for (const recommendation of result.recommendations) {
      expect(Number.isFinite(recommendation.score)).toBe(true);
      expect(recommendation.score).toBeGreaterThanOrEqual(0);
      expect(recommendation.score).toBeLessThanOrEqual(1);
      for (const component of recommendation.explanation.components) {
        expect(Number.isFinite(component.value)).toBe(true);
        expect(component.value).toBeGreaterThanOrEqual(0);
        expect(component.value).toBeLessThanOrEqual(1);
        expect(Number.isFinite(component.contribution)).toBe(true);
      }
    }
  });

  it('does not echo content signal or preference values in results', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [
        item('a', {
          category: 'CATEGORY-SECRET-123',
          tags: ['TAG-SECRET-456'],
        }),
      ],
      preferences: {
        interests: [
          { kind: 'category', value: 'CATEGORY-SECRET-123' },
          { kind: 'tag', value: 'TAG-SECRET-456' },
        ],
      },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('CATEGORY-SECRET-123');
    expect(serialized).not.toContain('TAG-SECRET-456');
    expect(serialized).toContain('"a"');
  });
});

describe('content signal validation', () => {
  it('rejects unsupported mapped signal values when content scoring is active', () => {
    for (const tags of [null, 1, true, { nested: true }, ['ai', 1], [null]]) {
      expectRecometError(
        () =>
          recommendRaw(makeRecommender(), {
            items: [item('a', { tags })],
            preferences: { interests: [{ kind: 'tag', value: 'ai' }] },
          }),
        'INVALID_ITEM',
      );
    }
  });

  it('rejects empty or whitespace-only signal labels when content scoring is active', () => {
    for (const tags of ['', '   ', ['ai', '']]) {
      expectRecometError(
        () =>
          recommendRaw(makeRecommender(), {
            items: [item('a', { tags })],
            preferences: { interests: [{ kind: 'tag', value: 'ai' }] },
          }),
        'INVALID_ITEM',
      );
    }
  });

  it('rejects signal arrays above the configured maximum', () => {
    const recommender = makeRecommender({ limits: { maxSignalValuesPerItem: 2 } });
    expect(() =>
      recommendRaw(recommender, {
        items: [item('a', { tags: ['ai', 'robotics'] })],
        preferences: { interests: [{ kind: 'tag', value: 'ai' }] },
      }),
    ).not.toThrow();
    expectRecometError(
      () =>
        recommendRaw(recommender, {
          items: [item('a', { tags: ['ai', 'robotics', 'space'] })],
          preferences: { interests: [{ kind: 'tag', value: 'ai' }] },
        }),
      'LIMIT_EXCEEDED',
    );
  });

  it('does not inspect mapped signal attributes during baseline requests', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a', { tags: { nested: true } })],
    });
    expect(result.strategy).toBe('baseline');
    expect(result.recommendations[0]?.score).toBe(0.5);
  });

  it('rejects malformed signal structures when content scoring is active', () => {
    const sparse = new Array(2);
    sparse[0] = 'ai';
    expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('a', { tags: sparse })],
          preferences: { interests: [{ kind: 'tag', value: 'ai' }] },
        }),
      'INVALID_ITEM',
    );

    const withExtra = ['ai'] as string[] & { extra?: number };
    withExtra.extra = 1;
    expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('a', { tags: withExtra })],
          preferences: { interests: [{ kind: 'tag', value: 'ai' }] },
        }),
      'INVALID_ITEM',
    );
  });
});

describe('content baseline regression', () => {
  it('keeps Phase 1 ordering and metadata when no preferences are supplied', () => {
    const recommender = makeRecommender();
    const requestItems = items(100);
    const result = recommendRaw(recommender, { items: requestItems, limit: 100 });
    expect(resultIds(result)).toEqual(requestItems.map((entry) => entry.id));
    expect(result.recommendations.every((entry) => entry.score === 0.5)).toBe(true);
    expect(result.strategy).toBe('baseline');
  });
});
