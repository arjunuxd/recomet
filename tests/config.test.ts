import { describe, expect, it } from 'vitest';
import { createRecommender, type EngineLimits, type RecommenderConfig } from '../src/index.js';
import { expectRecometError, item, makeRecommender, recommendRaw } from './helpers.js';

function createRaw(config: unknown) {
  return createRecommender(config as RecommenderConfig);
}

describe('configuration validation', () => {
  it('accepts an empty object', () => {
    expect(() => createRaw({})).not.toThrow();
  });

  it('rejects null and primitives', () => {
    for (const value of [null, 1, 'config', true, Symbol('config'), 1n]) {
      expectRecometError(() => createRaw(value), 'INVALID_CONFIG');
    }
  });

  it('rejects arrays', () => {
    expectRecometError(() => createRaw([]), 'INVALID_CONFIG');
  });

  it('rejects class instances', () => {
    class Config {
      readonly strategy = 'baseline';
    }
    expectRecometError(() => createRaw(new Config()), 'INVALID_CONFIG');
  });

  it('rejects unknown top-level keys', () => {
    expectRecometError(() => createRaw({ unknown: true }), 'INVALID_CONFIG');
  });

  it('rejects unsupported strategies', () => {
    for (const strategy of ['', null, 1, 'unknown']) {
      expectRecometError(() => createRaw({ strategy }), 'UNSUPPORTED_STRATEGY');
    }
  });

  it('accepts baseline, content, collaborative, and auto strategies', () => {
    expect(() => createRaw({ strategy: 'content' })).not.toThrow();
    expect(() => createRaw({ strategy: 'auto' })).not.toThrow();
    expect(() => createRaw({ strategy: 'baseline' })).not.toThrow();
    expect(() => createRaw({ strategy: 'collaborative' })).not.toThrow();
  });

  it('rejects unknown content configuration keys', () => {
    expectRecometError(() => createRaw({ content: { unknown: true } }), 'INVALID_CONFIG');
    expectRecometError(
      () => createRaw({ content: { attributes: { unknown: 'field' } } }),
      'INVALID_CONFIG',
    );
    expectRecometError(() => createRaw({ content: { weights: { unknown: 1 } } }), 'INVALID_CONFIG');
  });

  it('rejects invalid content mappings and weights', () => {
    expectRecometError(
      () => createRaw({ content: { attributes: { category: '' } } }),
      'INVALID_CONFIG',
    );
    expectRecometError(
      () => createRaw({ content: { attributes: { tag: '__proto__' } } }),
      'INVALID_CONFIG',
    );
    for (const weight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1', 1_001]) {
      expectRecometError(
        () => createRaw({ content: { weights: { category: weight } } }),
        'INVALID_CONFIG',
      );
    }
    expectRecometError(() => createRaw({ content: { caseSensitive: 'yes' } }), 'INVALID_CONFIG');
  });

  it('accepts a fully specified content configuration', () => {
    expect(() =>
      createRaw({
        strategy: 'content',
        content: {
          attributes: {
            category: 'section',
            tag: 'labels',
            topic: 'subjects',
            keyword: 'searchTerms',
            contentType: 'kind',
          },
          weights: { category: 3, tag: 2, topic: 2, keyword: 1, contentType: 1 },
          caseSensitive: true,
        },
      }),
    ).not.toThrow();
  });

  it('rejects accessor properties without invoking them', () => {
    let invoked = false;
    const config = {};
    Object.defineProperty(config, 'strategy', {
      enumerable: true,
      configurable: true,
      get() {
        invoked = true;
        return 'baseline';
      },
    });

    expectRecometError(() => createRaw(config), 'INVALID_CONFIG');
    expect(invoked).toBe(false);
  });

  it('rejects symbol and non-enumerable own keys', () => {
    const withSymbol = { [Symbol('hidden')]: true };
    expectRecometError(() => createRaw(withSymbol), 'INVALID_CONFIG');

    const withHidden = {};
    Object.defineProperty(withHidden, 'strategy', {
      enumerable: false,
      value: 'baseline',
    });
    expectRecometError(() => createRaw(withHidden), 'INVALID_CONFIG');
  });

  it('rejects a limits value that is not a plain object', () => {
    for (const limits of [null, 1, [], 'limits', new Date()]) {
      expectRecometError(() => createRaw({ limits }), 'INVALID_CONFIG');
    }
  });

  it('rejects unknown limit keys', () => {
    expectRecometError(() => createRaw({ limits: { unknown: 1 } }), 'INVALID_CONFIG');
  });

  it('rejects non-integer, non-finite, and out-of-range limit values', () => {
    const invalid: unknown[] = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10', null];
    for (const value of invalid) {
      expectRecometError(() => createRaw({ limits: { maxItems: value } }), 'INVALID_CONFIG');
    }
    expectRecometError(() => createRaw({ limits: { maxItems: 100_001 } }), 'INVALID_CONFIG');
  });

  it('accepts boundary limit values', () => {
    expect(() => createRaw({ limits: { maxItems: 1 } })).not.toThrow();
    expect(() => createRaw({ limits: { maxItems: 100_000 } })).not.toThrow();
    expect(() => createRaw({ limits: { maxExcludeItemIds: 0 } })).not.toThrow();
    expect(() => createRaw({ limits: { maxAttributeDepth: 1 } })).not.toThrow();
    expect(() => createRaw({ limits: { maxAttributeDepth: 8 } })).not.toThrow();
  });

  it('rejects a default limit above the maximum limit', () => {
    expectRecometError(
      () => createRaw({ limits: { maxLimit: 5, defaultLimit: 10 } }),
      'INVALID_CONFIG',
    );
  });

  it('derives a safe default limit when only maxLimit is lowered', () => {
    const recommender = makeRecommender({ limits: { maxLimit: 5 } });
    const result = recommendRaw(recommender, {
      items: Array.from({ length: 20 }, (_, index) => item(`i-${index}`)),
    });
    expect(result.metadata.limit).toBe(5);
  });

  it('captures configuration per instance without cross-instance leakage', () => {
    const small = makeRecommender({ limits: { maxLimit: 1, defaultLimit: 1 } });
    const large = makeRecommender();
    const items = Array.from({ length: 10 }, (_, index) => item(`i-${index}`));

    expect(recommendRaw(small, { items }).recommendations).toHaveLength(1);
    expect(recommendRaw(large, { items }).recommendations).toHaveLength(10);
  });

  it('does not retain or mutate the caller configuration', () => {
    const limits = { maxLimit: 3, defaultLimit: 2 };
    const config: RecommenderConfig = { strategy: 'baseline', limits };
    const recommender = createRecommender(config);

    limits.maxLimit = 1;
    limits.defaultLimit = 1;

    const result = recommendRaw(recommender, { items: [item('a'), item('b'), item('c')] });
    expect(result.metadata.limit).toBe(2);
    expect(result.recommendations).toHaveLength(2);
  });

  it('reports only safe, value-free details on config errors', () => {
    const error = expectRecometError(
      () => createRaw({ limits: { maxLimit: 123_456 } }),
      'INVALID_CONFIG',
    );
    expect(error.message).not.toContain('123456');
    expect(JSON.stringify(error.details)).not.toContain('123456');
  });
});

describe('resolved limit defaults', () => {
  it('uses documented defaults', () => {
    const recommender = makeRecommender();
    const result = recommendRaw(recommender, { items: [item('a')] });
    expect(result.metadata.limit).toBe(10);
  });

  it('accepts a fully specified limits object', () => {
    const limits: EngineLimits = {
      maxItems: 100,
      maxExcludeItemIds: 100,
      maxLimit: 20,
      defaultLimit: 20,
      maxIdLength: 64,
      maxAttributeNodesPerItem: 64,
      maxAttributeDepth: 4,
      maxAttributeStringLength: 256,
      maxTotalAttributeNodes: 1_000,
      maxTotalAttributeCharacters: 10_000,
    };
    expect(() => createRecommender({ limits })).not.toThrow();
  });
});
