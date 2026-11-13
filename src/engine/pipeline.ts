import type { RecommendationResult, StrategyId } from '../contracts/result.js';
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
  DISCOVERY_FALLBACK_BASELINE_SUMMARY,
  DISCOVERY_FALLBACK_TRENDING_SUMMARY,
  DISCOVERY_SUMMARY,
  HYBRID_COLLABORATIVE_ONLY_SUMMARY,
  HYBRID_CONTENT_ONLY_SUMMARY,
  HYBRID_FALLBACK_BASELINE_SUMMARY,
  HYBRID_SUMMARY,
  TRENDING_FALLBACK_BASELINE_SUMMARY,
  TRENDING_SUMMARY,
  contentScore,
  hybridScore,
} from '../ranking/score.js';
import type { ResolvedConfig } from '../validation/config.js';
import {
  createSimilarityEvaluationBudget,
  type SimilarityEvaluationBudget,
} from '../collaborative/budget.js';
import {
  applyDiversityRerank,
  buildPopularityScores,
  buildTrendingScores,
  combineWithAdvancedFactors,
  computeFreshness,
  getDiversityGroup,
  normalizeCountMap,
  type AdvancedScored,
} from '../ranking/advanced.js';

interface RankedBase extends Candidate {
  readonly attributes?: Readonly<Record<string, unknown>> | undefined;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

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
  if (strategy === 'trending') {
    return TRENDING_SUMMARY;
  }
  if (strategy === 'discovery') {
    return DISCOVERY_SUMMARY;
  }
  if (collaborativeRequested && !collaborativeApplied && !hasFallbackContent) {
    return COLLABORATIVE_FALLBACK_BASELINE_SUMMARY;
  }
  return BASELINE_SUMMARY;
}

function formatFromAdvanced(
  strategy: StrategyId,
  selected: readonly AdvancedScored[],
  validated: ValidatedRequest,
  summary: string,
): RecommendationResult {
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

function hasAnyAdvancedRanking(config: ResolvedConfig): boolean {
  const r = config.ranking;
  return (
    r.freshness !== undefined ||
    r.popularity !== undefined ||
    r.diversity !== undefined ||
    r.trending !== undefined
  );
}

function applyAdvancedRanking(
  base: readonly RankedBase[],
  validated: ValidatedRequest,
  config: ResolvedConfig,
  strategy: StrategyId,
  summary: string,
): RecommendationResult {
  const ranking = config.ranking;
  const popularityMap =
    ranking.popularity !== undefined
      ? normalizeCountMap(buildPopularityScores(validated.interactions, ranking.popularity.types))
      : undefined;
  const trendingMap =
    ranking.trending !== undefined
      ? buildTrendingScores(validated.interactions, ranking, validated.now)
      : undefined;

  const enriched: AdvancedScored[] = base.map((candidate) => {
    const freshness =
      ranking.freshness !== undefined
        ? computeFreshness(candidate.attributes, ranking, validated.now)
        : undefined;
    const popularity =
      popularityMap !== undefined ? (popularityMap.get(candidate.itemId) ?? 0) : undefined;
    const trending =
      trendingMap !== undefined ? (trendingMap.get(candidate.itemId) ?? 0) : undefined;
    const combined = combineWithAdvancedFactors({
      baseScore: candidate.score,
      baseComponents: candidate.components,
      freshness,
      popularity,
      trending,
      ranking,
    });
    return {
      itemId: candidate.itemId,
      sourceIndex: candidate.sourceIndex,
      score: combined.score,
      components: combined.components,
      groupKey: getDiversityGroup(candidate.attributes, ranking),
      freshnessValue: freshness,
      popularityValue: popularity,
      trendingValue: trending,
    };
  });

  // Rank by adjusted score with deterministic tie-breaks.
  enriched.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex;
    return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
  });

  const selected =
    ranking.diversity !== undefined
      ? applyDiversityRerank(enriched, ranking, validated.limit)
      : enriched.slice(0, validated.limit);

  return formatFromAdvanced(strategy, selected, validated, summary);
}

