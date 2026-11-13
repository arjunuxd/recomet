import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecommender, RecometError } from '../src/index.js';
import type { ContentItem } from '../src/index.js';
import { hybridScore } from '../src/ranking/score.js';
import * as similarityModule from '../src/collaborative/similarity.js';

vi.mock('../src/collaborative/similarity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/collaborative/similarity.js')>();
  return {
    ...actual,
    computeSimilarity: vi.fn(actual.computeSimilarity),
  };
});

afterEach(() => {
  vi.mocked(similarityModule.computeSimilarity).mockClear();
});

function makeItems(
  ids: string[],
  extra?: (id: string) => NonNullable<ContentItem['attributes']>,
): ContentItem[] {
  return ids.map((id) => ({ id, attributes: extra ? extra(id) : { tags: [id] } }));
}

describe('Phase 4 hybrid configuration', () => {
  it('accepts explicit hybrid strategy with defaults', () => {
    expect(() => createRecommender({ strategy: 'hybrid' })).not.toThrow();
  });

  it('validates hybrid weights (finite, non-negative, bounded)', () => {
    expect(() =>
      createRecommender({ strategy: 'hybrid', hybrid: { weights: { content: -1 } } }),
    ).toThrow(RecometError);
    expect(() =>
      createRecommender({ strategy: 'hybrid', hybrid: { weights: { collaborative: Number.NaN } } }),
    ).toThrow(RecometError);
    expect(() =>
      createRecommender({
        strategy: 'hybrid',
        hybrid: { weights: { content: Number.POSITIVE_INFINITY } },
      }),
    ).toThrow(RecometError);
    expect(() =>
      createRecommender({ strategy: 'hybrid', hybrid: { weights: { collaborative: 1001 } } }),
    ).toThrow(RecometError);
    expect(() =>
      createRecommender({
        strategy: 'hybrid',
        hybrid: { weights: { content: 1000, collaborative: 1000 } },
      }),
    ).not.toThrow();
  });

  it('rejects both-zero hybrid weights (G9)', () => {
    try {
      createRecommender({
        strategy: 'hybrid',
        hybrid: { weights: { content: 0, collaborative: 0 } },
      });
      expect.fail('expected INVALID_CONFIG');
    } catch (e) {
      expect(e).toBeInstanceOf(RecometError);
      expect((e as RecometError).code).toBe('INVALID_CONFIG');
    }
  });

  it('rejects unknown hybrid config keys', () => {
    expect(() => createRecommender({ strategy: 'hybrid', hybrid: { bad: true } as never })).toThrow(
      RecometError,
    );
    expect(() =>
      createRecommender({ strategy: 'hybrid', hybrid: { weights: { extra: 1 } as never } }),
    ).toThrow(RecometError);
  });
});

