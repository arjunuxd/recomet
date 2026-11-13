import type { PreferenceKind } from '../contracts/personalization.js';
import type { ScoreComponent, ScoreFactor } from '../contracts/result.js';
import type { ContentSignals, NormalizedPreferences } from '../content/model.js';

export const BASELINE_VALUE = 0.5;
export const BASELINE_SUMMARY =
  'Neutral baseline: no personalization or relevance model was applied.';
export const CONTENT_SUMMARY =
  'Content-based relevance from explicit preferences; no interaction history was used.';
export const COLLABORATIVE_SUMMARY =
  'Collaborative filtering from explicitly supplied interaction data; no content-collaborative blending was used.';
export const COLLABORATIVE_FALLBACK_BASELINE_SUMMARY =
  'Neutral baseline fallback: collaborative filtering was requested but insufficient interaction data was available; no collaborative signal was applied.';
export const COLLABORATIVE_FALLBACK_CONTENT_SUMMARY =
  'Content-based fallback: collaborative filtering was requested but insufficient interaction data was available; explicit preferences were used instead.';
export const HYBRID_SUMMARY =
  'Hybrid relevance from available content and collaborative signals using availability-aware weighted fusion; missing collaborative evidence was not treated as an observed zero.';
export const HYBRID_CONTENT_ONLY_SUMMARY =
  'Hybrid relevance using only available content signals; no collaborative evidence was available for this result.';
export const HYBRID_COLLABORATIVE_ONLY_SUMMARY =
  'Hybrid relevance using only available collaborative evidence; no explicit content preferences were available.';
export const HYBRID_FALLBACK_BASELINE_SUMMARY =
  'Neutral baseline fallback: hybrid strategy was requested but no usable content or collaborative signals were available.';
export const TRENDING_SUMMARY =
  'Trending relevance computed locally from explicitly supplied interactions within an explicit time window using an injectable reference time; no external data was used.';
export const TRENDING_FALLBACK_BASELINE_SUMMARY =
  'Neutral baseline fallback: trending strategy was requested but insufficient local time-window interaction data was available.';
export const DISCOVERY_SUMMARY =
  'Discovery relevance computed locally from supplied data to surface trending and less-seen eligible items with explicit time-window and cold-start handling; no external data was used.';
export const DISCOVERY_FALLBACK_TRENDING_SUMMARY =
  'Discovery fallback: trending relevance was used because discovery-specific signals were limited in the supplied data.';
export const DISCOVERY_FALLBACK_BASELINE_SUMMARY =
  'Neutral baseline fallback: discovery strategy was requested but insufficient local data was available.';

export interface RawScoreComponent {
  readonly factor: ScoreFactor;
  readonly value: number;
  readonly weight: number;
}

/**
 * Normalizes raw weights and computes component contributions.
 *
 * Values must be finite and within `[0, 1]`; weights must be finite and
 * non-negative. The returned score is clamped to `[0, 1]` to keep the public
 * contract safe from floating-point edge cases.
 */
export function combineScore(components: readonly RawScoreComponent[]): {
  readonly score: number;
  readonly components: readonly ScoreComponent[];
} {
  let totalWeight = 0;
  for (const component of components) {
    if (
      typeof component.value !== 'number' ||
      !Number.isFinite(component.value) ||
      component.value < 0 ||
      component.value > 1
    ) {
      throw new RangeError('Score component value must be finite and within [0, 1].');
    }
    if (
      typeof component.weight !== 'number' ||
      !Number.isFinite(component.weight) ||
      component.weight < 0
    ) {
      throw new RangeError('Score component weight must be finite and non-negative.');
    }
    totalWeight += component.weight;
  }

  if (!Number.isFinite(totalWeight)) {
    throw new RangeError('Score component weights must have a finite total.');
  }

  const combined: ScoreComponent[] = [];
  let score = 0;

  for (const component of components) {
    const normalizedWeight = totalWeight > 0 ? component.weight / totalWeight : 0;
    const contribution = component.value * normalizedWeight;
    score += contribution;
    combined.push(
      Object.freeze({
        factor: component.factor,
        value: component.value,
        weight: component.weight,
        contribution,
      }),
    );
  }

  if (!Number.isFinite(score)) {
    throw new RangeError('Combined score must be finite.');
  }

  return Object.freeze({
    score: Math.min(1, Math.max(0, score)),
    components: Object.freeze(combined),
  });
}

export function baselineScore(): {
  readonly score: number;
  readonly components: readonly ScoreComponent[];
} {
  return combineScore([
    {
      factor: 'baseline',
      value: BASELINE_VALUE,
      weight: 1,
    },
  ]);
}

export function collaborativeScore(
  value: number,
  support: number,
): {
  readonly score: number;
  readonly components: readonly ScoreComponent[];
} {
  const safeValue = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const weight = Number.isFinite(support) && support > 0 ? support : 1;
  return combineScore([
    {
      factor: 'collaborative',
      value: safeValue,
      weight,
    },
  ]);
}

/**
 * Weighted content relevance.
 *
 * For each active preference kind, the value is the sum of matched preference
 * weights divided by the total preference weight for that kind. Kind values are
 * combined with configured factor weights. There are no implicit freshness,
 * popularity, or interaction factors.
 */
export function contentScore(
  signals: ContentSignals,
  preferences: NormalizedPreferences,
  weights: Readonly<Record<PreferenceKind, number>>,
): {
  readonly score: number;
  readonly components: readonly ScoreComponent[];
} {
  const raw: RawScoreComponent[] = [];

  for (const kind of preferences.activeKinds) {
    const terms = preferences.byKind[kind];
    const total = preferences.totals[kind];
    const values = signals[kind];
    let matched = 0;

    for (const term of terms) {
      if (values.has(term.value)) {
        matched += term.weight;
      }
    }

    const value = total > 0 ? Math.min(1, Math.max(0, matched / total)) : 0;
    raw.push({
      factor: kind,
      value,
      weight: weights[kind],
    });
  }

  return combineScore(raw);
}

function clampUnit(value: number): number {
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

/**
 * Availability-aware hybrid fusion (Phase 4).
 *
 * Missing collaborative evidence is represented by absence of a collaborative
 * component, not by a synthetic zero score. Division occurs only when active
 * weight sum > 0; callers must ensure config validation rejects both-zero.
 */
export function hybridScore(input: {
  readonly contentScore?: number | undefined;
  readonly collaborativeScore?: number | undefined;
  readonly contentWeight: number;
  readonly collaborativeWeight: number;
}): {
  readonly score: number;
  readonly components: readonly ScoreComponent[];
  readonly hasContent: boolean;
  readonly hasCollaborative: boolean;
} {
  const hasContent = input.contentScore !== undefined && input.contentWeight > 0;
  const hasCollaborative = input.collaborativeScore !== undefined && input.collaborativeWeight > 0;
  const raw: RawScoreComponent[] = [];
  if (hasContent) {
    raw.push({
      factor: 'content',
      value: clampUnit(input.contentScore ?? 0),
      weight: input.contentWeight,
    });
  }
  if (hasCollaborative) {
    raw.push({
      factor: 'collaborative',
      value: clampUnit(input.collaborativeScore ?? 0),
      weight: input.collaborativeWeight,
    });
  }
  if (raw.length === 0) {
    return { score: 0, components: Object.freeze([]), hasContent, hasCollaborative };
  }
  const combined = combineScore(raw);
  return {
    score: clampUnit(combined.score),
    components: combined.components,
    hasContent,
    hasCollaborative,
  };
}
