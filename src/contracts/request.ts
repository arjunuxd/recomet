import type { ContentItem } from './content.js';
import type { CollaborativeInteraction, RecommendationPreferences } from './personalization.js';

/**
 * Recommendation request.
 *
 * Unknown keys are rejected. `preferences` is optional and used by content
 * and hybrid scoring. `interactions` and `userId` are optional and used by
 * collaborative and hybrid strategies; interaction records are processed for
 * this call and are not retained. No persistent account, learned profile, or
 * automatic interaction collection is accepted.
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
}
