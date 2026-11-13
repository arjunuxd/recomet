import type { ContentItem } from './content.js';
import type { CollaborativeInteraction, RecommendationPreferences } from './personalization.js';

/**
 * Recommendation request.
 *
 * Unknown keys are rejected. `preferences` is optional and used by content
 * and hybrid scoring. `interactions` and `userId` are optional and used by
 * collaborative, hybrid, trending, discovery, and popularity-related ranking;
 * interaction records are processed for this call and are not retained.
 *
 * `now` is an optional injectable reference time (Unix epoch milliseconds, UTC)
 * for deterministic time-dependent behavior (freshness, trending/discovery
 * windows). Recomet does not read wall-clock time.
 *
 * No persistent account, learned profile, or automatic interaction collection
 * is accepted.
 */
export interface RecommendationRequest {
  readonly items: readonly ContentItem[];
  readonly limit?: number;
  readonly excludeItemIds?: readonly string[];
  readonly preferences?: RecommendationPreferences;
  /** Target user ID for collaborative recommendations. */
  readonly userId?: string;
  /** Interaction records explicitly supplied by the integrating application. */
  readonly interactions?: readonly CollaborativeInteraction[];
  /**
   * Injectable reference timestamp in Unix epoch milliseconds (UTC).
   * Required for time-window features when configured; must be a finite
   * non-negative safe integer when provided.
   */
  readonly now?: number;
}
