import type { RecommendationRequest } from '../contracts/request.js';
import type { RecommendationResult } from '../contracts/result.js';
import type { ResolvedConfig } from '../validation/config.js';
import type { Recommender as RecommenderContract } from '../contracts/recommender.js';
import { runPipeline } from './pipeline.js';

/**
 * A synchronous, isolated recommendation engine instance.
 *
 * Instances hold only an immutable resolved configuration. No request state is
 * retained between calls. The class is internal; only the public `Recommender`
 * contract is exported.
 */
export class Recommender implements RecommenderContract {
  readonly #config: ResolvedConfig;

  constructor(config: ResolvedConfig) {
    this.#config = config;
    Object.freeze(this);
  }

  recommend(request: RecommendationRequest): RecommendationResult {
    return runPipeline(request, this.#config);
  }
}
