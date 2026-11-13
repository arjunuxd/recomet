import type { RecommenderConfig } from '../contracts/config.js';
import type { Recommender } from '../contracts/recommender.js';
import { resolveConfig } from '../validation/config.js';
import { Recommender as RecommenderEngine } from './recommender.js';

/**
 * Creates an independent synchronous recommender.
 *
 * Invalid configuration throws `RecometError` before an instance is returned.
 */
export function createRecommender(config?: RecommenderConfig): Recommender {
  const resolved = resolveConfig(config);
  return new RecommenderEngine(resolved);
}
