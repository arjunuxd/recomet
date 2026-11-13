import type { RecommendationRequest } from './request.js';
import type { RecommendationResult } from './result.js';

/**
 * Public synchronous engine surface.
 *
 * Instances are created with `createRecommender`; the implementation class is
 * internal so no configuration or engine internals leak into the public types.
 */
export interface Recommender {
  recommend(request: RecommendationRequest): RecommendationResult;
}
