import type { ResolvedCollaborativeConfig } from '../validation/config.js';
import { normalizedStrength } from './model.js';

export interface SimilarityResult {
  readonly id: string;
  readonly similarity: number;
  readonly overlap: number;
}

function clampSimilarity(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  if (value < -1) {
    return -1;
  }
  return value;
}

export function cosineSimilarity(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  maxAbsStrength: number,
  config: ResolvedCollaborativeConfig,
): SimilarityResult | undefined {
  let overlap = 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [key, av] of a.entries()) {
    const na = normalizedStrength(av, maxAbsStrength);
    normA += na * na;
    const bv = b.get(key);
    if (bv !== undefined) {
      overlap += 1;
      const nb = normalizedStrength(bv, maxAbsStrength);
      dot += na * nb;
    }
  }
  for (const bv of b.values()) {
    const nb = normalizedStrength(bv, maxAbsStrength);
    normB += nb * nb;
  }

  if (overlap < config.minOverlap) {
    return undefined;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 0 || !Number.isFinite(denom)) {
    return undefined;
  }
  return { id: '', similarity: clampSimilarity(dot / denom), overlap };
}

export function jaccardSimilarity(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  config: ResolvedCollaborativeConfig,
): SimilarityResult | undefined {
  let intersection = 0;
  for (const key of a.keys()) {
    if (b.has(key)) {
      intersection += 1;
    }
  }
  if (intersection < config.minOverlap) {
    return undefined;
  }
  const union = a.size + b.size - intersection;
  if (union <= 0) {
    return undefined;
  }
  return { id: '', similarity: clampSimilarity(intersection / union), overlap: intersection };
}

export function computeSimilarity(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  maxAbsStrength: number,
  config: ResolvedCollaborativeConfig,
): SimilarityResult | undefined {
  return config.similarity === 'jaccard'
    ? jaccardSimilarity(a, b, config)
    : cosineSimilarity(a, b, maxAbsStrength, config);
}