describe('Phase 4 hybrid availability-aware fusion (G1-G10)', () => {
  it('G1: both signals available fuse with defaults 1/1', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    // target u1 likes a (strong), u2 likes a and b => collaborative should support b
    const result = recommender.recommend({
      userId: 'u1',
      items: makeItems(['a', 'b'], (id) => ({ tags: [id === 'b' ? 'match' : 'other'] })),
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
      ],
      preferences: { interests: [{ kind: 'tag' as const, value: 'match', weight: 1 }] },
      limit: 2,
    });
    expect(result.strategy).toBe('hybrid');
    const b = result.recommendations.find((r) => r.itemId === 'b');
    expect(b).toBeDefined();
    // content for b is 1 (tag matches), collaborative for b should be positive; fused = average when both 1/1 weights
    expect(b!.score).toBeGreaterThan(0.5);
    expect(b!.score).toBeLessThanOrEqual(1);
    expect(b!.explanation.components.some((c) => c.factor === 'content')).toBe(true);
    expect(b!.explanation.components.some((c) => c.factor === 'collaborative')).toBe(true);
  });

  it('G2: content only (no collaborative evidence for item) uses content without treating CF as zero', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      userId: 'u1',
      items: makeItems(['x'], () => ({ tags: ['match'] })),
      interactions: [{ userId: 'u1', itemId: 'z', type: 'like', value: 1 }], // no overlap with x
      preferences: { interests: [{ kind: 'tag' as const, value: 'match', weight: 1 }] },
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    expect(result.recommendations[0]!.itemId).toBe('x');
    expect(result.recommendations[0]!.score).toBeCloseTo(1, 10);
    expect(result.recommendations[0]!.explanation.components).toHaveLength(1);
    expect(result.recommendations[0]!.explanation.components[0]!.factor).toBe('content');
  });

  it('G3: collaborative only (no usable preferences)', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      userId: 'u1',
      items: makeItems(['a', 'b']),
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
      ],
      limit: 2,
    });
    expect(result.strategy).toBe('hybrid');
    expect(result.recommendations[0]!.itemId).toBe('b');
    expect(
      result.recommendations[0]!.explanation.components.every((c) => c.factor === 'collaborative'),
    ).toBe(true);
  });

  it('G4: neither signal available falls back to baseline truthfully', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      items: makeItems(['a', 'b']),
      limit: 2,
    });
    expect(result.strategy).toBe('baseline');
    expect(result.recommendations[0]!.explanation.strategy).toBe('baseline');
    expect(result.recommendations[0]!.explanation.summary).toContain(
      'hybrid strategy was requested',
    );
  });

  it('G5: custom weights 0.6/0.4', () => {
    const recommender = createRecommender({
      strategy: 'hybrid',
      hybrid: { weights: { content: 0.6, collaborative: 0.4 } },
    });
    const result = recommender.recommend({
      userId: 'u1',
      items: [{ id: 'b', attributes: { tags: ['match'] } }],
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
      ],
      preferences: { interests: [{ kind: 'tag' as const, value: 'match', weight: 1 }] },
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    const b = result.recommendations[0]!;
    expect(b.itemId).toBe('b');
    // content = 1, collaborative positive (cosine on shared anchor gives 1.0 in this simple setup)
    expect(b.score).toBeGreaterThan(0.5);
    expect(b.score).toBeLessThanOrEqual(1);
  });

  it('G6: content disabled by zero weight', () => {
    const recommender = createRecommender({
      strategy: 'hybrid',
      hybrid: { weights: { content: 0, collaborative: 1 } },
    });
    const result = recommender.recommend({
      userId: 'u1',
      items: [{ id: 'b', attributes: { tags: ['match'] } }],
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
      ],
      preferences: { interests: [{ kind: 'tag' as const, value: 'match', weight: 1 }] },
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    expect(
      result.recommendations[0]!.explanation.components.every((c) => c.factor === 'collaborative'),
    ).toBe(true);
  });

  it('G7: collaborative disabled by zero weight', () => {
    const recommender = createRecommender({
      strategy: 'hybrid',
      hybrid: { weights: { content: 1, collaborative: 0 } },
    });
    const result = recommender.recommend({
      userId: 'u1',
      items: [{ id: 'b', attributes: { tags: ['match'] } }],
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
      ],
      preferences: { interests: [{ kind: 'tag' as const, value: 'match', weight: 1 }] },
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    expect(result.recommendations[0]!.score).toBeCloseTo(1, 10);
    expect(
      result.recommendations[0]!.explanation.components.every((c) => c.factor === 'content'),
    ).toBe(true);
  });

  it('G8: content score 0 is valid (not missing) when preferences usable', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      items: [{ id: 'x', attributes: { tags: ['other'] } }],
      preferences: { interests: [{ kind: 'tag' as const, value: 'match', weight: 1 }] },
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    expect(result.recommendations[0]!.score).toBe(0);
    expect(result.recommendations[0]!.explanation.components[0]!.factor).toBe('content');
    expect(result.recommendations[0]!.explanation.components[0]!.value).toBe(0);
  });

  it('G10: CF context usable but item has no CF evidence uses content for that item', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    // b has no collaborative path from u1's anchors (u1 likes z only, nobody overlaps on z with b)
    const result = recommender.recommend({
      userId: 'u1',
      items: [{ id: 'b', attributes: { tags: ['match'] } }],
      interactions: [{ userId: 'u1', itemId: 'z', type: 'like', value: 1 }],
      preferences: { interests: [{ kind: 'tag' as const, value: 'match', weight: 1 }] },
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    expect(result.recommendations[0]!.score).toBeCloseTo(1, 10);
    expect(
      result.recommendations[0]!.explanation.components.some((c) => c.factor === 'content'),
    ).toBe(true);
  });
});

describe('Phase 4 hybrid behavior, safety, and regressions', () => {
  it('includes all eligible request items (content-only items without CF evidence remain rankable)', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      userId: 'u1',
      items: makeItems(['a', 'b', 'c'], (id) => ({ tags: [id === 'c' ? 'match' : 'none'] })),
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
      ],
      preferences: { interests: [{ kind: 'tag' as const, value: 'match', weight: 1 }] },
      limit: 3,
    });
    const ids = result.recommendations.map((r) => r.itemId);
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).not.toContain('a'); // target-interacted
  });

  it('preserves exclusions and does not expose sensitive data in summaries/errors', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      userId: 'secret-user',
      items: makeItems(['a', 'b']),
      excludeItemIds: ['a'],
      interactions: [
        { userId: 'secret-user', itemId: 'x', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'x', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
      ],
      limit: 5,
    });
    expect(result.recommendations.map((r) => r.itemId)).toEqual(['b']);
    expect(JSON.stringify(result)).not.toContain('secret-user');
  });

  it('is deterministic for repeated identical requests', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    const req = {
      userId: 'u1',
      items: makeItems(['a', 'b', 'c']),
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
      ],
      preferences: { interests: [{ kind: 'tag' as const, value: 'b', weight: 1 }] },
      limit: 3,
    };
    expect(recommender.recommend(req)).toEqual(recommender.recommend(req));
  });

  it('does not mutate caller-owned inputs', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    const items: ContentItem[] = [{ id: 'b', attributes: { tags: ['match'] } }];
    const interactions = [
      { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
      { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
      { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
    ];
    const preferences = { interests: [{ kind: 'tag' as const, value: 'match', weight: 1 }] };
    const before = JSON.stringify({ items, interactions, preferences });
    recommender.recommend({ userId: 'u1', items, interactions, preferences, limit: 1 });
    expect(JSON.stringify({ items, interactions, preferences })).toBe(before);
  });

  it('auto strategy remains unchanged and does not auto-select hybrid', () => {
    const recommender = createRecommender({ strategy: 'auto' });
    const result = recommender.recommend({
      userId: 'u1',
      items: makeItems(['a', 'b'], (id) => ({ tags: [id] })),
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
      ],
      preferences: { interests: [{ kind: 'tag' as const, value: 'b', weight: 1 }] },
      limit: 2,
    });
    expect(result.strategy).not.toBe('hybrid');
    expect(['collaborative', 'content', 'baseline']).toContain(result.strategy);
  });

  it('respects shared collaborative similarity budget (no reset)', () => {
    vi.mocked(similarityModule.computeSimilarity).mockClear();
    const recommender = createRecommender({
      strategy: 'hybrid',
      limits: { maxCollaborativeSimilarityEvaluations: 2 },
    });
    recommender.recommend({
      userId: 'u1',
      items: makeItems(['b', 'c', 'd', 'e', 'f']),
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'c', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'd', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'e', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'f', type: 'like', value: 1 },
      ],
      limit: 5,
    });
    expect(vi.mocked(similarityModule.computeSimilarity).mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('scores remain finite and within [0,1]', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      userId: 'u1',
      items: makeItems(['a', 'b', 'c']),
      interactions: [
        { userId: 'u1', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'a', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'b', type: 'like', value: 1 },
      ],
      preferences: { interests: [{ kind: 'tag' as const, value: 'b', weight: 1 }] },
      limit: 3,
    });
    for (const rec of result.recommendations) {
      expect(Number.isFinite(rec.score)).toBe(true);
      expect(rec.score).toBeGreaterThanOrEqual(0);
      expect(rec.score).toBeLessThanOrEqual(1);
    }
  });

  it('golden: fuses actual content and collaborative components (defaults 1/1)', () => {
    // S_c: tag kind, terms p(weight 1), q(weight 1), item has p => 0.5
    // S_f: u1-u2 cosine on shared anchor z is 1/sqrt(2), candidate t from u2 => 1.0
    // S_h = (1*0.5 + 1*1.0)/(2) = 0.75
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      userId: 'u1',
      items: [{ id: 't', attributes: { tags: ['p'] } }],
      interactions: [
        { userId: 'u1', itemId: 'z', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'z', type: 'like', value: 1 },
        { userId: 'u2', itemId: 't', type: 'like', value: 1 },
      ],
      preferences: {
        interests: [
          { kind: 'tag' as const, value: 'p', weight: 1 },
          { kind: 'tag' as const, value: 'q', weight: 1 },
        ],
      },
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    expect(result.recommendations[0]!.score).toBeCloseTo(0.75, 10);
    const factors = result.recommendations[0]!.explanation.components.map((c) => c.factor).sort();
    expect(factors).toEqual(['collaborative', 'content']);
  });

  it('golden: applies custom weights 0.6 content / 0.4 collaborative', () => {
    // Same components as above: S_c=0.5, S_f=1.0 => 0.6*0.5 + 0.4*1.0 = 0.7
    const recommender = createRecommender({
      strategy: 'hybrid',
      hybrid: { weights: { content: 0.6, collaborative: 0.4 } },
    });
    const result = recommender.recommend({
      userId: 'u1',
      items: [{ id: 't', attributes: { tags: ['p'] } }],
      interactions: [
        { userId: 'u1', itemId: 'z', type: 'like', value: 1 },
        { userId: 'u2', itemId: 'z', type: 'like', value: 1 },
        { userId: 'u2', itemId: 't', type: 'like', value: 1 },
      ],
      preferences: {
        interests: [
          { kind: 'tag' as const, value: 'p', weight: 1 },
          { kind: 'tag' as const, value: 'q', weight: 1 },
        ],
      },
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    expect(result.recommendations[0]!.score).toBeCloseTo(0.7, 10);
  });

  it('golden: missing collaborative evidence is not fabricated as zero (content 0.8 only)', () => {
    // S_c = 4/5 = 0.8, no CF evidence => S_h = 0.8 (not 0.4)
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      userId: 'u1',
      items: [{ id: 't', attributes: { tags: ['a'] } }],
      interactions: [{ userId: 'u1', itemId: 'z', type: 'like', value: 1 }],
      preferences: {
        interests: [
          { kind: 'tag' as const, value: 'a', weight: 4 },
          { kind: 'tag' as const, value: 'b', weight: 1 },
        ],
      },
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    expect(result.recommendations[0]!.score).toBeCloseTo(0.8, 10);
    expect(result.recommendations[0]!.explanation.components).toHaveLength(1);
    expect(result.recommendations[0]!.explanation.components[0]!.factor).toBe('content');
  });

  it('excludes target-interacted items even when collaborative weight is zero', () => {
    const recommender = createRecommender({
      strategy: 'hybrid',
      hybrid: { weights: { content: 1, collaborative: 0 } },
    });
    const result = recommender.recommend({
      userId: 'u1',
      items: [
        { id: 'a', attributes: { tags: ['match'] } },
        { id: 'b', attributes: { tags: ['match'] } },
      ],
      interactions: [{ userId: 'u1', itemId: 'a', type: 'like', value: 1 }],
      preferences: { interests: [{ kind: 'tag' as const, value: 'match', weight: 1 }] },
      limit: 5,
    });
    expect(result.recommendations.map((r) => r.itemId)).toEqual(['b']);
  });

  it('allows preferences and collaborative inputs together for explicit hybrid', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    expect(() =>
      recommender.recommend({
        userId: 'u1',
        items: makeItems(['a']),
        interactions: [{ userId: 'u1', itemId: 'a', type: 'view' }],
        preferences: { interests: [{ kind: 'tag' as const, value: 'a', weight: 1 }] },
      }),
    ).not.toThrow();
  });

  it('does not leak userId or interaction data in result JSON', () => {
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      userId: 'USER_SECRET_123',
      items: makeItems(['a', 'b']),
      interactions: [
        { userId: 'USER_SECRET_123', itemId: 'x', type: 'private-event', value: 1 },
        { userId: 'OTHER_USER_456', itemId: 'x', type: 'private-event', value: 1 },
        { userId: 'OTHER_USER_456', itemId: 'b', type: 'private-event', value: 1 },
      ],
      limit: 2,
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('USER_SECRET_123');
    expect(json).not.toContain('OTHER_USER_456');
    expect(json).not.toContain('private-event');
  });
});

