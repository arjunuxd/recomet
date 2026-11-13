/**
 * Browser-side correctness suite.
 *
 * Pure ES module with no browser globals so the same code can be linted and
 * imported by the harness page. It receives the built public API.
 */

export function runBrowserSuite(api, userAgent) {
  const results = [];

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  function check(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (error) {
      const detail =
        error && typeof error === 'object' && 'name' in error && 'message' in error
          ? `${error.name}: ${error.message}`
          : String(error);
      results.push({ name, ok: false, error: detail });
    }
  }

  function expectCode(fn, expected) {
    try {
      fn();
    } catch (error) {
      assert(error instanceof api.RecometError, 'expected a RecometError');
      assert(error.code === expected, `expected ${expected}, received ${error.code}`);
      return;
    }
    throw new Error(`expected ${expected} to be thrown`);
  }

  function makeItems(count) {
    const items = [];
    for (let index = 0; index < count; index += 1) {
      items.push({ id: `item-${index}` });
    }
    return items;
  }

  check('creates a recommender', () => {
    const recommender = api.createRecommender();
    assert(typeof recommender.recommend === 'function', 'recommend is not callable');
  });

  check('returns synchronously with neutral scores and input order', () => {
    const recommender = api.createRecommender();
    const result = recommender.recommend({ items: makeItems(5) });
    assert(!(result instanceof Promise), 'result is a Promise');
    assert(result.recommendations.length === 5, 'unexpected length');
    result.recommendations.forEach((entry, index) => {
      assert(entry.itemId === `item-${index}`, 'order changed');
      assert(entry.rank === index + 1, 'rank is not contiguous');
      assert(entry.score === 0.5, 'score is not the neutral baseline');
    });
  });

  check('applies limit, exclusions, and metadata', () => {
    const recommender = api.createRecommender();
    const result = recommender.recommend({
      items: makeItems(6),
      limit: 2,
      excludeItemIds: ['item-1'],
    });
    assert(result.recommendations.length === 2, 'limit not applied');
    assert(result.recommendations[0].itemId === 'item-0', 'first item changed');
    assert(result.recommendations[1].itemId === 'item-2', 'exclusion changed order');
    assert(result.metadata.excludedItems === 1, 'excluded metadata wrong');
    assert(result.metadata.limit === 2, 'limit metadata wrong');
  });

  check('throws a typed error for an invalid request', () => {
    const recommender = api.createRecommender();
    expectCode(() => recommender.recommend({}), 'INVALID_REQUEST');
  });

  check('throws DUPLICATE_ITEM_ID for duplicate identifiers', () => {
    const recommender = api.createRecommender();
    expectCode(
      () => recommender.recommend({ items: [{ id: 'a' }, { id: 'a' }] }),
      'DUPLICATE_ITEM_ID',
    );
  });

  check('throws INVALID_LIMIT for an out-of-range limit', () => {
    const recommender = api.createRecommender();
    expectCode(() => recommender.recommend({ items: makeItems(1), limit: 0 }), 'INVALID_LIMIT');
  });

  check('rejects non-JSON attribute values', () => {
    const recommender = api.createRecommender();
    expectCode(
      () =>
        recommender.recommend({
          items: [{ id: 'a', attributes: { binary: new Uint8Array([1, 2, 3]) } }],
        }),
      'INVALID_ITEM',
    );
  });

  check('enforces the attribute depth budget', () => {
    const recommender = api.createRecommender();
    expectCode(
      () =>
        recommender.recommend({
          items: [{ id: 'a', attributes: { a: { b: { c: { d: { e: 1 } } } } } }],
        }),
      'LIMIT_EXCEEDED',
    );
  });

  check('does not mutate frozen input', () => {
    const attributes = Object.freeze({ title: 'frozen' });
    const request = Object.freeze({
      items: Object.freeze([Object.freeze({ id: 'a', attributes })]),
      limit: 1,
    });
    const recommender = api.createRecommender();
    const result = recommender.recommend(request);
    assert(result.recommendations[0].itemId === 'a', 'frozen input failed');
  });

  check('does not echo attributes into the result', () => {
    const recommender = api.createRecommender();
    const result = recommender.recommend({
      items: [{ id: 'a', attributes: { secret: 'hidden-browser-value' } }],
    });
    assert(!JSON.stringify(result).includes('hidden-browser-value'), 'attribute leaked');
  });

  check('handles a 10k collection deterministically', () => {
    const recommender = api.createRecommender();
    const request = { items: makeItems(10_000), limit: 100 };
    const first = recommender.recommend(request);
    const second = recommender.recommend(request);
    assert(first.recommendations.length === 100, 'unexpected length');
    assert(first.recommendations[0].itemId === 'item-0', 'first item changed');
    assert(first.recommendations[99].itemId === 'item-99', 'hundredth item changed');
    assert(JSON.stringify(first) === JSON.stringify(second), 'not deterministic');
  });

  check('ranks content matches using explicit preferences', () => {
    const recommender = api.createRecommender();
    const result = recommender.recommend({
      items: [
        { id: 'mismatch', attributes: { category: 'cooking', tags: ['recipes'] } },
        { id: 'match', attributes: { category: 'space', tags: ['ai', 'robotics'] } },
        { id: 'cold-start' },
      ],
      preferences: {
        interests: [
          { kind: 'category', value: 'space', weight: 3 },
          { kind: 'tag', value: 'ai', weight: 2 },
          { kind: 'tag', value: 'robotics' },
        ],
      },
      limit: 3,
    });
    assert(result.strategy === 'content', 'content strategy not selected');
    assert(result.recommendations[0].itemId === 'match', 'best match not first');
    assert(result.recommendations[0].score === 1, 'best match is not a full match');
    assert(result.recommendations[1].score === 0, 'mismatch is not zero relevance');
    assert(result.recommendations[2].score === 0, 'cold-start item is not zero relevance');
    const factors = result.recommendations[0].explanation.components.map((part) => part.factor);
    assert(factors.join(',') === 'category,tag', 'unexpected explanation factors');
  });

  check('falls back to the baseline when preferences are empty', () => {
    const recommender = api.createRecommender();
    const result = recommender.recommend({
      items: [{ id: 'a', attributes: { category: 'space' } }],
      preferences: { interests: [] },
    });
    assert(result.strategy === 'baseline', 'fallback strategy is not baseline');
    assert(result.recommendations[0].score === 0.5, 'fallback score is not neutral');
  });

  check('supports developer content mappings and case sensitivity', () => {
    const recommender = api.createRecommender({
      strategy: 'content',
      content: {
        attributes: { category: 'section' },
        caseSensitive: true,
      },
    });
    const result = recommender.recommend({
      items: [{ id: 'a', attributes: { section: 'Space' } }],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
    });
    assert(result.strategy === 'content', 'content strategy not selected');
    assert(result.recommendations[0].score === 0, 'case-sensitive mismatch scored');
  });

  check('throws INVALID_PREFERENCES for malformed preferences', () => {
    const recommender = api.createRecommender();
    expectCode(
      () =>
        recommender.recommend({
          items: [{ id: 'a' }],
          preferences: { interests: [{ kind: 'unknown', value: 'space' }] },
        }),
      'INVALID_PREFERENCES',
    );
  });

  check('does not leak preference or content labels in results', () => {
    const recommender = api.createRecommender();
    const result = recommender.recommend({
      items: [{ id: 'a', attributes: { category: 'BROWSER-CONTENT-SECRET' } }],
      preferences: {
        interests: [{ kind: 'category', value: 'BROWSER-PREFERENCE-SECRET' }],
      },
    });
    const serialized = JSON.stringify(result);
    assert(!serialized.includes('BROWSER-CONTENT-SECRET'), 'content label leaked');
    assert(!serialized.includes('BROWSER-PREFERENCE-SECRET'), 'preference label leaked');
  });

  check('applies limit and exclusions after content ranking', () => {
    const recommender = api.createRecommender();
    const result = recommender.recommend({
      items: [
        { id: 'first', attributes: { category: 'space' } },
        { id: 'excluded', attributes: { category: 'space' } },
        { id: 'second', attributes: { category: 'space' } },
        { id: 'third', attributes: { category: 'space' } },
      ],
      preferences: { interests: [{ kind: 'category', value: 'space' }] },
      excludeItemIds: ['excluded'],
      limit: 2,
    });
    assert(result.recommendations.length === 2, 'limit not applied');
    assert(result.recommendations[0].itemId === 'first', 'input-order tie break changed');
    assert(result.recommendations[1].itemId === 'second', 'excluded item returned');
    assert(result.metadata.excludedItems === 1, 'exclusion metadata wrong');
  });

  check('does not mutate frozen content and preference input', () => {
    const attributes = Object.freeze({
      category: 'space',
      tags: Object.freeze(['ai']),
    });
    const interest = Object.freeze({ kind: 'category', value: 'space' });
    const preferences = Object.freeze({ interests: Object.freeze([interest]) });
    const request = Object.freeze({
      items: Object.freeze([Object.freeze({ id: 'a', attributes })]),
      preferences,
      limit: 1,
    });
    const recommender = api.createRecommender();
    const result = recommender.recommend(request);
    assert(result.recommendations[0].itemId === 'a', 'frozen content input failed');
    assert(result.recommendations[0].score === 1, 'frozen content input scored incorrectly');
  });

  return {
    ok: results.every((entry) => entry.ok),
    userAgent,
    passed: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
    results,
  };
}
