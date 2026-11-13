# Phase 4 Design Approval

**Project:** Recomet  
**Phase:** 4 — Hybrid Recommendation Engine  
**Decision:** **Design approved; implementation authorized** (within documented boundaries)  
**Maintainer authorization date:** 2026-11-07  
**Scope:** Phase 4 only. Phase 5 not started. Phase 4 implementation completion does **not** constitute formal Phase 4 acceptance (separate maintainer review/acceptance required after implementation evidence and independent audit).

## Authoritative planning documents (verified)

- `PHASE4_SPECIFICATION.md` (decisions resolved 2026-11-07)
- `PHASE4_ARCHITECTURE.md`
- `PHASE4_ACCEPTANCE_CRITERIA.md`
- `PHASE4_RISK_REGISTER.md`
- `ROADMAP.md` (Phase 4 planning finalized)

## Approved decisions (binding for implementation)

1. **Strategy selection:** Add explicit `hybrid`. Preserve existing `auto` behavior exactly. Never silently select hybrid through `auto`. Existing baseline/content/collaborative/auto behavior remains compatible.
2. **Availability-aware weighted fusion:** `S_h(i)=(w_c*A_c(i)*S_c(i)+w_f*A_f(i)*S_f(i))/(w_c*A_c(i)+w_f*A_f(i))` when `D(i)>0`; safe fallback when `D(i)=0`. Missing collaborative evidence is not fabricated as zero. Only one signal => use that signal. Neither => documented baseline fallback. Report actual strategy/factors truthfully.
3. **Hybrid explanations:** Safe, deterministic; no raw preference labels/values, user IDs, interaction records, or internal sensitive request data. Finalize exact public explanation field names during contract review.
4. **Candidate universe:** Rank all eligible request items, including content evidence without collaborative evidence. Preserve exclusions and previously interacted-item behavior. Avoid unnecessary duplicate collections/repeated processing.
5. **Weights:** defaults `contentWeight=1`, `collaborativeWeight=1`; finite, non-negative, bounded. Both zero => `INVALID_CONFIG`. Zero disables component. `HYBRID_WEIGHT_MAX=1000` unless concrete correctness/compatibility issue requires documented deviation.
6. **Public contracts:** Review/update `StrategyId`, config types/defaults, validation/errors, result strategy/score-factor types, explanations. Document exhaustive-switch TS compatibility implications. No silent behavior/semantic changes to existing strategies.
7. **Support-aware weighting:** Deferred (no invented confidence/calibration/support weighting in Phase 4).

## Mandatory constraints

- Local-first, in-memory; no runtime network/telemetry/analytics; no external AI/models; no mandatory cloud/backend/database/account; no hidden persistence/retention; no maintainer/cross-application data access/sharing; no new runtime dependencies.
- Strict validation, safe object inspection, no raw sensitive data in results/explanations/errors/logs. No false sandbox/isolation claims.
- Reuse existing request-scoped collaborative similarity-evaluation budget; never reset/replenish. Budget limits actual similarity evaluations, not all CPU/memory.
- Preserve all existing work (including modified/untracked files). No destructive git. No commits/push/tags/publish. No dependency/lockfile changes unless demonstrably necessary and explicitly justified.

## Implementation authorization

Implementation is authorized to proceed per `PHASE4_SPECIFICATION.md`, `PHASE4_ARCHITECTURE.md`, and `PHASE4_ACCEPTANCE_CRITERIA.md`, including contract review, config/validation, fusion, pipeline integration, safe explanations, comprehensive tests (including G1–G10), docs, full verification, and independent audit. Stop before Phase 5.