describe('Phase 4 acceptance remediation: exact G1-G10 golden vectors (PHASE4_SPECIFICATION.md §8)', () => {
  it('G1 exact: both signals available, defaults w_c=1 w_f=1, S_c=0.80 S_f=0.50 => S_h=0.65', () => {
    // Spec G1: (1*0.8 + 1*0.5)/(1+1)=1.3/2=0.65
    // Tolerance: 12 decimal places for deterministic IEEE 754 binary64 arithmetic.
    const result = hybridScore({
      contentScore: 0.8,
      collaborativeScore: 0.5,
      contentWeight: 1,
      collaborativeWeight: 1,
    });
    expect(result.hasContent).toBe(true);
    expect(result.hasCollaborative).toBe(true);
    expect(result.components).toHaveLength(2);
    expect(result.components.find((c) => c.factor === 'content')?.weight).toBe(1);
    expect(result.components.find((c) => c.factor === 'collaborative')?.weight).toBe(1);
    expect(result.score).toBeCloseTo(0.65, 12);
  });

  it('G2 exact: content only (CF missing for item), S_c=0.80, missing CF not treated as zero => S_h=0.80', () => {
    // Spec G2 formula path: (1*0.8)/(1)=0.8. Integration proves absence semantics.
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      userId: 'u1',
      items: [{ id: 't', attributes: { tags: ['a'] } }],
      interactions: [{ userId: 'u1', itemId: 'z', type: 'like', value: 1 }], // no CF path to t
      preferences: {
        interests: [
          { kind: 'tag' as const, value: 'a', weight: 4 },
          { kind: 'tag' as const, value: 'b', weight: 1 },
        ],
      }, // content = 4/5 = 0.8
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]!.itemId).toBe('t');
    expect(result.recommendations[0]!.score).toBeCloseTo(0.8, 12);
    expect(result.recommendations[0]!.explanation.components).toHaveLength(1);
    expect(result.recommendations[0]!.explanation.components[0]!.factor).toBe('content');
    expect(result.recommendations[0]!.explanation.components[0]!.value).toBeCloseTo(0.8, 12);
  });

  it('G3 exact: collaborative only (no usable content preferences), S_f=0.50 => S_h=0.50', () => {
    // Spec G3: (1*0.5)/(1)=0.5; A_c=0, A_f(i)=1.
    const result = hybridScore({
      contentScore: undefined,
      collaborativeScore: 0.5,
      contentWeight: 1,
      collaborativeWeight: 1,
    });
    expect(result.hasContent).toBe(false);
    expect(result.hasCollaborative).toBe(true);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.factor).toBe('collaborative');
    expect(result.components[0]!.value).toBe(0.5);
    expect(result.score).toBe(0.5);
  });

  it('G4 exact: neither signal available (request-level) => truthful baseline fallback', () => {
    // Spec G4: no usable content prefs and no usable CF context => baseline path.
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      items: [{ id: 'a' }, { id: 'b' }],
      limit: 2,
    });
    expect(result.strategy).toBe('baseline');
    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations[0]!.score).toBe(0.5);
    expect(result.recommendations[0]!.explanation.strategy).toBe('baseline');
    expect(result.recommendations[0]!.explanation.components).toEqual([
      { factor: 'baseline', value: 0.5, weight: 1, contribution: 0.5 },
    ]);
    expect(result.recommendations[0]!.explanation.summary).toContain(
      'hybrid strategy was requested',
    );
  });

  it('G5 exact: both active, custom weights w_c=0.6 w_f=0.4, S_c=0.80 S_f=0.50 => S_h=0.68', () => {
    // Spec G5: (0.6*0.8 + 0.4*0.5)/(1.0)=(0.48+0.20)/1.0=0.68
    // Tolerance: 12 decimal places for deterministic IEEE 754 binary64 arithmetic.
    const result = hybridScore({
      contentScore: 0.8,
      collaborativeScore: 0.5,
      contentWeight: 0.6,
      collaborativeWeight: 0.4,
    });
    expect(result.hasContent).toBe(true);
    expect(result.hasCollaborative).toBe(true);
    expect(result.score).toBeCloseTo(0.68, 12);
    const content = result.components.find((c) => c.factor === 'content');
    const collab = result.components.find((c) => c.factor === 'collaborative');
    expect(content?.weight).toBe(0.6);
    expect(collab?.weight).toBe(0.4);
  });

  it('G6 exact: content disabled by zero weight, S_c=0.80 S_f=0.50 w_c=0 w_f=1 => S_h=0.50', () => {
    // Spec G6: (0+0.5)/1=0.50; content component inactive when weight 0.
    const result = hybridScore({
      contentScore: 0.8,
      collaborativeScore: 0.5,
      contentWeight: 0,
      collaborativeWeight: 1,
    });
    expect(result.hasContent).toBe(false);
    expect(result.hasCollaborative).toBe(true);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.factor).toBe('collaborative');
    expect(result.score).toBe(0.5);
  });

  it('G7 exact: collaborative disabled by zero weight, S_c=0.80 S_f=0.50 w_c=1 w_f=0 => S_h=0.80', () => {
    // Spec G7: (0.8+0)/1=0.80; collaborative component inactive when weight 0.
    // Tolerance: 12 decimal places for deterministic IEEE 754 binary64 arithmetic.
    const result = hybridScore({
      contentScore: 0.8,
      collaborativeScore: 0.5,
      contentWeight: 1,
      collaborativeWeight: 0,
    });
    expect(result.hasContent).toBe(true);
    expect(result.hasCollaborative).toBe(false);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.factor).toBe('content');
    expect(result.score).toBeCloseTo(0.8, 12);
  });

  it('G8 exact: content score 0 is valid (not missing), A_c=1 A_f(i)=0 S_c=0.00 => S_h=0.00', () => {
    // Spec G8: (1*0)/(1)=0.00; valid Phase 2 evaluation, not missing CF.
    const result = hybridScore({
      contentScore: 0,
      collaborativeScore: undefined,
      contentWeight: 1,
      collaborativeWeight: 1,
    });
    expect(result.hasContent).toBe(true);
    expect(result.hasCollaborative).toBe(false);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.factor).toBe('content');
    expect(result.components[0]!.value).toBe(0);
    expect(result.score).toBe(0);
  });

  it('G9 exact: both-zero weights invalid config => INVALID_CONFIG (no division/fusion)', () => {
    // Spec G9: validation rejects; denominator cannot be zero.
    try {
      createRecommender({
        strategy: 'hybrid',
        hybrid: { weights: { content: 0, collaborative: 0 } },
      });
      expect.fail('expected INVALID_CONFIG');
    } catch (error) {
      expect(error).toBeInstanceOf(RecometError);
      expect((error as RecometError).code).toBe('INVALID_CONFIG');
      expect((error as RecometError).message).toContain('non-zero weight');
    }
  });

  it('G10 exact: CF context usable but item has no CF evidence, A_c=1 S_c=0.60 => S_h=0.60', () => {
    // Spec G10: (1*0.6)/(1)=0.60; A_f(i)=0 for item despite usable CF context.
    const recommender = createRecommender({ strategy: 'hybrid' });
    const result = recommender.recommend({
      userId: 'u1',
      items: [{ id: 't', attributes: { tags: ['a'] } }],
      interactions: [{ userId: 'u1', itemId: 'z', type: 'like', value: 1 }], // no evidence path to t
      preferences: {
        interests: [
          { kind: 'tag' as const, value: 'a', weight: 3 },
          { kind: 'tag' as const, value: 'b', weight: 2 },
        ],
      }, // content = 3/5 = 0.6
      limit: 1,
    });
    expect(result.strategy).toBe('hybrid');
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]!.itemId).toBe('t');
    expect(result.recommendations[0]!.score).toBeCloseTo(0.6, 12);
    expect(result.recommendations[0]!.explanation.components).toHaveLength(1);
    expect(result.recommendations[0]!.explanation.components[0]!.factor).toBe('content');
    expect(result.recommendations[0]!.explanation.components[0]!.value).toBeCloseTo(0.6, 12);
  });
});