function collectHybridBase(
  validated: ValidatedRequest,
  config: ResolvedConfig,
): {
  readonly candidates: readonly RankedBase[];
  readonly cfApplied: boolean;
  readonly fallbackToBaseline: boolean;
} {
  const wC = config.hybrid.contentWeight;
  const wF = config.hybrid.collaborativeWeight;
  const contentAvailable = validated.preferences !== undefined;
  const cfContextUsable =
    validated.interactionModel !== undefined && validated.userId !== undefined;
  const effectiveContent = contentAvailable && wC > 0;
  const effectiveCf = cfContextUsable && wF > 0;

  if (!effectiveContent && !effectiveCf) {
    const candidates = [
      ...baselineSource.collect({
        items: validated.items,
        excludedIds: validated.excludedIds,
      }),
    ].map((c) => {
      const item = validated.items[c.sourceIndex];
      return { ...c, attributes: item?.attributes };
    });
    return { candidates, cfApplied: false, fallbackToBaseline: true };
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

  const candidates: RankedBase[] = [];
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
        attributes: item.attributes,
      });
      continue;
    }
    candidates.push({
      itemId: item.id,
      sourceIndex: item.sourceIndex,
      score: fused.score,
      components: fused.components,
      attributes: item.attributes,
    });
  }

  return { candidates, cfApplied, fallbackToBaseline: false };
}

function collectTrendingBase(
  validated: ValidatedRequest,
  config: ResolvedConfig,
): readonly RankedBase[] {
  const trendingCfg = config.ranking.trending ?? {
    windowMs: 24 * 60 * 60 * 1000,
    weight: 1,
    types: undefined,
    halfLifeMs: 0,
  };
  const rankingForTrending = {
    ...config.ranking,
    trending: trendingCfg,
  } as ResolvedConfig['ranking'];
  const trendScores = buildTrendingScores(
    validated.interactions,
    rankingForTrending,
    validated.now,
  );
  const targetInteracted =
    validated.userId && validated.interactionModel
      ? validated.interactionModel.userItems.get(validated.userId)
      : undefined;

  const candidates: RankedBase[] = [];
  for (const item of validated.items) {
    if (validated.excludedIds.has(item.id)) {
      continue;
    }
    if (targetInteracted?.has(item.id)) {
      continue;
    }
    const value = trendScores.get(item.id) ?? 0;
    candidates.push({
      itemId: item.id,
      sourceIndex: item.sourceIndex,
      score: clamp01(value),
      components: Object.freeze([
        Object.freeze({
          factor: 'trending',
          value: clamp01(value),
          weight: trendingCfg.weight,
          contribution: clamp01(value),
        }),
      ]),
      attributes: item.attributes,
    });
  }
  return candidates;
}

function collectDiscoveryBase(
  validated: ValidatedRequest,
  config: ResolvedConfig,
): {
  readonly candidates: readonly RankedBase[];
  readonly mode: 'trending' | 'popularity' | 'baseline';
} {
  const trendBase = collectTrendingBase(validated, config);
  const trendMax = trendBase.reduce((m, c) => (c.score > m ? c.score : m), 0);
  if (trendMax > 0) {
    // Discovery: emphasize trending but keep all eligible candidates; cold-start
    // items (no trend) remain eligible with score 0 and can be surfaced by
    // freshness/popularity/diversity controls when configured.
    return { candidates: trendBase, mode: 'trending' };
  }
  // Cold-start / no in-window signal: fall back to popularity over all supplied
  // interactions (local), else baseline.
  const pop = normalizeCountMap(buildPopularityScores(validated.interactions, undefined));
  const hasPop = pop.size > 0;
  const targetInteracted =
    validated.userId && validated.interactionModel
      ? validated.interactionModel.userItems.get(validated.userId)
      : undefined;
  const candidates: RankedBase[] = [];
  for (const item of validated.items) {
    if (validated.excludedIds.has(item.id)) continue;
    if (targetInteracted?.has(item.id)) continue;
    const value = hasPop ? (pop.get(item.id) ?? 0) : 0.5;
    candidates.push({
      itemId: item.id,
      sourceIndex: item.sourceIndex,
      score: clamp01(value),
      components: Object.freeze([
        Object.freeze({
          factor: hasPop ? 'popularity' : 'baseline',
          value: clamp01(value),
          weight: 1,
          contribution: clamp01(value),
        }),
      ]),
      attributes: item.attributes,
    });
  }
  return { candidates, mode: hasPop ? 'popularity' : 'baseline' };
}

