/**
 * Request-scoped budget for expensive collaborative similarity evaluations.
 *
 * One unit is consumed per actual `computeSimilarity` invocation. The same
 * budget instance must be shared across collaborative methods within one
 * request (including `auto` user-based then item-based fallback attempts) so
 * total evaluations never exceed the configured limit.
 */
export interface SimilarityEvaluationBudget {
  readonly configured: number;
  consumed: number;
  exhausted: boolean;
}

export function createSimilarityEvaluationBudget(configured: number): SimilarityEvaluationBudget {
  return {
    configured,
    consumed: 0,
    exhausted: configured <= 0,
  };
}

/**
 * Consumes one evaluation unit if available.
 *
 * Returns `true` when the caller may perform one similarity evaluation.
 * Returns `false` when the budget is exhausted; in that case no evaluation
 * must occur.
 */
export function tryConsumeSimilarityEvaluation(budget: SimilarityEvaluationBudget): boolean {
  if (budget.consumed >= budget.configured) {
    budget.exhausted = true;
    return false;
  }
  budget.consumed += 1;
  if (budget.consumed >= budget.configured) {
    budget.exhausted = true;
  }
  return true;
}
