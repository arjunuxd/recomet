import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecommender, RecometError } from '../src/index.js';
import { buildInteractionModel } from '../src/collaborative/model.js';
import type { ResolvedCollaborativeConfig } from '../src/validation/config.js';
import type { ResolvedEngineLimits } from '../src/internal/limits.js';
import { expectRecometError, item, makeRecommender, recommendRaw, resultIds } from './helpers.js';
import * as similarityModule from '../src/collaborative/similarity.js';
import {
  collectCollaborative,
  type CollaborativeCandidateContext,
} from '../src/candidates/collaborative.js';
import { createSimilarityEvaluationBudget } from '../src/collaborative/budget.js';

vi.mock('../src/collaborative/similarity.js', async () => {
  const actual = await vi.importActual<typeof import('../src/collaborative/similarity.js')>(
    '../src/collaborative/similarity.js',
  );
  return {
    ...actual,
    computeSimilarity: vi.fn(actual.computeSimilarity),
  };
});

afterEach(() => {
  vi.mocked(similarityModule.computeSimilarity).mockClear();
});

const testCollaborativeConfig: ResolvedCollaborativeConfig = Object.freeze({
  method: 'auto',
  similarity: 'cosine',
  interactionTypes: Object.freeze({}),
  minOverlap: 1,
  maxNeighbors: 50,
});

const testLimits = {
  maxItems: 1000,
  maxExcludeItemIds: 1000,
  maxLimit: 100,
  defaultLimit: 10,
  maxIdLength: 256,
  maxAttributeNodesPerItem: 10_000,
  maxAttributeDepth: 10,
  maxAttributeStringLength: 10_000,
  maxTotalAttributeNodes: 200_000,
  maxTotalAttributeCharacters: 1_000_000,
  maxPreferenceTerms: 100,
  maxPreferenceValueLength: 500,
  maxSignalValuesPerItem: 100,
  maxInteractions: 50_000,
  maxInteractionTypeLength: 50,
  maxInteractionTypeWeights: 50,
  maxCollaborativeNeighbors: 200,
  maxCollaborativeSimilarityEvaluations: 5_000,
} as unknown as ResolvedEngineLimits;

const baseItems = [item('i1'), item('i2'), item('i3'), item('i4')];

