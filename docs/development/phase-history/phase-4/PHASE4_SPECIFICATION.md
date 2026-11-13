# Phase 4 Specification — Hybrid Recommendation Engine (Planning, Decisions Resolved)

**Project:** Recomet (`@recomet/core`)  
**Repository:** `F:\Recomet`  
**Status:** **Design decisions resolved (2026-11-07). Planning complete; not implemented, not started.**  
**Foundation:** Phase 1, Phase 2, and Phase 3 are accepted (Phase 3 accepted 2026-11-07; see `PHASE3_ACCEPTANCE.md`).  
**Authorization:** Phase 4 implementation requires **separate explicit maintainer authorization** after maintainer approval of this finalized design.

## 1. Objective

Define a technically sound, security-conscious, privacy-preserving Phase 4 hybrid recommendation capability that combines existing local capabilities:

1. **Baseline** — neutral deterministic ordering/fallback.
2. **Content-based** — explicit per-request preference relevance over mapped item attributes (Phase 2 semantics).
3. **Collaborative** — neighborhood-based filtering from explicitly supplied interaction data, bounded by the request-scoped similarity-evaluation budget (Phase 3 semantics).

Hybrid processing remains a direct-library, local/in-memory, zero-runtime-dependency capability: no hosted service, no mandatory backend/database/cloud, no runtime network/telemetry/analytics/tracking, no external AI APIs/mandatory ML models, no hidden persistence/retention, no maintainer access, no cross-application sharing, no mutation/retention of caller-owned inputs, no module-global mutable request state, and no exposure of raw user IDs, interaction records, preference labels/values, or sensitive input data.

## 2. Approved maintainer decisions (2026-11-07)

| # | Decision | Approved resolution |
|---|---|---|
| 1 | `auto` strategy | **Preserve existing `auto` behavior exactly.** `auto` must not automatically select hybrid when both content and collaborative signals are available. `hybrid` is an explicit strategy only. |
| 2 | Hybrid fallback | **Availability-aware fusion.** Use a valid signal without treating missing evidence as zero. If neither signal is available, use baseline. Report the actual strategy and applied factors truthfully. |
| 3 | Explanation schema | Add a clear hybrid representation of content and collaborative contributions. **Do not expose** raw preference labels/values, user IDs, interaction records, or sensitive input data. |
| 4 | Eligible universe | Include **all eligible request items**, including items with content evidence but no collaborative evidence. Preserve existing exclusions and previously interacted-item behavior. Avoid unnecessary duplicate candidate collections. |
| 5 | Weights | Defaults: `contentWeight = 1`, `collaborativeWeight = 1`. Weights must be finite, non-negative, and bounded. Both zero is invalid. Zero disables the corresponding component. Reasonable hard limits must be recommended/documented before implementation (see §6.3). |
| 6 | Public type compatibility | Add `hybrid` as an explicit strategy. Review `StrategyId`, configuration types, score factors, and result contracts. Document potential exhaustive-switch TypeScript compatibility implications. Do not silently change existing strategy behavior. |
| 7 | Support-aware weighting | **Deferred.** Do not introduce an invented confidence formula or additional support-based weighting in essential Phase 4 scope. |

## 3. Essential scope

### In scope (authorized design for future implementation only)
- Explicit `hybrid` strategy with availability-aware weighted fusion.
- Hybrid config validation (weights, bounds, defaults).
- All eligible request items ranked in the hybrid universe; exclusions and previously interacted-item behavior preserved.
- Truthful actual strategy/reporting and safe hybrid explanation components.
- Reuse of the existing request-scoped `maxCollaborativeSimilarityEvaluations` budget (no reset/replenish).
- Regression preservation for `baseline`, `content`, `collaborative`, and `auto`.
- Tests/benchmarks as defined in acceptance criteria (not implemented in this planning task).

### Deferred / out of scope
- Support-aware/confidence weighting, invented confidence formulas, statistical calibration, external ML/services, persistence, learned profiles, automatic interaction collection, cross-application data, popularity/trending/freshness/diversity re-ranking, `auto` selecting hybrid.

## 4. Mathematical definition (availability-aware weighted fusion)

### 4.1 Score ranges
- `S_c(i)`, `S_f(i)`, and `S_h(i)` are in the inclusive range `[0,1]` when defined/used.
- Final `S_h(i)` is clamped to `[0,1]` for floating-point safety: `S_h(i)=min(1,max(0,S_h_raw(i)))` when finite.
- Any non-finite intermediate/final value is not emitted as a valid score; handle via existing safe internal-error discipline.

### 4.2 Component definitions
- **Content component `S_c(i)`:** the Phase 2 content relevance score for eligible item `i`, computed only when content is available for the request (usable explicit preferences exist per existing rules). `S_c(i)` may be `0` for a non-matching item; that is a valid computed content evaluation, not missing collaborative evidence.
- **Collaborative component `S_f(i)`:** the Phase 3 collaborative score for eligible item `i` **only when valid collaborative evidence exists for `i`**. Valid collaborative evidence means the collaborative path (under existing Phase 3 semantics: interaction context/model, exclusions, target-user previously interacted-item exclusion, neighborhood/similarity rules, positive/useful evidence as currently defined) produces an actual score/evidence for `i`. If no valid collaborative evidence exists for `i`, `S_f(i)` is **not** synthesized as `0`; instead the collaborative component is unavailable for `i` (`A_f(i)=0`).

