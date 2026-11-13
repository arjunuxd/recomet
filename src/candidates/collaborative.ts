import type { Candidate, CandidateContext } from './candidate.js';
import type { InteractionModel } from '../collaborative/model.js';
import { normalizedStrength } from '../collaborative/model.js';
import { computeSimilarity, type SimilarityResult } from '../collaborative/similarity.js';
import type { ResolvedCollaborativeConfig } from '../validation/config.js';
import type { ResolvedEngineLimits } from '../internal/limits.js';
import { collaborativeScore } from '../ranking/score.js';
import {
  tryConsumeSimilarityEvaluation,
  type SimilarityEvaluationBudget,
} from '../collaborative/budget.js';

export interface CollaborativeCandidateContext extends CandidateContext {
  readonly model: InteractionModel;
  readonly targetUserId: string;
  readonly collaborative: ResolvedCollaborativeConfig;
  readonly method: 'user' | 'item';
  readonly limits: ResolvedEngineLimits;
  /** Request-scoped total similarity-evaluation budget (shared across auto attempts). */
  readonly budget: SimilarityEvaluationBudget;
}

export interface CollaborativeCollection {
  readonly candidates: readonly Candidate[];
  readonly applicable: boolean;
  readonly method: 'user' | 'item';
  /** Actual `computeSimilarity` invocations performed for this collection call. */
  readonly evaluationsPerformed: number;
  /** Configured per-request total similarity-evaluation budget. */
  readonly evaluationBudget: number;
  /** True when evaluation stopped because the per-request budget was exhausted. */
  readonly budgetExhausted: boolean;
  /** User-based: overlapping users attempted in relevance order (bounded by budget). */
  readonly usersConsidered: number;
  /** User-based: neighbors selected after evaluation; item-based: anchors available. */
  readonly neighborsOrAnchorsSelected: number;
  /** Item-based: eligible candidates that received at least one evaluation. */
  readonly candidatesEvaluated: number;
  /** Item-based: eligible candidates that received zero evaluations due to budget. */
  readonly candidatesSkipped: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function topSimilarities(results: SimilarityResult[], limit: number): SimilarityResult[] {
  return [...results]
    .sort((a, b) => {
      if (b.similarity !== a.similarity) {
        return b.similarity - a.similarity;
      }
      if (b.overlap !== a.overlap) {
        return b.overlap - a.overlap;
      }
      return compareIds(a.id, b.id);
    })
    .slice(0, limit);
}

/**
 * Deterministically orders other users by relevance for user-based comparison.
 * Prioritizes users sharing items with the target (overlap count desc, userId
 * asc). Only overlapping users can satisfy `minOverlap >= 1`. Returns the full
 * ordered list; actual evaluations are bounded by the request-scoped similarity
 * budget.
 */
function orderedOverlappingUsers(
  model: InteractionModel,
  targetUserId: string,
  targetItems: ReadonlyMap<string, number>,
): string[] {
  const overlapCounts = new Map<string, number>();

  for (const itemId of targetItems.keys()) {
    const usersForItem = model.itemUsers.get(itemId);
    if (usersForItem === undefined) {
      continue;
    }
    for (const userId of usersForItem.keys()) {
      if (userId === targetUserId) {
        continue;
      }
      overlapCounts.set(userId, (overlapCounts.get(userId) ?? 0) + 1);
    }
  }

  return [...overlapCounts.entries()]
    .map(([id, overlap]) => ({ id, overlap }))
    .sort((a, b) => {
      if (b.overlap !== a.overlap) {
        return b.overlap - a.overlap;
      }
      return compareIds(a.id, b.id);
    })
    .map((entry) => entry.id);
}

function collectUserBased(context: CollaborativeCandidateContext): CollaborativeCollection {
  const { model, targetUserId, collaborative, excludedIds, items, budget } = context;
  const targetItems = model.userItems.get(targetUserId);
  if (targetItems === undefined || targetItems.size === 0) {
    return {
      candidates: [],
      applicable: false,
      method: 'user',
      evaluationsPerformed: 0,
      evaluationBudget: budget.configured,
      budgetExhausted: budget.exhausted,
      usersConsidered: 0,
      neighborsOrAnchorsSelected: 0,
      candidatesEvaluated: 0,
      candidatesSkipped: 0,
    };
  }

  const comparisonUsers = orderedOverlappingUsers(model, targetUserId, targetItems);
  const consumedBefore = budget.consumed;
  const similarities: SimilarityResult[] = [];
  let usersConsidered = 0;
  for (const userId of comparisonUsers) {
    if (!tryConsumeSimilarityEvaluation(budget)) {
      break;
    }
    usersConsidered += 1;
    const userItems = model.userItems.get(userId);
    if (userItems === undefined) {
      // Consumed unit counted an attempted evaluation slot; no similarity
      // math occurred because the model is missing this user. This is
      // defensive and should not occur for a consistent request model.
      continue;
    }
    const result = computeSimilarity(targetItems, userItems, model.maxAbsStrength, collaborative);
    if (result !== undefined && result.similarity > 0) {
      similarities.push({ ...result, id: userId });
    }
  }
  const neighbors = topSimilarities(similarities, collaborative.maxNeighbors);
  const evaluationsPerformed = budget.consumed - consumedBefore;

  if (neighbors.length === 0) {
    return {
      candidates: [],
      applicable: false,
      method: 'user',
      evaluationsPerformed,
      evaluationBudget: budget.configured,
      budgetExhausted: budget.exhausted,
      usersConsidered,
      neighborsOrAnchorsSelected: 0,
      candidatesEvaluated: 0,
      candidatesSkipped: 0,
    };
  }

  const candidates: Candidate[] = [];
  for (const item of items) {
    if (excludedIds.has(item.id) || targetItems.has(item.id)) {
      continue;
    }
    let weighted = 0;
    let weightSum = 0;
    let support = 0;
    for (const neighbor of neighbors) {
      const neighborItems = model.userItems.get(neighbor.id);
      const strength = neighborItems?.get(item.id);
      if (strength === undefined) {
        continue;
      }
      support += 1;
      const n = Math.max(0, normalizedStrength(strength, model.maxAbsStrength));
      weighted += neighbor.similarity * n;
      weightSum += neighbor.similarity;
    }
    if (weightSum <= 0 || !Number.isFinite(weighted / weightSum)) {
      continue;
    }
    const score = clamp01(weighted / weightSum);
    if (score <= 0) {
      continue;
    }
    const scored = collaborativeScore(score, support);
    candidates.push({
      itemId: item.id,
      sourceIndex: item.sourceIndex,
      score: scored.score,
      components: scored.components,
    });
  }

  return {
    candidates,
    applicable: candidates.length > 0,
    method: 'user',
    evaluationsPerformed,
    evaluationBudget: budget.configured,
    budgetExhausted: budget.exhausted,
    usersConsidered,
    neighborsOrAnchorsSelected: neighbors.length,
    candidatesEvaluated: 0,
    candidatesSkipped: 0,
  };
}

interface ItemAnchor {
  readonly likedItemId: string;
  readonly userStrength: number;
  readonly likedUsers: ReadonlyMap<string, number>;
}

/**
 * Deterministically orders target-user liked-item anchors by relevance.
 * Stronger interactions are prioritized (`abs(strength)` desc, itemId asc).
 * All anchors are returned; the fair allocation loop consumes evaluations from
 * the shared request budget.
 */
function orderedItemAnchors(
  model: InteractionModel,
  targetItems: ReadonlyMap<string, number>,
): ItemAnchor[] {
  return [...targetItems.entries()]
    .map(([likedItemId, userStrength]) => ({ likedItemId, userStrength }))
    .sort((a, b) => {
      const absDiff = Math.abs(b.userStrength) - Math.abs(a.userStrength);
      if (absDiff !== 0) {
        return absDiff;
      }
      return compareIds(a.likedItemId, b.likedItemId);
    })
    .flatMap((anchor) => {
      const likedUsers = model.itemUsers.get(anchor.likedItemId);
      if (likedUsers === undefined) {
        return [];
      }
      return [{ ...anchor, likedUsers }];
    });
}

interface EligibleItemCandidate {
  readonly itemId: string;
  readonly sourceIndex: number;
  readonly itemUsers: ReadonlyMap<string, number>;
  weighted: number;
  weightSum: number;
  support: number;
  evaluations: number;
}

function collectItemBased(context: CollaborativeCandidateContext): CollaborativeCollection {
  const { model, targetUserId, collaborative, excludedIds, items, budget } = context;
  const targetItems = model.userItems.get(targetUserId);
  if (targetItems === undefined || targetItems.size === 0) {
    return {
      candidates: [],
      applicable: false,
      method: 'item',
      evaluationsPerformed: 0,
      evaluationBudget: budget.configured,
      budgetExhausted: budget.exhausted,
      usersConsidered: 0,
      neighborsOrAnchorsSelected: 0,
      candidatesEvaluated: 0,
      candidatesSkipped: 0,
    };
  }

  const anchors = orderedItemAnchors(model, targetItems);
  if (anchors.length === 0) {
    return {
      candidates: [],
      applicable: false,
      method: 'item',
      evaluationsPerformed: 0,
      evaluationBudget: budget.configured,
      budgetExhausted: budget.exhausted,
      usersConsidered: 0,
      neighborsOrAnchorsSelected: 0,
      candidatesEvaluated: 0,
      candidatesSkipped: 0,
    };
  }

  const eligible: EligibleItemCandidate[] = [];
  for (const item of items) {
    if (excludedIds.has(item.id) || targetItems.has(item.id)) {
      continue;
    }
    const itemUsers = model.itemUsers.get(item.id);
    if (itemUsers === undefined || itemUsers.size === 0) {
      continue;
    }
    eligible.push({
      itemId: item.id,
      sourceIndex: item.sourceIndex,
      itemUsers,
      weighted: 0,
      weightSum: 0,
      support: 0,
      evaluations: 0,
    });
  }

  const consumedBefore = budget.consumed;
  if (eligible.length > 0) {
    // Fair, deterministic allocation: anchor rounds (outer, by anchor relevance
    // order) × eligible candidates (inner, request order). Each candidate gets
    // an evaluation opportunity against anchor[0] before any gets anchor[1],
    // preventing naive front-loading that would starve later candidates. If the
    // budget is exhausted mid-round, remaining candidates in that round miss the
    // current anchor deterministically; no similarity evaluation occurs without
    // consuming budget.
    for (let a = 0; a < anchors.length && !budget.exhausted; a += 1) {
      const anchor = anchors[a]!;
      for (let c = 0; c < eligible.length; c += 1) {
        const candidate = eligible[c]!;
        if (anchor.likedItemId === candidate.itemId) {
          continue;
        }
        if (!tryConsumeSimilarityEvaluation(budget)) {
          break;
        }
        candidate.evaluations += 1;
        const sim = computeSimilarity(
          candidate.itemUsers,
          anchor.likedUsers,
          model.maxAbsStrength,
          collaborative,
        );
        if (sim === undefined || sim.similarity <= 0) {
          continue;
        }
        candidate.support += 1;
        const targetNorm = Math.max(
          0,
          normalizedStrength(anchor.userStrength, model.maxAbsStrength),
        );
        candidate.weighted += sim.similarity * targetNorm;
        candidate.weightSum += sim.similarity;
      }
    }
  }

  let candidatesEvaluated = 0;
  const candidates: Candidate[] = [];
  for (const candidate of eligible) {
    if (candidate.evaluations > 0) {
      candidatesEvaluated += 1;
    }
    if (candidate.weightSum <= 0 || !Number.isFinite(candidate.weighted / candidate.weightSum)) {
      continue;
    }
    const score = clamp01(candidate.weighted / candidate.weightSum);
    if (score <= 0) {
      continue;
    }
    const scored = collaborativeScore(score, candidate.support);
    candidates.push({
      itemId: candidate.itemId,
      sourceIndex: candidate.sourceIndex,
      score: scored.score,
      components: scored.components,
    });
  }

  const evaluationsPerformed = budget.consumed - consumedBefore;
  return {
    candidates,
    applicable: candidates.length > 0,
    method: 'item',
    evaluationsPerformed,
    evaluationBudget: budget.configured,
    budgetExhausted: budget.exhausted,
    usersConsidered: 0,
    neighborsOrAnchorsSelected: anchors.length,
    candidatesEvaluated,
    candidatesSkipped: eligible.length - candidatesEvaluated,
  };
}

export function collectCollaborative(
  context: CollaborativeCandidateContext,
): CollaborativeCollection {
  if (context.method === 'item') {
    return collectItemBased(context);
  }
  return collectUserBased(context);
}
