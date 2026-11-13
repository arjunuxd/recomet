import type { ScoreComponent } from '../contracts/result.js';
import type { ValidatedInteraction } from '../collaborative/model.js';
import type { ResolvedRankingConfig } from '../validation/config.js';
import type { AttributeValue } from '../contracts/content.js';
import { isPlainRecord, readDataProperty, ownStringKeys } from '../internal/safe-object.js';

export interface AdvancedScored {
  readonly itemId: string;
  readonly sourceIndex: number;
  score: number;
  components: readonly ScoreComponent[];
  readonly groupKey: string | undefined;
  readonly freshnessValue: number | undefined;
  readonly popularityValue: number | undefined;
  readonly trendingValue: number | undefined;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function readNumericAttribute(
  attributes: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (attributes === undefined) return undefined;
  try {
    const value = readDataProperty(attributes, key);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function readStringAttribute(
  attributes: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (attributes === undefined) return undefined;
  try {
    const value = readDataProperty(attributes, key);
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (typeof first === 'string' && first.length > 0) {
        return first;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function decay(age: number, window: number, halfLife: number): number {
  if (age <= 0) return 1;
  if (age >= window) return 0;
  if (halfLife > 0) {
    // Exponential decay by half-life within the configured window duration.
    const v = Math.pow(0.5, age / halfLife);
    return clamp01(v);
  }
  // Linear decay within the configured window duration.
  return clamp01(1 - age / window);
}

export function computeFreshness(
  attributes: Record<string, unknown> | undefined,
  ranking: ResolvedRankingConfig,
  now: number | undefined,
): number | undefined {
  const cfg = ranking.freshness;
  if (!cfg || now === undefined) return undefined;
  const raw = readNumericAttribute(attributes, cfg.attribute);
  if (raw === undefined) return 0;
  const ts = cfg.unit === 's' ? raw * 1000 : raw;
  if (!Number.isFinite(ts)) return 0;
  const age = now - ts;
  // Future timestamps are treated as maximally fresh (age 0) for determinism.
  const effectiveAge = age < 0 ? 0 : age;
  const windowMs = cfg.unit === 's' ? cfg.window * 1000 : cfg.window;
  const halfLifeMs = cfg.unit === 's' ? cfg.halfLife * 1000 : cfg.halfLife;
  return decay(effectiveAge, windowMs, halfLifeMs);
}

export function buildPopularityScores(
  interactions: readonly ValidatedInteraction[] | undefined,
  types: readonly string[] | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (interactions === undefined) return counts;
  const typeSet = types ? new Set(types) : undefined;
  for (const interaction of interactions) {
    if (typeSet && !typeSet.has(interaction.type)) continue;
    const strength = interaction.value ?? 1;
    if (!Number.isFinite(strength) || strength <= 0) continue;
    counts.set(interaction.itemId, (counts.get(interaction.itemId) ?? 0) + strength);
  }
  return counts;
}

export function normalizeCountMap(counts: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const v of counts.values()) {
    if (v > max) max = v;
  }
  const out = new Map<string, number>();
  if (max <= 0) return out;
  for (const [k, v] of counts.entries()) {
    out.set(k, clamp01(v / max));
  }
  return out;
}

export function buildTrendingScores(
  interactions: readonly ValidatedInteraction[] | undefined,
  ranking: ResolvedRankingConfig,
  now: number | undefined,
): Map<string, number> {
  const cfg = ranking.trending;
  if (!cfg || interactions === undefined || now === undefined) return new Map<string, number>();
  const typeSet = cfg.types ? new Set(cfg.types) : undefined;
  const counts = new Map<string, number>();
  const start = now - cfg.windowMs;
  for (const interaction of interactions) {
    if (typeSet && !typeSet.has(interaction.type)) continue;
    const ts = interaction.timestamp;
    if (ts === undefined) continue;
    if (ts < start || ts > now) continue;
    const strength = interaction.value ?? 1;
    if (!Number.isFinite(strength) || strength <= 0) continue;
    const age = now - ts;
    const w =
      cfg.halfLifeMs > 0
        ? decay(age, cfg.windowMs, cfg.halfLifeMs)
        : clamp01(1 - age / cfg.windowMs);
    if (w <= 0) continue;
    counts.set(interaction.itemId, (counts.get(interaction.itemId) ?? 0) + strength * w);
  }
  return normalizeCountMap(counts);
}

export function getDiversityGroup(
  attributes: Record<string, unknown> | undefined,
  ranking: ResolvedRankingConfig,
): string | undefined {
  const cfg = ranking.diversity;
  if (!cfg) return undefined;
  return readStringAttribute(attributes, cfg.attribute);
}

export interface CombineAdvancedOptions {
  readonly baseScore: number;
  readonly baseComponents: readonly ScoreComponent[];
  readonly freshness?: number | undefined;
  readonly popularity?: number | undefined;
  readonly trending?: number | undefined;
  readonly ranking: ResolvedRankingConfig;
}

export function combineWithAdvancedFactors(opts: CombineAdvancedOptions): {
  readonly score: number;
  readonly components: readonly ScoreComponent[];
} {
  const parts: Array<{ factor: ScoreComponent['factor']; value: number; weight: number }> = [];
  // Treat existing base as one aggregate factor contribution input with weight 1
  // by reusing its total score as value, but preserve base components in output
  // by attaching them separately? Easier: include a 'base' aggregate? No, we must
  // keep explainable factors. Instead, add advanced factors on top with renormalization
  // over (baseWeight=1) + advanced weights, where base contributes baseScore.
  const baseWeight = 1;
  let totalWeight = baseWeight;
  if (opts.freshness !== undefined && opts.ranking.freshness) {
    parts.push({
      factor: 'freshness',
      value: clamp01(opts.freshness),
      weight: opts.ranking.freshness.weight,
    });
    totalWeight += opts.ranking.freshness.weight;
  }
  if (opts.popularity !== undefined && opts.ranking.popularity) {
    parts.push({
      factor: 'popularity',
      value: clamp01(opts.popularity),
      weight: opts.ranking.popularity.weight,
    });
    totalWeight += opts.ranking.popularity.weight;
  }
  if (opts.trending !== undefined && opts.ranking.trending) {
    parts.push({
      factor: 'trending',
      value: clamp01(opts.trending),
      weight: opts.ranking.trending.weight,
    });
    totalWeight += opts.ranking.trending.weight;
  }
  if (parts.length === 0 || totalWeight <= 0) {
    return { score: clamp01(opts.baseScore), components: opts.baseComponents };
  }
  let score = clamp01(opts.baseScore) * (baseWeight / totalWeight);
  const extra: ScoreComponent[] = [];
  for (const p of parts) {
    const contribution = p.value * (p.weight / totalWeight);
    score += contribution;
    extra.push(Object.freeze({ factor: p.factor, value: p.value, weight: p.weight, contribution }));
  }
  // Scale original base component contributions to reflect their share? They already sum to baseScore.
  // To keep explanations truthful, scale base contributions by baseWeight/totalWeight.
  const scale = baseWeight / totalWeight;
  const scaledBase = opts.baseComponents.map((c) =>
    Object.freeze({
      factor: c.factor,
      value: c.value,
      weight: c.weight,
      contribution: c.contribution * scale,
    }),
  );
  return {
    score: clamp01(score),
    components: Object.freeze([...scaledBase, ...extra]),
  };
}

/**
 * Deterministic diversity re-ranking (bounded). Applies a penalty for items whose
 * diversity group has already appeared >= maxPerGroup in the selected prefix,
 * adjusted by weight. Stable by original ranking order.
 */
export function applyDiversityRerank<T extends AdvancedScored>(
  ranked: readonly T[],
  ranking: ResolvedRankingConfig,
  limit: number,
): T[] {
  const cfg = ranking.diversity;
  if (!cfg || ranked.length <= 1 || limit <= 0) {
    return ranked.map((c) => ({ ...c }));
  }
  const remaining = ranked.map((c) => ({
    ...c,
    components: [...c.components],
  }));
  const selected: Array<T & { components: ScoreComponent[] }> = [];
  const groupCounts = new Map<string, number>();
  const max = Math.min(limit, remaining.length);
  const weightFactor = clamp01(cfg.weight / RERANK_WEIGHT_REF);

  for (let i = 0; i < max; i += 1) {
    let bestIndex = -1;
    let bestEffective = -Infinity;
    let bestOriginalScore = -Infinity;
    let bestSourceIndex = Infinity;
    let bestPenalty = 0;

    for (let j = 0; j < remaining.length; j += 1) {
      const c = remaining[j]!;
      const group = c.groupKey;
      const count = group ? (groupCounts.get(group) ?? 0) : 0;
      let effective = c.score;
      let penalty = 0;
      if (group && count >= cfg.maxPerGroup) {
        penalty = clamp01(weightFactor * (count - cfg.maxPerGroup + 1) * 0.5);
        effective = clamp01(c.score * (1 - penalty));
      }
      if (
        effective > bestEffective ||
        (effective === bestEffective && c.score > bestOriginalScore) ||
        (effective === bestEffective &&
          c.score === bestOriginalScore &&
          c.sourceIndex < bestSourceIndex)
      ) {
        bestEffective = effective;
        bestOriginalScore = c.score;
        bestSourceIndex = c.sourceIndex;
        bestIndex = j;
        bestPenalty = penalty;
      }
    }

    if (bestIndex < 0) break;
    const chosen = remaining.splice(bestIndex, 1)[0]!;
    const group = chosen.groupKey;
    const count = group ? (groupCounts.get(group) ?? 0) : 0;

    if (group && count >= cfg.maxPerGroup && bestPenalty > 0) {
      chosen.score = clamp01(bestEffective);
      chosen.components.push(
        Object.freeze({
          factor: 'diversity',
          value: clamp01(1 - bestPenalty),
          weight: cfg.weight,
          contribution: chosen.score - bestOriginalScore, // negative adjustment relative to pre-rerank score
        }),
      );
    }

    selected.push(chosen as T & { components: ScoreComponent[] });
    if (group) {
      groupCounts.set(group, count + 1);
    }
  }

  // Preserve frozen component arrays in output.
  return selected.map((c) => ({
    ...c,
    components: Object.freeze([...c.components]),
  })) as T[];
}

const RERANK_WEIGHT_REF = 10;

export function extractAttributesSnapshot(raw: unknown): Record<string, unknown> | undefined {
  // Retained for compatibility with earlier WIP usage; validation now snapshots
  // attributes directly when needed.
  if (!isPlainRecord(raw)) return undefined;
  try {
    const keys = ownStringKeys(raw);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      try {
        out[k] = readDataProperty(raw, k) as AttributeValue;
      } catch {
        // ignore unsafe fields; attributes were already validated
      }
    }
    return out;
  } catch {
    return undefined;
  }
}