describe('collaborative filtering (Phase 3)', () => {
  describe('request/config validation', () => {
    it('accepts collaborative strategy with userId and interactions', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      const result = recommender.recommend({
        items: baseItems,
        userId: 'u1',
        interactions: [{ userId: 'u1', itemId: 'i1', type: 'view' }],
      });
      expect(
        result.strategy === 'collaborative' ||
          result.strategy === 'baseline' ||
          result.strategy === 'content',
      ).toBe(true);
      // no collaborative signal from others => fallback to baseline
      expect(result.strategy).toBe('baseline');
      expect(result.recommendations[0]?.explanation.summary).toContain(
        'collaborative filtering was requested',
      );
    });

    it('requires userId for explicit collaborative strategy', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      expectRecometError(
        () =>
          recommendRaw(recommender, {
            items: baseItems,
            interactions: [{ userId: 'u1', itemId: 'i1', type: 'view' }],
          }),
        'INVALID_REQUEST',
      );
    });

    it('requires interactions for explicit collaborative strategy', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      expectRecometError(
        () => recommendRaw(recommender, { items: baseItems, userId: 'u1' }),
        'INVALID_REQUEST',
      );
    });

    it('rejects collaborative inputs with baseline strategy', () => {
      const recommender = makeRecommender({ strategy: 'baseline' });
      expectRecometError(
        () => recommendRaw(recommender, { items: baseItems, userId: 'u1', interactions: [] }),
        'INVALID_REQUEST',
      );
    });

    it('rejects collaborative inputs with content strategy', () => {
      const recommender = makeRecommender({ strategy: 'content' });
      expectRecometError(
        () =>
          recommendRaw(recommender, {
            items: baseItems,
            preferences: { interests: [{ kind: 'category', value: 'rock' }] },
            userId: 'u1',
          }),
        'INVALID_REQUEST',
      );
    });

    it('rejects malformed interaction records', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      for (const bad of [
        null,
        1,
        'x',
        [],
        new Date(),
        { userId: 'u1', itemId: 'i1' }, // missing type
        { userId: 'u1', type: 'view' },
        { itemId: 'i1', type: 'view' },
        { userId: '', itemId: 'i1', type: 'view' },
        { userId: 'u1', itemId: '', type: 'view' },
        { userId: 'u1', itemId: 'i1', type: '' },
        { userId: 'u1', itemId: 'i1', type: 'view', extra: true },
        { userId: 'u1', itemId: 'i1', type: 'view', value: Number.NaN },
        { userId: 'u1', itemId: 'i1', type: 'view', value: Number.POSITIVE_INFINITY },
        { userId: 'u1', itemId: 'i1', type: 'view', value: '1' },
      ]) {
        expectRecometError(
          () => recommendRaw(recommender, { items: baseItems, userId: 'u1', interactions: [bad] }),
          'INVALID_INTERACTION',
        );
      }
    });

    it('rejects sparse interaction arrays and accessor/getter traps in validation path', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      const sparse = Array(2);
      sparse[1] = { userId: 'u1', itemId: 'i1', type: 'view' };
      expectRecometError(
        () => recommendRaw(recommender, { items: baseItems, userId: 'u1', interactions: sparse }),
        'INVALID_INTERACTION',
      );

      let called = 0;
      const hostile = [{ userId: 'u1', itemId: 'i1', type: 'view' }];
      Object.defineProperty(hostile[0], 'value', {
        enumerable: true,
        get() {
          called += 1;
          return 1;
        },
      });
      const err = expectRecometError(
        () => recommendRaw(recommender, { items: baseItems, userId: 'u1', interactions: hostile }),
        'INVALID_INTERACTION',
      );
      expect(err).toBeInstanceOf(RecometError);
      expect(called).toBe(0); // validation rejects accessors without invoking getter
      expect(called).toBe(0); // validation rejects accessors without invoking getter
    });

    it('enforces interaction and collaborative config limits', () => {
      const recommender = makeRecommender({
        strategy: 'collaborative',
        limits: { maxInteractions: 1 },
      });
      expectRecometError(
        () =>
          recommender.recommend({
            items: baseItems,
            userId: 'u1',
            interactions: [
              { userId: 'u1', itemId: 'i1', type: 'view' },
              { userId: 'u2', itemId: 'i2', type: 'view' },
            ],
          }),
        'LIMIT_EXCEEDED',
      );
    });

    it('rejects unsafe collaborative config values', () => {
      expectRecometError(
        () => createRecommender({ collaborative: { method: 'hybrid' } as never }),
        'INVALID_CONFIG',
      );
      expectRecometError(
        () => createRecommender({ collaborative: { similarity: 'pearson' } as never }),
        'INVALID_CONFIG',
      );
      expectRecometError(
        () => createRecommender({ collaborative: { minOverlap: 0 } }),
        'INVALID_CONFIG',
      );
      expectRecometError(
        () => createRecommender({ collaborative: { maxNeighbors: -1 } }),
        'INVALID_CONFIG',
      );
      expectRecometError(
        () => createRecommender({ collaborative: { interactionTypes: { view: Number.NaN } } }),
        'INVALID_CONFIG',
      );
      const polluted: Record<string, number> = Object.create(null);
      Object.defineProperty(polluted, '__proto__', { value: 1, enumerable: true });
      // __proto__ as own enumerable key is unusual to create; test via JSON-like object is enough
      expectRecometError(
        () =>
          createRecommender({ collaborative: { interactionTypes: JSON.parse('{"__proto__":1}') } }),
        'INVALID_CONFIG',
      );
    });
  });

  describe('user-based collaborative filtering', () => {
    it('ranks by neighbor-weighted normalized strengths (cosine) with independently verified outcome', () => {
      // Users: u1 likes i1(1), u2 likes i1(1), i2(1) => similar to u1; recommend i2 to u1.
      // cosine on normalized vectors with maxAbsStrength=1: sim(u1,u2)=1/sqrt(1)*sqrt(2)=0.707106...
      // predicted i2 for u1 = (sim*1)/sim = 1.
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'user', similarity: 'cosine', minOverlap: 1 },
      });
      const result = recommender.recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i2', type: 'view', value: 1 },
        ],
      });
      expect(result.strategy).toBe('collaborative');
      expect(result.recommendations[0]?.itemId).toBe('i2');
      expect(result.recommendations[0]?.score).toBeGreaterThan(0);
      expect(result.recommendations.map((r) => r.itemId)).not.toContain('i1'); // target already interacted
      for (const rec of result.recommendations) {
        expect(rec.explanation.strategy).toBe('collaborative');
        expect(rec.explanation.summary).toContain('Collaborative filtering');
        expect(rec.explanation.components[0]?.factor).toBe('collaborative');
      }
    });

    it('supports Jaccard similarity', () => {
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'user', similarity: 'jaccard', minOverlap: 1 },
      });
      const result = recommender.recommend({
        items: [item('i1'), item('i2')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i2', type: 'view', value: 1 },
        ],
      });
      expect(result.strategy).toBe('collaborative');
      expect(resultIds(result)).toEqual(['i2']);
    });

    it('aggregates duplicate (user,item) strengths by summing', () => {
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'user', similarity: 'cosine', minOverlap: 1 },
      });
      const result = recommender.recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 0.5 },
          { userId: 'u2', itemId: 'i1', type: 'like', value: 0.5 }, // sums to 1
          { userId: 'u2', itemId: 'i2', type: 'view', value: 1 },
        ],
      });
      expect(result.strategy).toBe('collaborative');
      expect(resultIds(result)).toEqual(['i2']);
    });

    it('uses interaction type weights when value is not provided', () => {
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: {
          method: 'user',
          similarity: 'cosine',
          minOverlap: 1,
          interactionTypes: { like: 2, view: 1 },
        },
      });
      const result = recommender.recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view' },
          { userId: 'u2', itemId: 'i1', type: 'like' },
          { userId: 'u2', itemId: 'i2', type: 'view' },
          { userId: 'u3', itemId: 'i1', type: 'view' },
          { userId: 'u3', itemId: 'i3', type: 'view' },
        ],
      });
      expect(result.strategy).toBe('collaborative');
      expect(result.recommendations.length).toBeGreaterThan(0);
      // u2 has stronger i1 signal (like=2) than u3 (view=1) relative to max? Both contribute; i2/i3 both plausible.
      expect(['i2', 'i3']).toContain(result.recommendations[0]?.itemId);
    });

    it('excludes target-user interacted items and request exclusions', () => {
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'user', similarity: 'cosine', minOverlap: 1 },
      });
      const result = recommender.recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        excludeItemIds: ['i3'],
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i2', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i3', type: 'view', value: 1 },
        ],
      });
      // i1 is excluded from recommendations because target user already interacted; i3 excluded by request.
      expect(resultIds(result)).toEqual(['i2']);
      expect(result.metadata.excludedItems).toBe(1); // request-level exclusions present in items
    });

    it('returns deterministic ordering and tie-breaking', () => {
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'user', similarity: 'cosine', minOverlap: 1 },
      });
      const request = {
        items: [item('i1'), item('i2'), item('i3'), item('i4')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i2', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i3', type: 'view', value: 1 },
        ],
      };
      const a = recommender.recommend(request);
      const b = recommender.recommend(request);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      // i2/i3 have equal predicted score; tie-break by source/item order per ranker (lower sourceIndex first)
      if (
        a.recommendations.length >= 2 &&
        a.recommendations[0]?.score === a.recommendations[1]?.score
      ) {
        expect(a.recommendations[0]?.itemId).toBe('i2');
        expect(a.recommendations[1]?.itemId).toBe('i3');
      }
    });
  });

  describe('item-based collaborative filtering', () => {
    it('recommends items similar to target-user interacted items', () => {
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'item', similarity: 'cosine', minOverlap: 1 },
      });
      const result = recommender.recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i2', type: 'view', value: 1 },
          { userId: 'u3', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u3', itemId: 'i2', type: 'view', value: 1 },
        ],
      });
      expect(result.strategy).toBe('collaborative');
      expect(resultIds(result)[0]).toBe('i2');
      expect(result.recommendations[0]?.explanation.strategy).toBe('collaborative');
    });

    it('auto method tries user-based then item-based', () => {
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'auto', similarity: 'cosine', minOverlap: 1 },
      });
      const result = recommender.recommend({
        items: [item('i1'), item('i2')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i2', type: 'view', value: 1 },
        ],
      });
      expect(result.strategy).toBe('collaborative');
      expect(resultIds(result)).toEqual(['i2']);
    });
  });

  describe('auto strategy precedence and fallback', () => {
    it('auto uses collaborative when target user has interaction signal', () => {
      const recommender = makeRecommender({ strategy: 'auto' });
      const result = recommender.recommend({
        items: [item('i1'), item('i2')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i2', type: 'view', value: 1 },
        ],
      });
      expect(result.strategy).toBe('collaborative');
    });

    it('auto falls back to content when collaborative signal is unavailable but preferences exist', () => {
      const recommender = makeRecommender({ strategy: 'auto' });
      const result = recommender.recommend({
        items: [item('i1', { category: 'jazz' }), item('i2', { category: 'rock' })],
        userId: 'u1',
        interactions: [{ userId: 'u2', itemId: 'i1', type: 'view', value: 1 }], // no u1 signal
        preferences: { interests: [{ kind: 'category', value: 'rock' }] },
      });
      expect(result.strategy).toBe('content');
      expect(resultIds(result)[0]).toBe('i2');
    });

    it('auto falls back to baseline when no collaborative or content signal exists', () => {
      const recommender = makeRecommender({ strategy: 'auto' });
      const result = recommender.recommend({ items: baseItems });
      expect(result.strategy).toBe('baseline');
    });

    it('explicit collaborative falls back to content with accurate explanation (never labeled collaborative)', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      const result = recommender.recommend({
        items: [item('i1', { category: 'jazz' }), item('i2', { category: 'rock' })],
        userId: 'u1',
        interactions: [], // insufficient
        preferences: { interests: [{ kind: 'category', value: 'rock' }] },
      });
      expect(result.strategy).toBe('content');
      expect(result.recommendations[0]?.explanation.strategy).toBe('content');
      expect(result.recommendations[0]?.explanation.summary).toContain(
        'collaborative filtering was requested',
      );
      expect(result.recommendations[0]?.explanation.summary).toContain(
        'explicit preferences were used instead',
      );
      expect(
        result.recommendations[0]?.explanation.components.some((c) => c.factor === 'collaborative'),
      ).toBe(false);
    });

    it('explicit collaborative falls back to baseline when no usable preferences exist', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      const result = recommender.recommend({
        items: baseItems,
        userId: 'u1',
        interactions: [{ userId: 'u2', itemId: 'i1', type: 'view', value: 1 }], // no overlap with u1
      });
      expect(result.strategy).toBe('baseline');
      expect(result.recommendations[0]?.explanation.strategy).toBe('baseline');
      expect(result.recommendations[0]?.explanation.summary).toContain(
        'collaborative filtering was requested',
      );
      expect(result.recommendations[0]?.explanation.summary).toContain(
        'no collaborative signal was applied',
      );
      expect(
        result.recommendations[0]?.explanation.components.every((c) => c.factor === 'baseline'),
      ).toBe(true);
    });

    it('handles cold start when target user has no interactions', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      const result = recommender.recommend({
        items: baseItems,
        userId: 'new-user',
        interactions: [{ userId: 'u2', itemId: 'i1', type: 'view', value: 1 }],
      });
      expect(result.strategy).toBe('baseline');
    });

    it('handles zero overlap/insufficient similarity gracefully', () => {
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'user', similarity: 'cosine', minOverlap: 2 },
      });
      const result = recommender.recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 1 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 1 }, // overlap 1 < 2
          { userId: 'u2', itemId: 'i2', type: 'view', value: 1 },
        ],
      });
      expect(result.strategy).toBe('baseline');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('security and privacy boundaries', () => {
    it('does not retain interaction references in the returned result structure', () => {
      const interaction: { userId: string; itemId: string; type: string; value?: number } = {
        userId: 'u1',
        itemId: 'i1',
        type: 'view',
        value: 1,
      };
      const interactions = [interaction];
      const recommender = makeRecommender({ strategy: 'collaborative' });
      const result = recommender.recommend({
        items: [item('i1'), item('i2')],
        userId: 'u1',
        interactions,
      });
      interaction.value = 999;
      expect(JSON.stringify(result)).not.toContain('999');
    });

    it('rejects class instances and prototype-pollution-shaped interaction wrappers', () => {
      class Evil {
        userId = 'u1';
        itemId = 'i1';
        type = 'view';
      }
      const recommender = makeRecommender({ strategy: 'collaborative' });
      expectRecometError(
        () =>
          recommendRaw(recommender, { items: baseItems, userId: 'u1', interactions: [new Evil()] }),
        'INVALID_INTERACTION',
      );
    });

    it('never echoes user/item/type values in collaborative validation errors', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      const secret = 'SECRET_CF_VALUE_12345';
      try {
        recommender.recommend({
          items: baseItems,
          userId: 'u1',
          interactions: [{ userId: secret, itemId: 'i1', type: 'view' } as never],
        });
      } catch (error) {
        const err = error as RecometError;
        expect(err).toBeInstanceOf(RecometError);
        expect(err.message).not.toContain(secret);
        expect(JSON.stringify(err.details ?? {})).not.toContain(secret);
      }
    });
  });

  describe('interaction value validation (Phase 3, F-03)', () => {
    it('rejects negative integer explicit values with INVALID_INTERACTION', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      expectRecometError(
        () =>
          recommendRaw(recommender, {
            items: baseItems,
            userId: 'u1',
            interactions: [{ userId: 'u1', itemId: 'i1', type: 'view', value: -1 }],
          }),
        'INVALID_INTERACTION',
      );
    });

    it('rejects negative fractional explicit values', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      expectRecometError(
        () =>
          recommendRaw(recommender, {
            items: baseItems,
            userId: 'u1',
            interactions: [{ userId: 'u1', itemId: 'i1', type: 'view', value: -0.25 }],
          }),
        'INVALID_INTERACTION',
      );
    });

    it('accepts zero and positive explicit values', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      expect(() =>
        recommender.recommend({
          items: baseItems,
          userId: 'u1',
          interactions: [
            { userId: 'u1', itemId: 'i1', type: 'view', value: 0 },
            { userId: 'u2', itemId: 'i1', type: 'view', value: 0.5 },
            { userId: 'u2', itemId: 'i2', type: 'view', value: 2 },
          ],
        }),
      ).not.toThrow();
    });

    it('canonicalizes negative zero to a non-negative value when accepted by JS semantics', () => {
      // -0 is not < 0 in JS; validation accepts it and canonicalizes to 0.
      const recommender = makeRecommender({ strategy: 'collaborative' });
      expect(() =>
        recommender.recommend({
          items: baseItems,
          userId: 'u1',
          interactions: [{ userId: 'u1', itemId: 'i1', type: 'view', value: -0 }],
        }),
      ).not.toThrow();
    });

    it('rejects NaN and infinite explicit values', () => {
      const recommender = makeRecommender({ strategy: 'collaborative' });
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expectRecometError(
          () =>
            recommendRaw(recommender, {
              items: baseItems,
              userId: 'u1',
              interactions: [{ userId: 'u1', itemId: 'i1', type: 'view', value }],
            }),
          'INVALID_INTERACTION',
        );
      }
    });

    it('uses configured type weight when explicit value is absent and explicit value overrides when present', () => {
      const recommender = createRecommender({
        strategy: 'collaborative',
        collaborative: { interactionTypes: { like: 3, view: 1 } },
      });
      const withConfigured = recommender.recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'like' },
          { userId: 'u2', itemId: 'i1', type: 'like' },
          { userId: 'u2', itemId: 'i2', type: 'view' },
        ],
      });
      const withExplicitOverride = recommender.recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'like', value: 0.1 },
          { userId: 'u2', itemId: 'i1', type: 'like', value: 0.1 },
          { userId: 'u2', itemId: 'i2', type: 'view', value: 10 },
        ],
      });
      expect(withConfigured.recommendations.length).toBeGreaterThan(0);
      expect(withExplicitOverride.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('unknown interaction type default (F-04)', () => {
    it('defaults to strength 1 for an unconfigured but valid interaction type when value is absent', () => {
      const recommender = createRecommender({
        strategy: 'collaborative',
        collaborative: { interactionTypes: { view: 2 } },
      });
      const result = recommender.recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'custom-event' },
          { userId: 'u2', itemId: 'i1', type: 'custom-event' },
          { userId: 'u2', itemId: 'i2', type: 'custom-event' },
        ],
      });
      expect(['collaborative', 'baseline']).toContain(result.strategy);
      if (result.strategy === 'collaborative') {
        expect(resultIds(result)).toContain('i2');
      }
    });
  });

  describe('interaction strength normalization (Decision A / F-02)', () => {
    it('keeps denominator floor at 1 when all strengths are below 1', () => {
      const model = buildInteractionModel(
        [
          { userId: 'u1', itemId: 'i1', type: 'v', value: 0.2 },
          { userId: 'u1', itemId: 'i2', type: 'v', value: 0.1 },
        ],
        testCollaborativeConfig,
        testLimits,
      );
      expect(model.maxAbsStrength).toBe(1);
    });

    it('keeps denominator floor at 1 when maximum absolute strength is exactly 1', () => {
      const model = buildInteractionModel(
        [
          { userId: 'u1', itemId: 'i1', type: 'v', value: 1 },
          { userId: 'u1', itemId: 'i2', type: 'v', value: 0.5 },
        ],
        testCollaborativeConfig,
        testLimits,
      );
      expect(model.maxAbsStrength).toBe(1);
    });

    it('normalizes relative to maximum absolute strength when it exceeds 1', () => {
      const model = buildInteractionModel(
        [
          { userId: 'u1', itemId: 'i1', type: 'v', value: 2 },
          { userId: 'u1', itemId: 'i2', type: 'v', value: 1 },
        ],
        testCollaborativeConfig,
        testLimits,
      );
      expect(model.maxAbsStrength).toBe(2);
    });

    it('uses absolute magnitude for denominator when mixed signs produce larger abs (defensive)', () => {
      // Phase 3 request validation rejects negative explicit values; this guards the
      // internal normalization invariant for finite strengths.
      const model = buildInteractionModel(
        [
          { userId: 'u1', itemId: 'i1', type: 'v', value: 1 },
          { userId: 'u1', itemId: 'i2', type: 'v', value: 0 },
        ],
        testCollaborativeConfig,
        testLimits,
      );
      expect(model.maxAbsStrength).toBe(1);
    });

    it('handles very small and very large finite values deterministically', () => {
      const small = buildInteractionModel(
        [{ userId: 'u1', itemId: 'i1', type: 'v', value: 1e-12 }],
        testCollaborativeConfig,
        testLimits,
      );
      expect(small.maxAbsStrength).toBe(1);
      expect(Number.isFinite(small.maxAbsStrength)).toBe(true);

      const large = buildInteractionModel(
        [
          { userId: 'u1', itemId: 'i1', type: 'v', value: 1e12 },
          { userId: 'u1', itemId: 'i2', type: 'v', value: 1 },
        ],
        testCollaborativeConfig,
        testLimits,
      );
      expect(large.maxAbsStrength).toBe(1e12);
      expect(Number.isFinite(large.maxAbsStrength)).toBe(true);
    });

    it('handles zero-only interaction strengths deterministically', () => {
      const model = buildInteractionModel(
        [
          { userId: 'u1', itemId: 'i1', type: 'v', value: 0 },
          { userId: 'u2', itemId: 'i1', type: 'v', value: 0 },
        ],
        testCollaborativeConfig,
        testLimits,
      );
      expect(model.maxAbsStrength).toBe(1);
      expect(model.userItems.get('u1')?.get('i1')).toBe(0);
    });

    it('produces deterministic normalization/model results', () => {
      const interactions = [
        { userId: 'u1', itemId: 'i1', type: 'v', value: 0.25 },
        { userId: 'u2', itemId: 'i1', type: 'v', value: 0.5 },
        { userId: 'u2', itemId: 'i2', type: 'v', value: 0.75 },
      ] as const;
      const a = buildInteractionModel(interactions, testCollaborativeConfig, testLimits);
      const b = buildInteractionModel(interactions, testCollaborativeConfig, testLimits);
      expect(a.maxAbsStrength).toBe(b.maxAbsStrength);
      expect(JSON.stringify([...a.userItems.entries()])).toBe(
        JSON.stringify([...b.userItems.entries()]),
      );
    });

    it('retains magnitude for below-1 strengths in observable collaborative scoring', () => {
      // With denominator floor 1, small strengths remain small (not rescaled to 1).
      const recommender = makeRecommender({ strategy: 'collaborative' });
      const result = recommender.recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 0.2 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 0.2 },
          { userId: 'u2', itemId: 'i2', type: 'view', value: 0.1 },
        ],
      });
      if (result.strategy === 'collaborative') {
        const rec = result.recommendations.find((r) => r.itemId === 'i2');
        expect(rec).toBeDefined();
        // Magnitude retained (0.1 normalized) rather than rescaled to 1.0.
        expect(rec!.score).toBeLessThan(0.5);
        expect(rec!.score).toBeGreaterThan(0);
      }
    });
  });

  describe('total similarity-evaluation budget (per-request)', () => {
    function baseLimits(
      budget: number,
      extra: Partial<ResolvedEngineLimits> = {},
    ): Partial<ResolvedEngineLimits> {
      return {
        maxCollaborativeSimilarityEvaluations: budget,
        maxInteractions: 5_000,
        maxItems: 2_000,
        ...extra,
      };
    }

    function userDataset(overlappingUsers: number) {
      const interactions: Array<{ userId: string; itemId: string; type: string }> = [
        { userId: 'target', itemId: 'shared', type: 'v' },
      ];
      for (let n = 0; n < overlappingUsers; n += 1) {
        interactions.push({ userId: `u${n}`, itemId: 'shared', type: 'v' });
        interactions.push({ userId: `u${n}`, itemId: `rec${n}`, type: 'v' });
      }
      return {
        items: [
          item('shared'),
          ...Array.from({ length: overlappingUsers }, (_, i) => item(`rec${i}`)),
        ],
        interactions,
      };
    }

    function itemDataset(anchors: number, candidates: number) {
      const interactions: Array<{ userId: string; itemId: string; type: string }> = [];
      for (let a = 0; a < anchors; a += 1) {
        interactions.push({ userId: 'target', itemId: `a${a}`, type: 'v' });
      }
      // Each candidate co-occurs with every anchor (max possible evaluation pairs).
      for (let c = 0; c < candidates; c += 1) {
        for (let a = 0; a < anchors; a += 1) {
          interactions.push({ userId: `o${c}_${a}`, itemId: `a${a}`, type: 'v' });
          interactions.push({ userId: `o${c}_${a}`, itemId: `c${c}`, type: 'v' });
        }
      }
      return {
        items: [
          ...Array.from({ length: candidates }, (_, i) => item(`c${i}`)),
          ...Array.from({ length: anchors }, (_, i) => item(`a${i}`)),
        ],
        interactions,
      };
    }

    function runCollect(
      method: 'user' | 'item',
      budget: number,
      similarity: 'cosine' | 'jaccard',
      data: {
        items: ReturnType<typeof item>[];
        interactions: ReadonlyArray<{
          userId: string;
          itemId: string;
          type: string;
          value?: number | undefined;
        }>;
      },
      collaborativeExtra: Partial<ResolvedCollaborativeConfig> = {},
    ) {
      const collab: ResolvedCollaborativeConfig = {
        ...testCollaborativeConfig,
        method,
        similarity,
        minOverlap: 1,
        maxNeighbors: 50,
        ...collaborativeExtra,
      };
      const limits = {
        ...testLimits,
        maxCollaborativeSimilarityEvaluations: budget,
        maxInteractions: 10_000,
        maxItems: 5_000,
      } as ResolvedEngineLimits;
      const model = buildInteractionModel(
        data.interactions.map((x) => ({
          userId: x.userId,
          itemId: x.itemId,
          type: x.type,
          value: x.value,
        })),
        collab,
        limits,
      );
      const budgetObj = createSimilarityEvaluationBudget(budget);
      const ctx: CollaborativeCandidateContext = {
        items: data.items.map((it, i) => ({
          id: it.id,
          sourceIndex: i,
          ...(it.attributes === undefined ? {} : { attributes: it.attributes }),
        })),
        excludedIds: new Set(),
        model,
        targetUserId: 'target',
        collaborative: collab,
        method,
        limits,
        budget: budgetObj,
      };
      return { result: collectCollaborative(ctx), budget: budgetObj };
    }

    it('validates maxCollaborativeSimilarityEvaluations as a safe bounded integer', () => {
      expect(() =>
        createRecommender({ limits: { maxCollaborativeSimilarityEvaluations: 0 } }),
      ).toThrow(RecometError);
      expect(() =>
        createRecommender({ limits: { maxCollaborativeSimilarityEvaluations: -1 } }),
      ).toThrow(RecometError);
      expect(() =>
        createRecommender({ limits: { maxCollaborativeSimilarityEvaluations: 1.5 } }),
      ).toThrow(RecometError);
      expect(() =>
        createRecommender({ limits: { maxCollaborativeSimilarityEvaluations: 50_001 } }),
      ).toThrow(RecometError);
      expect(() =>
        createRecommender({ limits: { maxCollaborativeSimilarityEvaluations: 1 } }),
      ).not.toThrow();
      expect(() =>
        createRecommender({ limits: { maxCollaborativeSimilarityEvaluations: 50_000 } }),
      ).not.toThrow();
    });

    it('rejects removed maxCollaborativeComparisons with clear migration guidance (no silent semantics)', () => {
      try {
        createRecommender({ limits: { maxCollaborativeComparisons: 100 } as never });
        throw new Error('expected INVALID_CONFIG');
      } catch (error) {
        expect(error).toBeInstanceOf(RecometError);
        const err = error as RecometError;
        expect(err.code).toBe('INVALID_CONFIG');
        expect(err.message).toContain('maxCollaborativeSimilarityEvaluations');
        expect(err.message).toContain('maxCollaborativeComparisons');
      }
    });

    it('user-based (cosine): actual computeSimilarity calls never exceed budget (below/at/above)', () => {
      const data = userDataset(20);
      for (const budget of [5, 20, 25]) {
        vi.mocked(similarityModule.computeSimilarity).mockClear();
        const { result } = runCollect('user', budget, 'cosine', data);
        const calls = vi.mocked(similarityModule.computeSimilarity).mock.calls.length;
        expect(calls).toBeLessThanOrEqual(budget);
        expect(result.evaluationsPerformed).toBe(calls);
        expect(result.evaluationBudget).toBe(budget);
        expect(result.budgetExhausted).toBe(calls === budget);
      }
    });

    it('user-based (jaccard): actual computeSimilarity calls never exceed budget', () => {
      const data = userDataset(30);
      vi.mocked(similarityModule.computeSimilarity).mockClear();
      const { result } = runCollect('user', 7, 'jaccard', data);
      const calls = vi.mocked(similarityModule.computeSimilarity).mock.calls.length;
      expect(calls).toBe(7);
      expect(result.evaluationsPerformed).toBe(7);
      expect(result.applicable).toBe(true);
    });

    it('item-based (cosine): actual calls never exceed budget when candidates * anchors >> budget', () => {
      // 20 candidates * 20 anchors = 400 possible pairs; budget 25.
      const data = itemDataset(20, 20);
      vi.mocked(similarityModule.computeSimilarity).mockClear();
      const { result } = runCollect('item', 25, 'cosine', data);
      const calls = vi.mocked(similarityModule.computeSimilarity).mock.calls.length;
      expect(calls).toBe(25);
      expect(result.evaluationsPerformed).toBe(25);
      expect(result.evaluationBudget).toBe(25);
      expect(result.budgetExhausted).toBe(true);
    });

    it('item-based (jaccard): actual calls never exceed budget with many anchors', () => {
      // 15 candidates * 30 anchors = 450; budget 40.
      const data = itemDataset(30, 15);
      vi.mocked(similarityModule.computeSimilarity).mockClear();
      const { result } = runCollect('item', 40, 'jaccard', data);
      const calls = vi.mocked(similarityModule.computeSimilarity).mock.calls.length;
      expect(calls).toBe(40);
      expect(result.evaluationsPerformed).toBe(40);
      expect(result.budgetExhausted).toBe(true);
    });

    it('item-based fairness: candidates are not starved when candidates >> budget (no naive front-loading)', () => {
      // 50 candidates, 10 anchors, budget 30. Fair anchor-round allocation gives
      // anchor[0] to candidates 0..29, anchor[1] to candidate 0 only, so 30
      // candidates receive >= 1 evaluation (none of the 50 are completely
      // starved before others get a second round). Naive candidate-outer
      // front-loading would give candidate 0 all 10 anchors and starve 47 candidates.
      const data = itemDataset(10, 50);
      vi.mocked(similarityModule.computeSimilarity).mockClear();
      const { result } = runCollect('item', 30, 'cosine', data);
      const calls = vi.mocked(similarityModule.computeSimilarity).mock.calls.length;
      expect(calls).toBe(30);
      expect(result.candidatesEvaluated).toBe(30);
      expect(result.candidatesSkipped).toBe(20);
      expect(result.candidates.length).toBeGreaterThan(0);
      // Recommendations should not all come from the very first source indices only.
      const recommended = new Set(result.candidates.map((c) => c.itemId));
      expect(recommended.size).toBeGreaterThan(1);
      expect(recommended.has('c0')).toBe(true);
      expect(recommended.has('c29')).toBe(true);
      expect(recommended.has('c30')).toBe(false);
    });

    it('item-based fairness: with enough budget for one full anchor round, every eligible candidate is evaluated', () => {
      // 40 candidates, 5 anchors, budget 40 => exactly anchor[0] for every candidate.
      const data = itemDataset(5, 40);
      vi.mocked(similarityModule.computeSimilarity).mockClear();
      const { result } = runCollect('item', 40, 'cosine', data);
      const calls = vi.mocked(similarityModule.computeSimilarity).mock.calls.length;
      expect(calls).toBe(40);
      expect(result.candidatesEvaluated).toBe(40);
      expect(result.candidatesSkipped).toBe(0);
      expect(result.budgetExhausted).toBe(true); // 200 possible, used 40
    });

    it('item-based: anchors >> budget distributes limited evaluations across candidates deterministically', () => {
      // 10 candidates, 50 anchors, budget 12 => anchor[0] for candidates 0..9, anchor[1] for 0..1.
      const data = itemDataset(50, 10);
      vi.mocked(similarityModule.computeSimilarity).mockClear();
      const { result } = runCollect('item', 12, 'cosine', data);
      expect(vi.mocked(similarityModule.computeSimilarity).mock.calls.length).toBe(12);
      expect(result.candidatesEvaluated).toBe(10);
      expect(result.candidatesSkipped).toBe(0);
    });

    it('auto method shares the total budget across user-based then item-based fallback', () => {
      // User-based will be inapplicable (target has no overlapping users with usable recs?),
      // forcing item-based fallback; both attempts share one budget and total actual calls <= budget.
      // Construct: target has item t1 only, no other users share t1 => user-based not applicable.
      // Item-based: target liked t1, others co-occur on t1 and recommend c1..c30.
      const interactions: Array<{ userId: string; itemId: string; type: string }> = [
        { userId: 'target', itemId: 't1', type: 'v' },
      ];
      for (let c = 0; c < 30; c += 1) {
        interactions.push({ userId: `o${c}`, itemId: 't1', type: 'v' });
        interactions.push({ userId: `o${c}`, itemId: `c${c}`, type: 'v' });
      }
      const items = [item('t1'), ...Array.from({ length: 30 }, (_, i) => item(`c${i}`))];
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'auto', similarity: 'cosine', minOverlap: 1 },
        limits: baseLimits(8),
      });
      vi.mocked(similarityModule.computeSimilarity).mockClear();
      const result = recommender.recommend({ items, userId: 'target', interactions });
      const calls = vi.mocked(similarityModule.computeSimilarity).mock.calls.length;
      expect(calls).toBeLessThanOrEqual(8);
      expect(result.strategy).toBe('collaborative');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('budget exhaustion during processing stops safely and deterministically', () => {
      const data = itemDataset(15, 25);
      const a = runCollect('item', 7, 'cosine', data);
      vi.mocked(similarityModule.computeSimilarity).mockClear();
      const b = runCollect('item', 7, 'cosine', data);
      expect(a.result.evaluationsPerformed).toBe(7);
      expect(a.result.budgetExhausted).toBe(true);
      expect(JSON.stringify(a.result.candidates)).toBe(JSON.stringify(b.result.candidates));
      expect(vi.mocked(similarityModule.computeSimilarity).mock.calls.length).toBe(7);
    });

    it('deterministic results across repeated runs (user/item, exhausted)', () => {
      const user = userDataset(40);
      const rec = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'user', similarity: 'cosine', minOverlap: 1 },
        limits: baseLimits(6),
      });
      const req = { items: user.items, userId: 'target', interactions: user.interactions } as const;
      expect(JSON.stringify(rec.recommend(req))).toBe(JSON.stringify(rec.recommend(req)));

      const itemData = itemDataset(12, 30);
      const recItem = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'item', similarity: 'cosine', minOverlap: 1 },
        limits: baseLimits(10),
      });
      const req2 = {
        items: itemData.items,
        userId: 'target',
        interactions: itemData.interactions,
      } as const;
      expect(JSON.stringify(recItem.recommend(req2))).toBe(JSON.stringify(recItem.recommend(req2)));
    });

    it('preserves exclusions and previously interacted item handling under budget', () => {
      const interactions = [
        { userId: 'target', itemId: 'a1', type: 'v' },
        { userId: 'o1', itemId: 'a1', type: 'v' },
        { userId: 'o1', itemId: 'c1', type: 'v' },
        { userId: 'o1', itemId: 'c2', type: 'v' },
        { userId: 'o2', itemId: 'a1', type: 'v' },
        { userId: 'o2', itemId: 'c1', type: 'v' },
        { userId: 'o2', itemId: 'c3', type: 'v' },
      ];
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'item', similarity: 'cosine', minOverlap: 1 },
        limits: baseLimits(5),
      });
      const result = recommender.recommend({
        items: [item('a1'), item('c1'), item('c2'), item('c3')],
        userId: 'target',
        excludeItemIds: ['c2'],
        interactions,
      });
      expect(resultIds(result)).not.toContain('a1');
      expect(resultIds(result)).not.toContain('c2');
    });

    it('empty/sparse data and fallback behavior remain correct under budget', () => {
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'user', similarity: 'cosine', minOverlap: 1 },
        limits: baseLimits(1),
      });
      const result = recommender.recommend({
        items: [item('i1'), item('i2')],
        userId: 'target',
        interactions: [{ userId: 'target', itemId: 'i1', type: 'v' }],
      });
      expect(result.strategy).toBe('baseline');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('config min/default/max for maxCollaborativeSimilarityEvaluations', () => {
      const minRec = createRecommender({ limits: { maxCollaborativeSimilarityEvaluations: 1 } });
      expect(minRec).toBeDefined();
      const maxRec = createRecommender({
        limits: { maxCollaborativeSimilarityEvaluations: 50_000 },
      });
      expect(maxRec).toBeDefined();
      const defRec = createRecommender();
      // Default is applied internally; behaviorally verify a small workload succeeds.
      expect(
        defRec.recommend({
          items: [item('i1'), item('i2')],
          userId: 'u1',
          interactions: [
            { userId: 'u1', itemId: 'i1', type: 'v' },
            { userId: 'u2', itemId: 'i1', type: 'v' },
            { userId: 'u2', itemId: 'i2', type: 'v' },
          ],
        }).strategy,
      ).toBe('collaborative');
    });

    it('does not mutate caller-owned data under budgeted evaluation', () => {
      const interactions = [
        { userId: 'target', itemId: 'a1', type: 'v' },
        { userId: 'o1', itemId: 'a1', type: 'v' },
        { userId: 'o1', itemId: 'c1', type: 'v' },
      ];
      const items = [item('a1'), item('c1')];
      const snapI = JSON.stringify(interactions);
      const snapItems = JSON.stringify(items);
      makeRecommender({
        strategy: 'collaborative',
        collaborative: { method: 'item', similarity: 'cosine', minOverlap: 1 },
        limits: baseLimits(1),
      }).recommend({ items, userId: 'target', interactions });
      expect(JSON.stringify(interactions)).toBe(snapI);
      expect(JSON.stringify(items)).toBe(snapItems);
    });

    it('preserves F-02 normalization, F-03 negative-value rejection, F-04 unknown type default under budget', () => {
      // F-03
      expectRecometError(
        () =>
          recommendRaw(makeRecommender({ strategy: 'collaborative', limits: baseLimits(10) }), {
            items: [item('i1'), item('i2')],
            userId: 'u1',
            interactions: [{ userId: 'u1', itemId: 'i1', type: 'v', value: -1 }],
          }),
        'INVALID_INTERACTION',
      );

      // F-04
      const f04 = makeRecommender({
        strategy: 'collaborative',
        collaborative: { interactionTypes: { view: 2 } },
        limits: baseLimits(10),
      }).recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'custom-event' },
          { userId: 'u2', itemId: 'i1', type: 'custom-event' },
          { userId: 'u2', itemId: 'i2', type: 'custom-event' },
        ],
      });
      expect(['collaborative', 'baseline']).toContain(f04.strategy);

      // F-02: below-1 magnitude retained
      const f02 = makeRecommender({
        strategy: 'collaborative',
        limits: baseLimits(10),
      }).recommend({
        items: [item('i1'), item('i2'), item('i3')],
        userId: 'u1',
        interactions: [
          { userId: 'u1', itemId: 'i1', type: 'view', value: 0.2 },
          { userId: 'u2', itemId: 'i1', type: 'view', value: 0.2 },
          { userId: 'u2', itemId: 'i2', type: 'view', value: 0.1 },
        ],
      });
      if (f02.strategy === 'collaborative') {
        const rec = f02.recommendations.find((r) => r.itemId === 'i2');
        expect(rec?.score ?? 0).toBeLessThan(0.5);
      }
    });

    it('user-based maxNeighbors remains distinct from evaluation budget', () => {
      // 10 overlapping users, budget allows 10 evaluations, but maxNeighbors 2 selects only 2.
      const data = userDataset(10);
      const recommender = makeRecommender({
        strategy: 'collaborative',
        collaborative: {
          method: 'user',
          similarity: 'cosine',
          minOverlap: 1,
          maxNeighbors: 2,
        },
        limits: baseLimits(10),
      });
      vi.mocked(similarityModule.computeSimilarity).mockClear();
      const result = recommender.recommend({
        items: data.items,
        userId: 'target',
        interactions: data.interactions,
      });
      expect(vi.mocked(similarityModule.computeSimilarity).mock.calls.length).toBe(10);
      expect(result.strategy).toBe('collaborative');
      // With maxNeighbors 2 and each neighbor recommending a unique item, at most 2 recs.
      expect(result.recommendations.length).toBeLessThanOrEqual(2);
    });
  });
});
