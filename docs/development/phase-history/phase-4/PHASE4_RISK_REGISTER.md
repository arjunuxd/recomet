# Phase 4 Risk Register — Hybrid Recommendation Engine (Planning, Decisions Resolved)

**Status:** **Design decisions resolved (2026-11-07). Planning only.** Re-evaluate during implementation/review.

## Resolved decisions (carried into controls)

1. `auto` unchanged; `hybrid` explicit.
2. Availability-aware fusion; missing CF evidence not zero; neither => baseline; truthful reporting.
3. Safe hybrid explanation schema (no raw labels/values/user IDs/interactions/sensitive input).
4. All eligible items in hybrid universe; exclusions/previously-interacted preserved; avoid duplicate collections.
5. Weights default 1/1, finite/non-negative/bounded, both-zero invalid, zero disables; hard limit recommended/documented before implementation.
6. Explicit `hybrid` type/contract additions reviewed; exhaustive-switch TS impact documented; no silent behavior changes.
7. Support-aware weighting deferred.

## Risk register

| ID | Category | Risk | Impact | Likelihood | Mitigation / control | Status |
|---|---|---|---|---|---|---|
| R4-01 | Compatibility | TS exhaustive-switch/contract impact from `hybrid` additions. | Medium | Medium | Explicit additive changes + migration/compat docs; keep existing strategy behavior unchanged. | Open (implementation control) |
| R4-02 | Correctness | Content/CF semantics/distributions treated as calibrated. | Medium | Medium | Document limitation; transparent fusion only; golden vectors. | Open |
| R4-03 | Correctness | Missing CF evidence synthesized as zero or fabricated. | High | Low if controlled | Decision 2: `A_f(i)` requires valid actual evidence; never synthesize `S_f=0` for missing evidence. Tests. | Open |
| R4-04 | Correctness | Similarity budget reset/replenished/duplicated in hybrid. | High | Low/Medium | Single request-scoped budget reused; count actual `computeSimilarity` invocations. | Open |
| R4-05 | Performance | Redundant content/CF/candidate collection passes. | Medium | Medium | Decision 4: merged/efficient eligible-universe handling; benchmarks. | Open |
| R4-06 | Performance | Per-item fusion over large eligible sets increases CPU/memory. | Medium | Medium | Respect limits; efficient structures; document costs separate from similarity budget. | Open |
| R4-07 | Privacy | Explanations/results/errors leak sensitive inputs. | High | Low/Medium | Decision 3 schema + leakage tests + review. | Open |
| R4-08 | Security | Hostile config/input or weight bounds bypass. | High | Low/Medium | Allowlisted plain-object validation; finite/non-negative/bounded/max; both-zero reject. | Open |
| R4-09 | Security | Caller-input mutation/retention. | High | Low | Request-scoped copies only as needed; no mutation; mutation tests. | Open |
| R4-10 | Correctness | Truthful strategy/fallback mislabeling. | Medium/High | Medium | Decision 2 labeling rules; tests for every availability path. | Open |
| R4-11 | Correctness | Division by zero or non-finite scores. | High | Low | Reject both-zero config; denominator guard `D(i)>0`; finite checks/clamp. | Open |
| R4-12 | Determinism | Tie/order nondeterminism. | Medium | Low | Preserve existing deterministic ranking/tie-breaks; repeat/equal-score tests. | Open |
| R4-13 | Scope | Support-aware weighting or out-of-scope features creep in. | Medium | Low | Decision 7 + scope gate. | Open |
| R4-14 | Claims | Similarity budget described as bounding all CPU/memory. | Medium | Medium | Explicit docs/acceptance checks. | Open |

## Remaining genuine blockers to implementation start
- **None for design closure** given approved decisions above. Implementation remains blocked until **separate explicit maintainer authorization** is granted after review/approval of this finalized design. Final implementation-time choices still required but non-blocking to design: exact public schema field names for hybrid explanation components, exact truthful fallback `strategy` label for the neither-signal explicit-hybrid case (must follow existing API patterns), and the final `HYBRID_WEIGHT_MAX` value (recommended 1000).