### 4.3 Availability
- **Request-level content availability `A_c`:** `1` if usable explicit preferences are present and the content path is available for the hybrid request under existing validation semantics; else `0`. For hybrid scoring, use `A_c(i)=A_c` for eligible items when content is evaluated.
- **Item-level collaborative availability `A_f(i)`:** `1` if collaborative context is usable for the request **and** valid collaborative evidence exists for item `i`; else `0`. Collaborative context unusable => `A_f(i)=0` for all `i`. Budget exhaustion may result in `A_f(i)=0` for some/all items (deterministically, per Phase 3 behavior).
- **Component active for item `i`:** content active iff `A_c(i)=1`; collaborative active iff `A_f(i)=1`.

### 4.4 Weights
- `w_c = contentWeight`, `w_f = collaborativeWeight`.
- Defaults: `w_c=1`, `w_f=1`.
- Validation: each weight must be a finite, non-negative number within the documented bound (see §6.3). NaN, Infinity, negative, non-number, or out-of-bounds values are invalid (`INVALID_CONFIG` or the project’s config-error category; exact code/message finalized at implementation).
- `w_c=0` disables the content component. `w_f=0` disables the collaborative component.
- `w_c=0 && w_f=0` is **invalid**.

### 4.5 Fusion formula
For each eligible item `i`:

```text
w'_c(i) = A_c(i) * w_c
w'_f(i) = A_f(i) * w_f
D(i)    = w'_c(i) + w'_f(i)

if D(i) > 0:
  S_h(i) = (w'_c(i) * S_c(i) + w'_f(i) * S_f(i)) / D(i)
else:
  no fused hybrid score from content/collaborative components for item i (see §4.6)
```

**Division-by-zero safety:** division occurs only when `D(i)>0`. `D(i)=0` branches to non-fusion handling. Global config `w_c=w_f=0` is rejected at validation, but runtime guards must still be defensive (no division by zero).

### 4.6 Missing-signal / neither-signal behavior
- **Content available, collaborative missing for item:** `A_f(i)=0`, `D(i)=w_c*A_c(i)`. If `w_c>0`, item is scored from content only: `S_h(i)=S_c(i)`.
- **Collaborative available for item, content unavailable:** `A_c(i)=0`, item scored from collaborative only: `S_h(i)=S_f(i)` when `w_f>0`.
- **Both active:** weighted fusion over actual `S_c(i)` and actual `S_f(i)`.
- **Neither signal available for the request:** no usable content preferences and no usable collaborative context (`A_c=0` and no collaborative path producing usable request-level collaborative context) => return **baseline** result. Report actual strategy truthfully (baseline/fallback), never as fused hybrid.
- **Request has signal context but no active fused components after evaluation (edge case):** handle deterministically and truthfully; prefer baseline fallback for affected ranking unless a more specific truthful strategy is defined and approved. Do not label as hybrid fusion when no hybrid components were applied.

### 4.7 Deterministic ranking
- Same inputs + same config => same output.
- Rank eligible items by `S_h(i)` descending (after fusion/fallback scoring rules are applied), with existing deterministic tie-break behavior (confirm exact current rule at implementation: score desc, then stable source/input order and/or item ID as currently defined). No randomness, wall-clock, locale, or environment dependence.
- Existing exclusions and previously interacted-item behavior are preserved before/through candidate eligibility as currently defined.

## 5. Result strategy reporting and explanation

### 5.1 Truthful strategy reporting
- Public result `strategy` and explanation strategy/summary must identify the **actual** strategy/factors applied.
- Never report fused hybrid when no content/collaborative fusion was applied.
- Explicit `hybrid` requests: report hybrid when hybrid fusion logic is the selected/applicable strategy and components are applied as defined; if the request falls back to baseline because neither signal is available, report the actual fallback strategy truthfully (implementation must choose clear, documented labels consistent with existing API patterns).

### 5.2 Explanation schema (safe)
- Add a clear hybrid representation of content and collaborative contributions (e.g., factors/components indicating content contribution and collaborative contribution, with safe values/weights/contributions). Exact field names/types are implementation details subject to public-contract review.
- Contributions/weights must be explainable as safe aggregates (global hybrid weights and/or normalized contributions) without exposing private inputs.
- **Forbidden in outputs/errors/explanations/metadata:** raw preference labels/values, user IDs, interaction records, mapped sensitive content payloads, or other sensitive input data.

### 5.3 Score factors/types compatibility
- Review and update `StrategyId`, configuration types, score factors, and result contracts as needed. Adding `hybrid` is explicit and additive but may affect exhaustive TypeScript switches; document compatibility implications.

## 6. Configuration (proposed)

