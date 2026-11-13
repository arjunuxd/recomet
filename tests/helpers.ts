import { expect } from 'vitest';
import {
  createRecommender,
  RecometError,
  type ContentItem,
  type RecommendationRequest,
  type RecommendationResult,
  type RecommenderConfig,
} from '../src/index.js';

export type TestRecommender = ReturnType<typeof createRecommender>;

export function makeRecommender(config?: RecommenderConfig): TestRecommender {
  return createRecommender(config);
}

export function item(id: string, attributes?: Record<string, unknown>): ContentItem {
  if (attributes === undefined) {
    return { id };
  }
  return {
    id,
    attributes: attributes as NonNullable<ContentItem['attributes']>,
  };
}

export function items(count: number, prefix = 'item'): ContentItem[] {
  const result: ContentItem[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push({ id: `${prefix}-${index}` });
  }
  return result;
}

export function recommendRaw(recommender: TestRecommender, request: unknown): RecommendationResult {
  return recommender.recommend(request as RecommendationRequest);
}

export function expectRecometError(fn: () => unknown, code: string): RecometError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RecometError);
    const recometError = error as RecometError;
    expect(recometError.code).toBe(code);
    return recometError;
  }
  throw new Error(`Expected a RecometError with code ${code}`);
}

export function resultIds(result: RecommendationResult): string[] {
  return result.recommendations.map((recommendation) => recommendation.itemId);
}
