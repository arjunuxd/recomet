# Phase 4 Acceptance Criteria — Hybrid Recommendation Engine (Planning, Decisions Resolved)

**Status:** **Design decisions resolved (2026-11-07). Planning only.** Applies only if/when Phase 4 implementation is separately authorized.

## 1. Decisions implemented as approved
- [ ] `auto` behavior preserved **exactly**; `auto` never selects hybrid automatically. `hybrid` is explicit only.
- [ ] Availability-aware fusion implemented: missing collaborative evidence is not treated as zero; neither-signal case falls back to baseline; actual strategy/factors reported truthfully.
- [ ] Hybrid explanations clearly represent content and collaborative contributions; **no** raw preference labels/values, user IDs, interaction records, or sensitive input data.
- [ ] All eligible request items are included in the hybrid ranking universe (including content-only items without CF evidence). Existing exclusions and previously interacted-item behavior preserved. No unnecessary duplicate candidate collections.
- [ ] Defaults `contentWeight=1`, `collaborativeWeight=1`. Weights finite, non-negative, bounded; both-zero invalid; zero disables corresponding component. Hard limit documented/implemented as approved.
- [ ] `hybrid` added explicitly; `StrategyId`/config/score-factor/result contracts reviewed and compatibility implications documented. No silent existing-strategy behavior changes.
- [ ] Support-aware weighting/confidence formula **not** added (deferred).

## 2. Mathematical correctness
- [ ] Implements: `S_h(i)=(w_c*A_c(i)*S_c(i)+w_f*A_f(i)*S_f(i))/(w_c*A_c(i)+w_f*A_f(i))` when denominator `>0`; safe non-fusion/fallback when `0`.
- [ ] `A_c`, `A_f(i)`, valid collaborative evidence, zero-weight, missing-signal, neither-signal fallback, strategy reporting, explanation contributions, score range `[0,1]`, and deterministic ranking defined and implemented as specified.
- [ ] **No division by zero** possible (validation + runtime guards).
- [ ] Golden-vector tests cover every signal-availability combination (both active; content-only/item CF missing; CF-only/content unavailable; neither request-level fallback; custom weights; zero disables; content `S_c=0` valid; both-zero invalid config; CF usable but item has no evidence) plus clamping/non-finite guards.

## 3. Truthfulness and determinism
- [ ] Actual strategy/factors applied are reported truthfully; no mislabeled fallback/fusion.
- [ ] Identical inputs/config produce identical outputs; deterministic tie-breaking preserved/documented.
- [ ] Cold-start/insufficient evidence/budget exhaustion handled deterministically and safely.

## 4. Budget and performance
- [ ] Single request-scoped `maxCollaborativeSimilarityEvaluations` budget reused across all hybrid collaborative similarity work; never reset/replenished. Actual `computeSimilarity` invocations counted/bounded.
- [ ] Existing limits respected. No unnecessary duplicate candidate collections/computation.
- [ ] Claims/docs distinguish similarity-evaluation bounds from candidate/item limits, sorting/scoring CPU, and memory. No claim similarity budget bounds all CPU/memory.
- [ ] Synthetic benchmarks recorded per policy; no accepted benchmark records overwritten without approval.

## 5. Privacy and security
- [ ] Local-only, zero runtime deps, no network/telemetry/analytics/tracking/external AI/hidden persistence/maintainer access/cross-application sharing.
- [ ] No mutation/retention of caller-owned inputs; no module-global mutable request state.
- [ ] No raw preference labels/values, user IDs, interaction records, or sensitive input data in outputs/errors/explanations/metadata.
- [ ] Hostile/invalid config/input handled with safe, value-free errors; bounds prevent resource abuse consistent with existing model.

## 6. Compatibility and regression
- [ ] `baseline`, `content`, `collaborative`, `auto` pass existing relevant tests with unchanged intended behavior.
- [ ] Public type/contract changes documented with migration/compatibility notes (including exhaustive-switch implications).

## 7. Verification and docs
- [ ] Unit, integration, regression, privacy/leakage, mutation, determinism, and budget tests pass. Required project commands pass (`typecheck`, `lint`, `format:check`, `test`, `build`) as applicable.
- [ ] README/SPECIFICATION/ARCHITECTURE/SECURITY/PRIVACY/ROADMAP updated to actual behavior; no overclaims.
- [ ] Maintainer gives separate explicit implementation authorization before coding and separate explicit acceptance after evidence.
