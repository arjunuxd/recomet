import { describe, expect, it } from 'vitest';
import type { Candidate } from '../src/candidates/candidate.js';
import { baselineSource } from '../src/candidates/baseline.js';
import { compareCandidates, deterministicRanker } from '../src/ranking/ranker.js';
import { baselineScore, combineScore } from '../src/ranking/score.js';
import { BoundedTopK } from '../src/ranking/top-k.js';

function candidate(itemId: string, sourceIndex: number, score = 0.5): Candidate {
  return {
    itemId,
    sourceIndex,
    score,
    components: [],
  };
}

const ascending = (a: number, b: number): number => a - b;

describe('BoundedTopK', () => {
  it('returns nothing for a non-positive limit', () => {
    const top = new BoundedTopK<number>(0, ascending);
    top.offer(1);
    top.offer(2);
    expect(top.toSortedArray()).toEqual([]);
  });

  it('returns fewer values than the limit when underfilled', () => {
    const top = new BoundedTopK<number>(5, ascending);
    top.offer(3);
    top.offer(1);
    expect(top.toSortedArray()).toEqual([1, 3]);
  });

  it('keeps the smallest values for an ascending comparator', () => {
    const top = new BoundedTopK<number>(3, ascending);
    for (const value of [9, 1, 8, 2, 7, 3, 6, 4, 5]) {
      top.offer(value);
    }
    expect(top.toSortedArray()).toEqual([1, 2, 3]);
  });

  it('matches a full sort for a deterministic pseudo-random input', () => {
    let state = 123_456_789;
    const values: number[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      values.push(state % 10_000);
    }

    for (const limit of [1, 2, 7, 50, 1_000, 2_000]) {
      const top = new BoundedTopK<number>(limit, ascending);
      for (const value of values) {
        top.offer(value);
      }
      expect(top.toSortedArray()).toEqual([...values].sort(ascending).slice(0, limit));
    }
  });

  it('does not mutate source values', () => {
    const first = candidate('a', 0);
    const second = candidate('b', 1);
    const top = new BoundedTopK<Candidate>(1, compareCandidates);
    top.offer(first);
    top.offer(second);
    expect(first).toEqual(candidate('a', 0));
    expect(second).toEqual(candidate('b', 1));
  });
});

describe('deterministic ranker', () => {
  it('orders by score descending', () => {
    const selected = deterministicRanker.select(
      [candidate('low', 0, 0.1), candidate('high', 1, 0.9), candidate('mid', 2, 0.5)],
      3,
    );
    expect(selected.map((entry) => entry.itemId)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks score ties by original input order', () => {
    const selected = deterministicRanker.select(
      [candidate('third', 2), candidate('first', 0), candidate('second', 1)],
      3,
    );
    expect(selected.map((entry) => entry.itemId)).toEqual(['first', 'second', 'third']);
  });

  it('uses exact item id as a defensive final tie-breaker', () => {
    const selected = deterministicRanker.select([candidate('b', 0), candidate('a', 0)], 2);
    expect(selected.map((entry) => entry.itemId)).toEqual(['a', 'b']);
  });

  it('applies the limit after ordering', () => {
    const selected = deterministicRanker.select(
      [candidate('a', 0, 0.2), candidate('b', 1, 0.8), candidate('c', 2, 0.5)],
      2,
    );
    expect(selected.map((entry) => entry.itemId)).toEqual(['b', 'c']);
  });

  it('accepts an iterable candidate stream', () => {
    function* stream(): Iterable<Candidate> {
      yield candidate('a', 0, 0.1);
      yield candidate('b', 1, 0.9);
    }
    expect(deterministicRanker.select(stream(), 1).map((entry) => entry.itemId)).toEqual(['b']);
  });
});

describe('score combination', () => {
  it('produces the neutral baseline score and component', () => {
    const scored = baselineScore();
    expect(scored.score).toBe(0.5);
    expect(scored.components).toEqual([
      { factor: 'baseline', value: 0.5, weight: 1, contribution: 0.5 },
    ]);
  });

  it('normalizes raw weights', () => {
    const scored = combineScore([
      { factor: 'baseline', value: 0.2, weight: 1 },
      { factor: 'baseline', value: 0.8, weight: 3 },
    ]);
    expect(scored.components.map((component) => component.weight)).toEqual([1, 3]);
    expect(scored.score).toBeCloseTo(0.65, 12);
  });

  it('treats zero total weight as zero contribution', () => {
    const scored = combineScore([
      { factor: 'baseline', value: 0.5, weight: 0 },
      { factor: 'baseline', value: 0.5, weight: 0 },
    ]);
    expect(scored.score).toBe(0);
    expect(scored.components.map((component) => component.contribution)).toEqual([0, 0]);
  });

  it('freezes scores and components', () => {
    const scored = baselineScore();
    expect(Object.isFrozen(scored)).toBe(true);
    expect(Object.isFrozen(scored.components)).toBe(true);
    expect(Object.isFrozen(scored.components[0])).toBe(true);
  });
});

describe('baseline candidate source', () => {
  it('skips excluded IDs and preserves source order', () => {
    const collected = [
      ...baselineSource.collect({
        items: [
          { id: 'a', sourceIndex: 0 },
          { id: 'b', sourceIndex: 1 },
          { id: 'c', sourceIndex: 2 },
        ],
        excludedIds: new Set(['b']),
      }),
    ];

    expect(collected.map((entry) => entry.itemId)).toEqual(['a', 'c']);
    expect(collected.map((entry) => entry.sourceIndex)).toEqual([0, 2]);
    expect(collected.every((entry) => entry.score === 0.5)).toBe(true);
  });
});
