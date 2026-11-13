/**
 * Forward-looking personalization contracts.
 *
 * These types are exported so later phases can add capabilities without
 * redefining the domain model. The Phase 1 request does not accept or use them.
 */

import type { AttributeValue } from './content.js';

/**
 * Content signals that explicit preferences can match.
 *
 * These are ordinary content metadata labels, not learned interests and not
 * interaction history. Applications map their data into these kinds through
 * content attributes or the configured attribute mapping.
 */
export type PreferenceKind = 'category' | 'tag' | 'topic' | 'keyword' | 'contentType';

export interface ContentPreference {
  readonly kind: PreferenceKind;
  /** Explicit label. Trimmed, NFC-normalized, and case-folded by default. */
  readonly value: string;
  /** Finite positive weight; defaults to `1`. */
  readonly weight?: number;
}

/**
 * Per-request explicit preferences.
 *
 * This is supplied by the integrating application for one call. Recomet does
 * not persist it, associate it with an account, or learn from interactions.
 */
export interface RecommendationPreferences {
  readonly interests: readonly ContentPreference[];
}

export interface UserReference {
  readonly userId: string;
}

export interface Interest {
  readonly key: string;
  /** Finite weight; the consuming capability normalizes it. */
  readonly weight: number;
}

export interface UserProfile extends UserReference {
  readonly interests?: readonly Interest[];
}

/**
 * Interaction record supplied explicitly by the integrating application.
 *
 * Phase 3 accepts the collaborative subset of this shape (`userId`, `itemId`,
 * `type`, optional finite `value`) in recommendation requests. `timestamp` and
 * `metadata` remain forward-looking and are not used for collaborative scoring
 * in this phase.
 */
export interface Interaction {
  readonly userId: string;
  readonly itemId: string;
  /** App-defined interaction type, for example "view", "like", or "save". */
  readonly type: string;
  /** Finite, app-defined value such as seconds watched. */
  readonly value?: number;
  /** Unix epoch milliseconds, UTC. */
  readonly timestamp?: number;
  readonly metadata?: Readonly<Record<string, AttributeValue>>;
}

/**
 * Phase 3 collaborative interaction input.
 *
 * The integrating application controls event types and any `value` semantics.
 * Recomet validates records but does not assign universal meanings to
 * application-specific events. Records are processed only for the current call
 * and are not retained.
 *
 * Phase 3: `value`, when provided, must be a finite, non-negative number.
 * Negative values (dislike/negative-feedback semantics) are unsupported in
 * Phase 3 and are rejected during validation. If `value` is absent, Recomet
 * uses `interactionTypes[type]` when configured, otherwise the default strength
 * `1`.
 */
export interface CollaborativeInteraction {
  readonly userId: string;
  readonly itemId: string;
  /** Application-defined event type (for example `view`, `like`, `save`, `share`, `skip`, `rating`). */
  readonly type: string;
  /** Optional finite, non-negative numeric value/rating supplied by the application. */
  readonly value?: number;
}
