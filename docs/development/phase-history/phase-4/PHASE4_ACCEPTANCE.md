# PHASE4_ACCEPTANCE

**Project:** Recomet (`@recomet/core`)  
**Phase:** 4 — Hybrid Recommendation (explicit `hybrid` strategy; availability-aware weighted fusion)  
**Decision:** **FORMALLY ACCEPTED by the maintainer** (subject to documented limitations below)  
**Maintainer decision date:** 2026-11-07  
**Scope of acceptance:** Phase 4 implemented/authorized subset as evidenced. **Hybrid personalization (`R23`) remains deferred** unless separately approved. Phase 5 is **not** started and requires separate maintainer authorization.

## Evidence reviewed

- `PHASE4_DESIGN_APPROVAL.md`
- `PHASE4_SPECIFICATION.md`
- `PHASE4_ARCHITECTURE.md`
- `PHASE4_ACCEPTANCE_CRITERIA.md`
- `PHASE4_IMPLEMENTATION_AUDIT.md`
- `PHASE4_FINAL_ACCEPTANCE_AUDIT.md` (independent audit §§1–17 + remediation §18, 2026-11-07)
- `PHASE4_ACCEPTANCE_REVIEW.md`

## Acceptance evidence

- Independent audit verdict: **APPROVE WITH CONDITIONS** (`PHASE4_FINAL_ACCEPTANCE_AUDIT.md` §2).
- **No unresolved Critical or High findings** recorded in the reviewed Phase 4 scope.
- **F-01 resolved:** 10 exact G1–G10 golden-vector tests added and passing (`tests/hybrid.test.ts`, remediation describe `Phase 4 acceptance remediation: exact G1-G10 golden vectors (PHASE4_SPECIFICATION.md §8)`); values independently recalculated with justified IEEE 754 tolerance where needed.
- Local quality gates (remediation evidence, 2026-11-07): `npm run typecheck` pass; `npm run lint` pass; `npm run format:check` pass; `npm test` pass — **14 files, 293 tests**; `npm run build` pass; `npm pack --dry-run` pass (`@recomet/core@0.1.0`); `npm audit --omit=dev` **0 vulnerabilities**. Full `npm audit` reports **10 moderate development-only** advisories (ESLint/minimatch chain) — tracked, no unauthorized upgrades.
- Existing Phase 1–3 behavior preserved according to reviewed evidence and passing regression suite.
- No hybrid implementation or scoring behavior was modified for documentation/acceptance recording purposes.

## Scope accepted

- Explicit `hybrid` strategy with availability-aware weighted fusion.
- `auto` behavior preserved exactly; `auto` does not select `hybrid`.
- Bounded hybrid weights (defaults 1/1, finite/non-negative/bounded, `HYBRID_WEIGHT_MAX=1000`, zero disables component, both-zero `INVALID_CONFIG`).
- Truthful fallback/reporting; missing collaborative evidence not fabricated as zero.
- Eligible-universe/exclusion/target-interacted semantics preserved as implemented and tested.
- Request-scoped collaborative similarity-evaluation budget reused (never reset/replenished); budget bounds actual `computeSimilarity` evaluations only, not all CPU/memory.
- Safe explanations/contracts consistent with reviewed implementation (additive API/type impact acknowledged).

## Accepted limitations (formally recorded)

The following are known limitations. They remain accurately documented. **Acceptance does not mean they have been technically verified or eliminated.**

1. Dedicated hybrid benchmark scenarios are deferred.
2. Safari/WebKit execution remains unverified.
3. OS-level network isolation remains unverified.
4. Peak memory and worst-case hard-limit performance remain unverified.
5. Ten moderate development-only npm audit advisories remain tracked; no unauthorized dependency upgrades.
6. JavaScript Proxy inspection is not sandboxed.
7. TypeScript consumers using exhaustive strategy switches may need updates for the additive hybrid strategy.

## Evidence preservation

All previous audit and remediation evidence is preserved, including `PHASE4_DESIGN_APPROVAL.md`, `PHASE4_IMPLEMENTATION_AUDIT.md`, `PHASE4_FINAL_ACCEPTANCE_AUDIT.md`, `PHASE4_ACCEPTANCE_REVIEW.md`, Phase 2/3 acceptance records, and related remediation/audit artifacts present in the repository. This acceptance record does not replace them.

## Next phase boundary

Phase 5 planning/implementation is **not started** and requires separate maintainer authorization and scope definition. No Phase 5 work was performed as part of this acceptance.

## Formal decision

**Phase 4 is formally accepted by the maintainer, subject to the documented limitations above.**