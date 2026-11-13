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

describe('preference inspection boundary', () => {
  it('rejects accessor preference properties without invoking them', () => {
    let invoked = false;
    const preferences = { interests: [] };
    Object.defineProperty(preferences, 'extra', {
      enumerable: true,
      get() {
        invoked = true;
        return true;
      },
    });

    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [item('a')], preferences }),
      'INVALID_PREFERENCES',
    );
    expect(invoked).toBe(false);
  });

  it('rejects accessor interest fields without invoking them', () => {
    let invoked = false;
    const interest = {};
    Object.defineProperty(interest, 'kind', {
      enumerable: true,
      get() {
        invoked = true;
        return 'category';
      },
    });
    Object.defineProperty(interest, 'value', {
      enumerable: true,
      value: 'space',
    });

    expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('a')],
          preferences: { interests: [interest] },
        }),
      'INVALID_PREFERENCES',
    );
    expect(invoked).toBe(false);
  });

  it('rejects non-plain preference objects and interest entries', () => {
    class Preferences {
      readonly interests = [];
    }
    class Interest {
      readonly kind = 'category';
      readonly value = 'space';
    }

    expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('a')],
          preferences: new Preferences(),
        }),
      'INVALID_PREFERENCES',
    );
    expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('a')],
          preferences: { interests: [new Interest()] },
        }),
      'INVALID_PREFERENCES',
    );
  });

  it('rejects cyclic and prototype-polluted preference entries', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.interests = [cyclic];
    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [item('a')], preferences: cyclic }),
      'INVALID_PREFERENCES',
    );

    const polluted: Record<string, unknown> = {};
    Object.defineProperty(polluted, '__proto__', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 'polluted',
    });
    polluted.kind = 'category';
    polluted.value = 'space';
    expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('a')],
          preferences: { interests: [polluted] },
        }),
      'INVALID_PREFERENCES',
    );
  });

  it('does not invoke proxy get traps for benign preference descriptors', () => {
    let invoked = false;
    const preferences = new Proxy(
      { interests: [{ kind: 'category', value: 'space' }] },
      {
        get() {
          invoked = true;
          throw new Error('unexpected get');
        },
      },
    );

    const result = recommendRaw(makeRecommender(), {
      items: [item('a', { category: 'space' })],
      preferences,
    });
    expect(result.recommendations[0]?.score).toBe(1);
    expect(invoked).toBe(false);
  });

  it('converts hostile preference proxy failures to a value-free INTERNAL_ERROR', () => {
    const preferences = new Proxy(
      { interests: [] },
      {
        ownKeys() {
          throw new Error('PREFERENCE-PROXY-SECRET');
        },
      },
    );

    const error = expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [item('a')], preferences }),
      'INTERNAL_ERROR',
    );
    expect(error.message).toBe('An internal error occurred.');
    expect(error.message).not.toContain('PREFERENCE-PROXY-SECRET');
  });
});

describe('content data handling', () => {
  it('does not mutate deeply frozen content and preference inputs', () => {
    const request = deepFreeze({
      items: [
        item('a', {
          category: 'space',
          tags: ['ai', 'robotics'],
          topics: ['exploration'],
          keywords: ['orbit'],
          contentType: 'article',
        }),
        item('b', { category: 'cooking', tags: ['recipes'] }),
      ],
      preferences: {
        interests: [
          { kind: 'category' as const, value: 'space', weight: 2 },
          { kind: 'tag' as const, value: 'ai' },
        ],
      },
      limit: 2,
    });

    const result = recommendRaw(makeRecommender(), request);
    expect(result.recommendations.map((entry) => entry.itemId)).toEqual(['a', 'b']);
  });

  it('returns results that do not change when caller inputs are mutated later', () => {
    const attributes: Record<string, unknown> = {
      category: 'space',
      tags: ['ai'],
    };
    const interests = [{ kind: 'category' as const, value: 'space' }];
    const request = { items: [{ id: 'a', attributes }], preferences: { interests } };
    const result = recommendRaw(makeRecommender(), request);
    const snapshot = JSON.stringify(result);

    attributes.category = 'cooking';
    (attributes.tags as string[]).push('recipes');
    interests[0] = { kind: 'category', value: 'cooking' };

    expect(JSON.stringify(result)).toBe(snapshot);
    expect(JSON.stringify(result)).not.toContain('space');
    expect(JSON.stringify(result)).not.toContain('cooking');
  });

  it('does not share content configuration between instances', () => {
    const categoryWeighted = makeRecommender({ content: { weights: { category: 3, tag: 1 } } });
    const defaultWeighted = makeRecommender();
    const request = {
      items: [item('a', { category: 'space' })],
      preferences: {
        interests: [
          { kind: 'category' as const, value: 'space' },
          { kind: 'tag' as const, value: 'ai' },
        ],
      },
    };

    expect(recommendRaw(categoryWeighted, request).recommendations[0]?.score).toBe(0.75);
    expect(recommendRaw(defaultWeighted, request).recommendations[0]?.score).toBe(0.5);
    expect(recommendRaw(defaultWeighted, request).recommendations[0]?.score).toBe(0.5);
  });

  it('redacts content signal values and keys from errors', () => {
    const secrets = ['SIGNAL-VALUE-SECRET', 'SIGNAL-KEY-SECRET'];
    const error = expectRecometError(
      () =>
        recommendRaw(makeRecommender(), {
          items: [item('a', { tags: [secrets[0], 1] })],
          preferences: { interests: [{ kind: 'tag', value: secrets[1] }] },
        }),
      'INVALID_ITEM',
    );

    const serialized = `${error.message} ${JSON.stringify(error.details)} ${error.stack ?? ''}`;
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
    expect(error.message).not.toMatch(/items\[/);
  });

  it('keeps content calls independent when interleaved', () => {
    const recommender = makeRecommender();
    const first = recommendRaw(recommender, {
      items: [item('a', { category: 'space' }), item('b', { category: 'cooking' })],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
    });
    recommendRaw(recommender, {
      items: [item('z', { category: 'cooking' })],
      preferences: { interests: [{ kind: 'category', value: 'cooking' }] },
    });
    const second = recommendRaw(recommender, {
      items: [item('b', { category: 'cooking' }), item('a', { category: 'space' })],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
    });

    expect(first.recommendations.map((entry) => entry.itemId)).toEqual(['a', 'b']);
    expect(second.recommendations.map((entry) => entry.itemId)).toEqual(['a', 'b']);
  });
});
