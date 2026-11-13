import type { ResolvedEngineLimits } from '../internal/limits.js';
import type { ResolvedCollaborativeConfig } from '../validation/config.js';

export interface ValidatedInteraction {
  readonly userId: string;
  readonly itemId: string;
  readonly type: string;
  readonly value: number | undefined;
  readonly timestamp?: number | undefined;
}

export interface InteractionModel {
  readonly userItems: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly itemUsers: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly maxAbsStrength: number;
  readonly interactionCount: number;
}

function effectiveStrength(
  interaction: ValidatedInteraction,
  config: ResolvedCollaborativeConfig,
): number {
  if (interaction.value !== undefined) {
    return interaction.value;
  }
  const configured = config.interactionTypes[interaction.type];
  return configured ?? 1;
}

function addStrength(
  map: Map<string, Map<string, number>>,
  outer: string,
  inner: string,
  value: number,
): void {
  let innerMap = map.get(outer);
  if (innerMap === undefined) {
    innerMap = new Map<string, number>();
    map.set(outer, innerMap);
  }
  innerMap.set(inner, (innerMap.get(inner) ?? 0) + value);
}

function freezeNested(
  map: Map<string, Map<string, number>>,
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const frozen = new Map<string, ReadonlyMap<string, number>>();
  for (const [key, inner] of map.entries()) {
    frozen.set(key, inner);
  }
  return frozen;
}

/**
 * Builds bounded in-memory interaction indexes for the current request.
 *
 * Duplicate (user,item) interactions are aggregated by summing effective
 * strengths deterministically. The model is not retained after the call.
 */
export function buildInteractionModel(
  interactions: readonly ValidatedInteraction[],
  config: ResolvedCollaborativeConfig,
  _limits: ResolvedEngineLimits,
): InteractionModel {
  const userItems = new Map<string, Map<string, number>>();
  const itemUsers = new Map<string, Map<string, number>>();
  let maxAbsStrength = 1;

  for (const interaction of interactions) {
    const strength = effectiveStrength(interaction, config);
    if (!Number.isFinite(strength)) {
      continue;
    }
    addStrength(userItems, interaction.userId, interaction.itemId, strength);
    addStrength(itemUsers, interaction.itemId, interaction.userId, strength);
    const abs = Math.abs(strength);
    // Normalization denominator floor is 1 (Decision A / F-02): strengths with
    // absolute value <= 1 retain magnitude; when observed max abs > 1, normalize
    // relative to that maximum. Never rescale all-below-1 datasets to max=1.
    if (abs > maxAbsStrength) {
      maxAbsStrength = abs;
    }
  }

  return {
    userItems: freezeNested(userItems),
    itemUsers: freezeNested(itemUsers),
    maxAbsStrength: maxAbsStrength > 0 ? maxAbsStrength : 1,
    interactionCount: interactions.length,
  };
}

export function normalizedStrength(strength: number, maxAbsStrength: number): number {
  const denom = maxAbsStrength > 0 ? maxAbsStrength : 1;
  const value = strength / denom;
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
