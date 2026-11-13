import type { RecommendationResult } from '../contracts/result.js';
import type { StrategyId } from '../contracts/result.js';
import { RecometError } from '../errors/recomet-error.js';
import { baselineSource } from '../candidates/baseline.js';
import { contentSource } from '../candidates/content.js';
import {
  collectCollaborative,
  type CollaborativeCandidateContext,
} from '../candidates/collaborative.js';
import { deterministicRanker } from '../ranking/ranker.js';
import type { Candidate } from '../candidates/candidate.js';
import { validateRequest, type ValidatedRequest } from '../validation/request.js';
import {
  BASELINE_SUMMARY,
  COLLABORATIVE_FALLBACK_BASELINE_SUMMARY,
  COLLABORATIVE_FALLBACK_CONTENT_SUMMARY,
  COLLABORATIVE_SUMMARY,
  CONTENT_SUMMARY,
  HYBRID_COLLABORATIVE_ONLY_SUMMARY,
  HYBRID_CONTENT_ONLY_SUMMARY,
  HYBRID_FALLBACK_BASELINE_SUMMARY,
  HYBRID_SUMMARY,
  contentScore,
  hybridScore,
} from '../ranking/score.js';
import type { ResolvedConfig } from '../validation/config.js';
import {
  createSimilarityEvaluationBudget,
  type SimilarityEvaluationBudget,
} from '../collaborative/budget.js';

function summaryFor(
  strategy: StrategyId,
  collaborativeRequested: boolean,
  collaborativeApplied: boolean,
  hasFallbackContent: boolean,
): string {
  if (strategy === 'content') {
    if (collaborativeRequested && !collaborativeApplied) {
      return COLLABORATIVE_FALLBACK_CONTENT_SUMMARY;
    }
    return CONTENT_SUMMARY;
  }
  if (strategy === 'collaborative') {
    return COLLABORATIVE_SUMMARY;
  }
  if (strategy === 'hybrid') {
    if (collaborativeApplied && hasFallbackContent) {
      return HYBRID_SUMMARY;
    }
    if (hasFallbackContent) {
      return HYBRID_CONTENT_ONLY_SUMMARY;
    }
    if (collaborativeApplied) {
      return HYBRID_COLLABORATIVE_ONLY_SUMMARY;
    }
    return HYBRID_FALLBACK_BASELINE_SUMMARY;
  }
  if (collaborativeRequested && !collaborativeApplied && !hasFallbackContent) {
    return COLLABORATIVE_FALLBACK_BASELINE_SUMMARY;
  }
  return BASELINE_SUMMARY;
}

function formatResult(
  strategy: StrategyId,
  selected: readonly Candidate[],
  validated: ValidatedRequest,
  collaborativeApplied: boolean,
): RecommendationResult {
  const summary = summaryFor(
    strategy,
    validated.collaborativeRequested,
    collaborativeApplied,
    validated.preferences !== undefined && validated.fallbackStrategy === 'content',
  );
  return {
    strategy,
    recommendations: selected.map((candidate, index) => ({
      itemId: candidate.itemId,
      rank: index + 1,
      score: candidate.score,
      explanation: {
        strategy,
        summary,
        components: candidate.components,
      },
    })),
    metadata: {
      totalItems: validated.totalItems,
      eligibleItems: validated.eligibleItems,
      excludedItems: validated.excludedItems,
      returnedItems: selected.length,
      limit: validated.limit,
    },
  };
}

function resolveCollaborativeMethod(
  validated: ValidatedRequest,
  config: ResolvedConfig,
): 'user' | 'item' {
  const configured = config.collaborative.method;
  if (configured === 'user' || configured === 'item') {
    return configured;
  }
  const targetItems = validated.interactionModel?.userItems.get(validated.userId ?? '')?.size ?? 0;
  const users = validated.interactionModel?.userItems.size ?? 0;
  return targetItems > 0 && users > targetItems ? 'item' : 'user';
}