function selectRanked(candidates: readonly RankedBase[], limit: number): RankedBase[] {
  return deterministicRanker.select(candidates as Candidate[], limit) as RankedBase[];
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
  const advanced = hasAnyAdvancedRanking(config);

  if (validated.strategy === 'trending') {
    const base = collectTrendingBase(validated, config);
    const hasSignal = base.some((c) => c.score > 0);
    if (!hasSignal) {
      const baseline = [
        ...baselineSource.collect({ items: validated.items, excludedIds: validated.excludedIds }),
      ].map((c) => ({ ...c, attributes: validated.items[c.sourceIndex]?.attributes }));
      if (advanced) {
        return applyAdvancedRanking(
          baseline,
          validated,
          config,
          'baseline',
          TRENDING_FALLBACK_BASELINE_SUMMARY,
        );
      }
      return formatFromAdvanced(
        'baseline',
        selectRanked(baseline, validated.limit).map((c) => ({
          ...c,
          groupKey: undefined,
          freshnessValue: undefined,
          popularityValue: undefined,
          trendingValue: undefined,
        })),
        validated,
        TRENDING_FALLBACK_BASELINE_SUMMARY,
      );
    }
    if (advanced) {
      return applyAdvancedRanking(base, validated, config, 'trending', TRENDING_SUMMARY);
    }
    return formatResult('trending', selectRanked(base, validated.limit), validated, false);
  }

  if (validated.strategy === 'discovery') {
    const discovered = collectDiscoveryBase(validated, config);
    if (discovered.mode === 'baseline') {
      const baseline = [
        ...baselineSource.collect({ items: validated.items, excludedIds: validated.excludedIds }),
      ].map((c) => ({ ...c, attributes: validated.items[c.sourceIndex]?.attributes }));
      if (advanced) {
        return applyAdvancedRanking(
          baseline,
          validated,
          config,
          'baseline',
          DISCOVERY_FALLBACK_BASELINE_SUMMARY,
        );
      }
      return formatFromAdvanced(
        'baseline',
        selectRanked(baseline, validated.limit).map((c) => ({
          ...c,
          groupKey: undefined,
          freshnessValue: undefined,
          popularityValue: undefined,
          trendingValue: undefined,
        })),
        validated,
        DISCOVERY_FALLBACK_BASELINE_SUMMARY,
      );
    }
    const summary =
      discovered.mode === 'trending' ? DISCOVERY_SUMMARY : DISCOVERY_FALLBACK_TRENDING_SUMMARY;
    if (advanced) {
      return applyAdvancedRanking(discovered.candidates, validated, config, 'discovery', summary);
    }
    return formatFromAdvanced(
      'discovery',
      selectRanked(discovered.candidates, validated.limit).map((c) => ({
        ...c,
        groupKey: undefined,
        freshnessValue: undefined,
        popularityValue: undefined,
        trendingValue: undefined,
      })),
      validated,
      summary,
    );
  }

  if (validated.hybridRequested) {
    const hybridBase = collectHybridBase(validated, config);
    if (hybridBase.fallbackToBaseline) {
      if (advanced) {
        return applyAdvancedRanking(
          hybridBase.candidates,
          validated,
          config,
          'baseline',
          HYBRID_FALLBACK_BASELINE_SUMMARY,
        );
      }
      const selected = selectRanked(hybridBase.candidates, validated.limit);
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
    const hybridSummary = summaryFor(
      'hybrid',
      false,
      hybridBase.cfApplied,
      validated.preferences !== undefined && config.hybrid.contentWeight > 0,
    );
    if (advanced) {
      return applyAdvancedRanking(
        hybridBase.candidates,
        validated,
        config,
        'hybrid',
        hybridSummary,
      );
    }
    const selected = selectRanked(hybridBase.candidates, validated.limit);
    return formatFromAdvanced(
      'hybrid',
      selected.map((c) => ({
        ...c,
        groupKey: undefined,
        freshnessValue: undefined,
        popularityValue: undefined,
        trendingValue: undefined,
      })),
      validated,
      hybridSummary,
    );
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
      let candidates: Candidate[];
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
        candidates = [...collected.candidates];
        collaborativeApplied = true;
      } else if (attempt.strategy === 'content') {
        candidates = [
          ...contentSource.collect({
            items: validated.items,
            excludedIds: validated.excludedIds,
            preferences: validated.preferences,
            weights: config.content.weights,
          }),
        ];
      } else {
        candidates = [
          ...baselineSource.collect({
            items: validated.items,
            excludedIds: validated.excludedIds,
          }),
        ];
      }

      const baseWithAttrs: RankedBase[] = candidates.map((c) => ({
        ...c,
        attributes: validated.items[c.sourceIndex]?.attributes,
      }));

      if (advanced) {
        const summary = summaryFor(
          attempt.strategy,
          validated.collaborativeRequested,
          collaborativeApplied,
          validated.preferences !== undefined && validated.fallbackStrategy === 'content',
        );
        return applyAdvancedRanking(baseWithAttrs, validated, config, attempt.strategy, summary);
      }

      const selected = selectRanked(baseWithAttrs, validated.limit);
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