```ts
// Illustrative; final names/types reviewed before implementation.
strategy: 'baseline' | 'content' | 'collaborative' | 'auto' | 'hybrid'

hybrid?: {
  weights?: {
    content?: number;       // default 1, finite, >= 0, <= HYBRID_WEIGHT_MAX
    collaborative?: number; // default 1, finite, >= 0, <= HYBRID_WEIGHT_MAX
  };
}
```

### 6.1 Defaults
- `hybrid.weights.content = 1`
- `hybrid.weights.collaborative = 1`

### 6.2 Validation rules
- Plain-object/allowlisted config validation (existing style).
- Weights finite, non-negative, `<= HYBRID_WEIGHT_MAX`.
- Reject both-zero after defaults/resolution (`w_c=0 && w_f=0` invalid).
- Zero disables the corresponding component.

### 6.3 Recommended hard limit (before implementation)
- Recommend `HYBRID_WEIGHT_MAX = 1000` (consistent in magnitude with existing bounded weight patterns such as interaction type weights; final value confirmed during implementation/config review). Document the chosen bound and rationale in config validation, contracts, and docs.

## 7. Resource limits and performance

- Reuse the **existing request-scoped collaborative similarity-evaluation budget** (`maxCollaborativeSimilarityEvaluations`). One budget per request path that uses collaborative similarity; pass through all collaborative work in hybrid. **Never reset or replenish.**
- Respect existing limits: `maxItems`, `maxExcludeItemIds`, `maxLimit`, preference limits, ID/attribute limits, `maxInteractions`, `maxInteractionType*`, `maxCollaborativeNeighbors`, etc.
- Avoid unnecessary duplicate candidate collections/computation. All eligible request items are considered; implementation should minimize redundant passes while preserving determinism and clarity.
- **Do not claim** the similarity budget bounds all CPU/memory. Distinguish similarity-evaluation bounds, candidate/item/interaction limits, sorting/scoring CPU costs, and memory costs.

## 8. Numerical golden examples (every signal-availability combination)

Assume `w_c=1`, `w_f=1` unless stated.

| Case | Availability | Inputs | Calculation | `S_h(i)` | Notes |
|---|---|---|---|---:|---|
| G1 Both active | `A_c=1,A_f(i)=1` | `S_c=0.80,S_f=0.50` | `(1*0.8 + 1*0.5)/(1+1)=1.3/2` | `0.65` | Weighted fusion of actual components. |
| G2 Content only (CF missing for item) | `A_c=1,A_f(i)=0` | `S_c=0.80`, no CF evidence | `(1*0.8)/(1)=0.8` | `0.80` | Missing CF evidence is **not** treated as `S_f=0`. |
| G3 Collaborative only (no content) | `A_c=0,A_f(i)=1` | no usable prefs, `S_f=0.50` | `(1*0.5)/(1)=0.5` | `0.50` | Content unavailable. |
| G4 Neither (request-level) | `A_c=0`, no usable CF context | n/a | fallback | baseline path | Actual strategy reported truthfully; not fused hybrid. |
| G5 Both active, custom weights | `A_c=1,A_f(i)=1` | `S_c=0.80,S_f=0.50,w_c=0.6,w_f=0.4` | `(0.48+0.20)/1.0` | `0.68` | Valid bounded weights. |
| G6 Content disabled by zero weight | `A_c=1,A_f(i)=1` | `S_c=0.80,S_f=0.50,w_c=0,w_f=1` | `(0+0.5)/1` | `0.50` | Zero disables component. |
| G7 CF disabled by zero weight | `A_c=1,A_f(i)=1` | `S_c=0.80,S_f=0.50,w_c=1,w_f=0` | `(0.8+0)/1` | `0.80` | Zero disables component. |
| G8 Content 0 is valid (not missing) | `A_c=1,A_f(i)=0` | `S_c=0.00` (no match) | `(1*0)/(1)` | `0.00` | Valid Phase 2 evaluation result; CF still missing/unavailable. |
| G9 Both-zero weights (invalid) | config | `w_c=0,w_f=0` | validation rejects | `INVALID_CONFIG` | No division; no fusion. |
| G10 CF context usable, item has no evidence | request CF usable, item `A_f(i)=0` | `A_c=1,S_c=0.60` | `(1*0.6)/(1)` | `0.60` | Budget/exhaustion/no-positive-evidence can yield `A_f(i)=0` for item. |

## 9. Compatibility and regression

- `baseline`, `content`, `collaborative`, `auto` behavior preserved (Decision 1: `auto` exact).
- `hybrid` is explicit opt-in strategy.
- Potential TypeScript exhaustive-switch impact from `StrategyId`/factor/contract additions must be documented.
- No runtime dependency additions; ESM/Node/browser portability preserved.

## 10. Future enhancements (deferred)
- Support-aware/confidence weighting (Decision 7).
- `auto` hybrid selection/opt-in mode.
- Statistical calibration.
- Additional hybrid diagnostics/metadata (privacy-reviewed, additive).
- Hybrid personalization `R23` and broader Phase 4+ roadmap items outside essential fusion scope.

## 11. Implementation gate
This document finalizes planning decisions. **No source code or tests are implemented.** Phase 4 implementation requires separate explicit maintainer authorization.