function collectHybrid(validated: ValidatedRequest, config: ResolvedConfig): RecommendationResult {
  const wC = config.hybrid.contentWeight;
  const wF = config.hybrid.collaborativeWeight;
  const contentAvailable = validated.preferences !== undefined;
  const cfContextUsable =
    validated.interactionModel !== undefined && validated.userId !== undefined;
  const effectiveContent = contentAvailable && wC > 0;
  const effectiveCf = cfContextUsable && wF > 0;

  if (!effectiveContent && !effectiveCf) {
    const candidates = baselineSource.collect({
      items: validated.items,
      excludedIds: validated.excludedIds,
    });
    const selected = deterministicRanker.select(candidates, validated.limit);
    // Truthful fallback: neither usable signal available for hybrid.
    return {
      strategy: 'baseline',
      recommendations: selected.map((candidate, index) => ({
        itemId: candidate.itemId,
        rank: index + 1,
        score: candidate.score,
        explanation: {
          strategy: 'baseline',
          summary: HYBRID_FALLBACK_BASELINE_SUMMARY,
          components: candidate.components,
        },
      })),
      metadata: {
        totalItems: validated.totalItems,
        eligibleItems: validated.eligibleItems,
        excludedItems: validated.excludedItems,
        returnedItems: selected.length,
        limit: validated.limit,
      },
    };
  }

  const cfScoreById = new Map<string, number>();
  let cfApplied = false;
  if (effectiveCf && validated.interactionModel && validated.userId) {
    const budget = createSimilarityEvaluationBudget(
      config.limits.maxCollaborativeSimilarityEvaluations,
    );
    const method = resolveCollaborativeMethod(validated, config);
    const collected = collectCollaborative({
      items: validated.items,
      excludedIds: validated.excludedIds,
      model: validated.interactionModel,
      targetUserId: validated.userId,
      collaborative: config.collaborative,
      method,
      limits: config.limits,
      budget,
    } satisfies CollaborativeCandidateContext);
    if (collected.applicable) {
      cfApplied = true;
      for (const c of collected.candidates) {
        cfScoreById.set(c.itemId, c.score);
      }
    }
  }

  const targetInteracted =
    validated.interactionModel && validated.userId
      ? validated.interactionModel.userItems.get(validated.userId)
      : undefined;

  const candidates: Candidate[] = [];
  const contentWeights = config.content.weights;
  for (const item of validated.items) {
    if (validated.excludedIds.has(item.id)) {
      continue;
    }
    // Preserve Phase 3 collaborative semantics: never recommend items the target
    // user has already interacted with (when interaction context is present).
    if (targetInteracted?.has(item.id)) {
      continue;
    }
    let sc: number | undefined;
    if (effectiveContent && validated.preferences) {
      if (item.signals) {
        const scored = contentScore(item.signals, validated.preferences, contentWeights);
        sc = scored.score;
      } else {
        sc = 0;
      }
    }
    const sf = effectiveCf ? cfScoreById.get(item.id) : undefined;
    const fused = hybridScore({
      contentScore: sc,
      collaborativeScore: sf,
      contentWeight: wC,
      collaborativeWeight: wF,
    });
    if (fused.components.length === 0) {
      // Eligible item with no active fused component (e.g. CF-only request and no CF
      // evidence for this item). Keep it rankable with score 0.
      candidates.push({
        itemId: item.id,
        sourceIndex: item.sourceIndex,
        score: 0,
        components: Object.freeze([
          Object.freeze({
            factor: effectiveContent ? 'content' : 'collaborative',
            value: 0,
            weight: 1,
            contribution: 0,
          }),
        ]),
      });
      continue;
    }
    candidates.push({
      itemId: item.id,
      sourceIndex: item.sourceIndex,
      score: fused.score,
      components: fused.components,
    });
  }

  const selected = deterministicRanker.select(candidates, validated.limit);
  return formatResult('hybrid', selected, validated, cfApplied);
}

interface StrategyAttempt {
  readonly strategy: StrategyId;
  readonly method: 'user' | 'item' | undefined;
}

/**
 * Executes the complete recommendation flow for a validated configuration.
 */
export function executePipeline(request: unknown, config: ResolvedConfig): RecommendationResult {
  const validated = validateRequest(request, config);

  if (validated.hybridRequested) {
    return collectHybrid(validated, config);
  }

  const attempts: StrategyAttempt[] = [];
  if (validated.strategy === 'collaborative') {
    attempts.push({
      strategy: 'collaborative',
      method: resolveCollaborativeMethod(validated, config),
    });
  } else if (validated.strategy === 'content') {
    attempts.push({ strategy: 'content', method: undefined });
  }

  if (
    config.strategy === 'auto' ||
    (validated.collaborativeRequested && validated.fallbackStrategy !== 'baseline')
  ) {
    if (
      validated.fallbackStrategy === 'content' &&
      !attempts.some((a) => a.strategy === 'content')
    ) {
      attempts.push({ strategy: 'content', method: undefined });
    }
  }
  if (attempts.length === 0 || attempts[attempts.length - 1]?.strategy !== 'baseline') {
    attempts.push({ strategy: 'baseline', method: undefined });
  }

  let lastError: RecometError | undefined;
  let collaborativeApplied = false;
  const needsCollaborative = attempts.some((a) => a.strategy === 'collaborative');
  const budget: SimilarityEvaluationBudget | undefined = needsCollaborative
    ? createSimilarityEvaluationBudget(config.limits.maxCollaborativeSimilarityEvaluations)
    : undefined;

  for (const attempt of attempts) {
    try {
      let candidates: Iterable<Candidate>;
      if (attempt.strategy === 'collaborative') {
        if (!validated.interactionModel || !validated.userId || !budget) {
          continue;
        }
        const collected = collectCollaborative({
          items: validated.items,
          excludedIds: validated.excludedIds,
          model: validated.interactionModel,
          targetUserId: validated.userId,
          collaborative: config.collaborative,
          method: attempt.method ?? 'user',
          limits: config.limits,
          budget,
        } satisfies CollaborativeCandidateContext);
        if (!collected.applicable) {
          continue;
        }
        candidates = collected.candidates;
        collaborativeApplied = true;
      } else if (attempt.strategy === 'content') {
        candidates = contentSource.collect({
          items: validated.items,
          excludedIds: validated.excludedIds,
          preferences: validated.preferences,
          weights: config.content.weights,
        });
      } else {
        candidates = baselineSource.collect({
          items: validated.items,
          excludedIds: validated.excludedIds,
        });
      }

      const selected = deterministicRanker.select(candidates, validated.limit);
      return formatResult(attempt.strategy, selected, validated, collaborativeApplied);
    } catch (error) {
      if (error instanceof RecometError) {
        lastError = error;
        continue;
      }
      throw new RecometError('INTERNAL_ERROR', 'An internal error occurred.');
    }
  }

  if (lastError !== undefined) {
    throw lastError;
  }
  throw new RecometError('INTERNAL_ERROR', 'An internal error occurred.');
}

/** Compatibility alias. */
export const runPipeline = executePipeline;
