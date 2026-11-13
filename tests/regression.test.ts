import { describe, expect, it } from 'vitest';
import { createRecommender, type ContentItem } from '../src/index.js';
import { item, items, makeRecommender, recommendRaw, resultIds } from './helpers.js';

function nextRandom(state: { value: number }): number {
  state.value = (state.value * 1_103_515_245 + 12_345) % 2_147_483_648;
  return state.value / 2_147_483_648;
}

interface Scenario {
  readonly items: ContentItem[];
  readonly excludeItemIds: string[];
  readonly limit: number;
}

function referenceSelect(scenario: Scenario): string[] {
  const excluded = new Set(scenario.excludeItemIds);
  return scenario.items
    .filter((entry) => !excluded.has(entry.id))
    .slice(0, scenario.limit)
    .map((entry) => entry.id);
}

function randomScenario(seed: number): Scenario {
  const state = { value: seed };
  const count = 1 + Math.floor(nextRandom(state) * 40);
  const requestItems: ContentItem[] = [];
  for (let index = 0; index < count; index += 1) {
    requestItems.push({ id: `id-${seed}-${index}` });
  }

  const exclusionCount = Math.floor(nextRandom(state) * 10);
  const excludeItemIds: string[] = [];
  for (let index = 0; index < exclusionCount; index += 1) {
    if (nextRandom(state) < 0.6) {
      const target = Math.floor(nextRandom(state) * count);
      excludeItemIds.push(`id-${seed}-${target}`);
    } else {
      excludeItemIds.push(`missing-${index}`);
    }
  }

  const limit = 1 + Math.floor(nextRandom(state) * 50);
  return { items: requestItems, excludeItemIds, limit };
}

describe('regression against a naive reference implementation', () => {
  it('matches exclusion, limit, order, and metadata for random scenarios', () => {
    const recommender = makeRecommender({ limits: { maxLimit: 100, defaultLimit: 10 } });

    for (let seed = 1; seed <= 200; seed += 1) {
      const scenario = randomScenario(seed);
      const result = recommendRaw(recommender, scenario);
      const expected = referenceSelect(scenario);

      expect(resultIds(result)).toEqual(expected);
      expect(result.metadata.returnedItems).toBe(expected.length);
      expect(result.metadata.limit).toBe(scenario.limit);

      const excluded = new Set(scenario.excludeItemIds);
      const excludedCount = scenario.items.filter((entry) => excluded.has(entry.id)).length;
      expect(result.metadata.totalItems).toBe(scenario.items.length);
      expect(result.metadata.excludedItems).toBe(excludedCount);
      expect(result.metadata.eligibleItems).toBe(scenario.items.length - excludedCount);

      for (const recommendation of result.recommendations) {
        expect(recommendation.score).toBe(0.5);
        expect(recommendation.explanation.strategy).toBe('baseline');
        expect(recommendation.explanation.components).toHaveLength(1);
      }
    }
  });

  it('handles a large collection without reordering', () => {
    const recommender = makeRecommender({
      limits: { maxItems: 10_000, maxLimit: 1_000, defaultLimit: 100 },
    });
    const large = items(10_000);
    const result = recommendRaw(recommender, { items: large, limit: 1_000 });

    expect(result.metadata.totalItems).toBe(10_000);
    expect(result.recommendations).toHaveLength(1_000);
    expect(resultIds(result)).toEqual(large.slice(0, 1_000).map((entry) => entry.id));
  });

  it('produces stable results across new equivalent instances', () => {
    const request = { items: items(500), excludeItemIds: ['item-3', 'item-77'], limit: 50 };
    const first = recommendRaw(makeRecommender(), request);
    const second = recommendRaw(createRecommender(), request);
    expect(second).toEqual(first);
  });

  it('supports reusing one request object repeatedly', () => {
    const request = { items: items(20), limit: 7, excludeItemIds: ['item-0'] };
    const recommender = makeRecommender();
    const expected = recommendRaw(recommender, request);
    for (let index = 0; index < 25; index += 1) {
      expect(recommendRaw(recommender, request)).toEqual(expected);
    }
  });

  it('keeps recommendation ranks and scores internally consistent', () => {
    const result = recommendRaw(makeRecommender(), { items: items(100), limit: 100 });
    result.recommendations.forEach((recommendation, index) => {
      expect(recommendation.rank).toBe(index + 1);
      expect(recommendation.score).toBe(0.5);
      expect(Number.isFinite(recommendation.score)).toBe(true);
    });
  });

  it('does not leak excluded IDs into the result', () => {
    const result = recommendRaw(makeRecommender(), {
      items: [item('keep'), item('drop-secret')],
      excludeItemIds: ['drop-secret'],
    });
    expect(JSON.stringify(result)).not.toContain('drop-secret');
  });
});
