import { describe, expect, it } from 'vitest';
import { expectRecometError, item, makeRecommender, recommendRaw, resultIds } from './helpers.js';

function requestWith(interests: unknown[], extra: Record<string, unknown> = {}) {
  return {
    items: [item('a', { category: 'space' })],
    preferences: { interests },
    ...extra,
  };
}

describe('preference validation', () => {
  it('accepts explicit interests with default and custom weights', () => {
    const result = recommendRaw(
      makeRecommender(),
      requestWith([
        { kind: 'category', value: 'space' },
        { kind: 'category', value: 'science', weight: 2.5 },
      ]),
    );

    expect(result.strategy).toBe('content');
    expect(result.recommendations[0]?.explanation.components).toEqual([
      {
        factor: 'category',
        value: 0.2857142857142857,
        weight: 1,
        contribution: 0.2857142857142857,
      },
    ]);
  });

  it('accepts every supported preference kind', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [
        item('a', {
          category: 'space',
          tags: ['ai'],
          topics: ['exploration'],
          keywords: ['orbit'],
          contentType: 'article',
        }),
      ],
      preferences: {
        interests: [
          { kind: 'category', value: 'space' },
          { kind: 'tag', value: 'ai' },
          { kind: 'topic', value: 'exploration' },
          { kind: 'keyword', value: 'orbit' },
          { kind: 'contentType', value: 'article' },
        ],
      },
    });

    expect(result.recommendations[0]?.score).toBe(1);
    expect(result.recommendations[0]?.explanation.components.map((part) => part.factor)).toEqual([
      'category',
      'tag',
      'topic',
      'keyword',
      'contentType',
    ]);
  });

  it('trims, NFC-normalizes, and case-folds by default', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('a', { category: 'Café' })],
      preferences: {
        interests: [{ kind: 'category', value: '  CAFE\u0301  ' }],
      },
    });
    expect(result.recommendations[0]?.score).toBe(1);
  });

  it('preserves case when caseSensitive is true', () => {
    const result = recommendRaw(makeRecommender({ content: { caseSensitive: true } }), {
      items: [item('a', { category: 'Space' })],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
    });
    expect(result.recommendations[0]?.score).toBe(0);
  });

  it('merges duplicate preference terms deterministically', () => {
    const result = recommendRaw(
      makeRecommender(),
      requestWith([
        { kind: 'category', value: 'space', weight: 1 },
        { kind: 'category', value: ' SPACE ', weight: 2 },
      ]),
    );
    expect(result.recommendations[0]?.score).toBe(1);
    expect(result.recommendations[0]?.explanation.components[0]?.value).toBe(1);
  });

  it('treats empty interests as no usable personalization signal', () => {
    const result = recommendRaw(makeRecommender(), requestWith([]));
    expect(result.strategy).toBe('baseline');
    expect(result.recommendations[0]?.score).toBe(0.5);
  });

  it('rejects non-object preferences and missing interests', () => {
    for (const preferences of [null, 1, 'preferences', [], new Date()]) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), { items: [item('a')], preferences }),
        'INVALID_PREFERENCES',
      );
    }
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [item('a')], preferences: {} }),
      'INVALID_PREFERENCES',
    );
  });

  it('rejects unknown fields in preferences and interests', () => {
    expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('a')],
          preferences: { interests: [], extra: true },
        }),
      'INVALID_PREFERENCES',
    );
    expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('a')],
          preferences: { interests: [{ kind: 'category', value: 'space', extra: true }] },
        }),
      'INVALID_PREFERENCES',
    );
  });

  it('rejects non-object interest entries and missing fields', () => {
    for (const entry of [null, 1, 'space', [], new Date()]) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), requestWith([entry])),
        'INVALID_PREFERENCES',
      );
    }
    expectRecometError(
      () => recommendRaw(makeRecommender(), requestWith([{ value: 'space' }])),
      'INVALID_PREFERENCES',
    );
    expectRecometError(
      () => recommendRaw(makeRecommender(), requestWith([{ kind: 'category' }])),
      'INVALID_PREFERENCES',
    );
  });

  it('rejects unsupported preference kinds', () => {
    for (const kind of ['section', 'author', '', null, 1]) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), requestWith([{ kind, value: 'space' }])),
        'INVALID_PREFERENCES',
      );
    }
  });

  it('rejects invalid preference values', () => {
    for (const value of ['', '   ', 'a\u0000b', 'x'.repeat(257), 1, null, true, {}]) {
      expectRecometError(
        () => recommendRaw(makeRecommender(), requestWith([{ kind: 'category', value }])),
        'INVALID_PREFERENCES',
      );
    }
  });

  it('rejects invalid preference weights', () => {
    for (const weight of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '1',
      null,
      true,
      1_001,
    ]) {
      expectRecometError(
        () =>
          recommendRaw(
            makeRecommender(),
            requestWith([{ kind: 'category', value: 'space', weight }]),
          ),
        'INVALID_PREFERENCES',
      );
    }
  });

  it('rejects an explicit undefined weight', () => {
    expectRecometError(
      () =>
        recommendRaw(
          makeRecommender(),
          requestWith([{ kind: 'category', value: 'space', weight: undefined }]),
        ),
      'INVALID_PREFERENCES',
    );
  });

  it('rejects sparse interests arrays and extra array properties', () => {
    const sparse = new Array(3);
    sparse[0] = { kind: 'category', value: 'space' };
    sparse[2] = { kind: 'category', value: 'science' };
    expectRecometError(
      () =>
        recommendRaw(makeRecommender(), { items: [item('a')], preferences: { interests: sparse } }),
      'INVALID_PREFERENCES',
    );

    const withExtra = [{ kind: 'category', value: 'space' }] as unknown[] & { extra?: number };
    withExtra.extra = 1;
    expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('a')],
          preferences: { interests: withExtra },
        }),
      'INVALID_PREFERENCES',
    );
  });

  it('rejects symbol, non-enumerable, accessor, and prototype-pollution keys', () => {
    const symbolKeys = {
      interests: [{ kind: 'category', value: 'space' }],
      [Symbol('hidden')]: true,
    };
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [item('a')], preferences: symbolKeys }),
      'INVALID_PREFERENCES',
    );

    const hidden = { interests: [] };
    Object.defineProperty(hidden, 'hidden', { enumerable: false, value: 1 });
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [item('a')], preferences: hidden }),
      'INVALID_PREFERENCES',
    );

    let invoked = false;
    const accessor = { interests: [] };
    Object.defineProperty(accessor, 'extra', {
      enumerable: true,
      get() {
        invoked = true;
        return true;
      },
    });
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [item('a')], preferences: accessor }),
      'INVALID_PREFERENCES',
    );
    expect(invoked).toBe(false);

    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const polluted: Record<string, unknown> = {
        interests: [{ kind: 'category', value: 'space' }],
      };
      Object.defineProperty(polluted, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: true,
      });
      expectRecometError(
        () => recommendRaw(makeRecommender(), { items: [item('a')], preferences: polluted }),
        'INVALID_PREFERENCES',
      );
    }
  });

  it('rejects preferences above the configured maximum', () => {
    const recommender = makeRecommender({ limits: { maxPreferenceTerms: 1 } });
    expectRecometError(
      () =>
        recommendRaw(
          recommender,
          requestWith([
            { kind: 'category', value: 'space' },
            { kind: 'tag', value: 'ai' },
          ]),
        ),
      'LIMIT_EXCEEDED',
    );
  });

  it('rejects preference values above the configured maximum', () => {
    const recommender = makeRecommender({ limits: { maxPreferenceValueLength: 3 } });
    expect(() =>
      recommendRaw(recommender, requestWith([{ kind: 'category', value: 'abc' }])),
    ).not.toThrow();
    expectRecometError(
      () => recommendRaw(recommender, requestWith([{ kind: 'category', value: 'abcd' }])),
      'INVALID_PREFERENCES',
    );
  });

  it('rejects preferences with the baseline strategy instead of ignoring them', () => {
    expectRecometError(
      () =>
        recommendRaw(
          makeRecommender({ strategy: 'baseline' }),
          requestWith([{ kind: 'category', value: 'space' }]),
        ),
      'INVALID_REQUEST',
    );
  });

  it('does not echo preference values in errors', () => {
    const secret = 'PREFERENCE-SECRET-123';
    const error = expectRecometError(
      () =>
        recommendRaw(
          makeRecommender(),
          requestWith([{ kind: 'category', value: secret, weight: 0 }]),
        ),
      'INVALID_PREFERENCES',
    );
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error.details)).not.toContain(secret);
  });

  it('does not mutate or retain the caller preference object', () => {
    const interests = [{ kind: 'category' as const, value: ' Space ', weight: 2 }];
    const preferences = { interests };
    const request = { items: [item('a', { category: 'space' })], preferences };
    const before = JSON.stringify(request);
    const recommender = makeRecommender();

    const first = recommendRaw(recommender, request);
    expect(JSON.stringify(request)).toBe(before);
    expect(resultIds(first)).toEqual(['a']);

    interests[0] = { kind: 'category', value: 'cooking', weight: 99 };
    const second = recommendRaw(recommender, request);
    expect(second.recommendations[0]?.score).toBe(0);
  });
});
