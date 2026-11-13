# PHASE3_TOTAL_SIMILARITY_BUDGET_REMEDIATION.md

**Project:** Recomet (`F:\Recomet`)  
**Task:** Remediate the remaining Phase 3 item-based collaborative resource-bound issue identified in `PHASE3_RESOURCE_BOUNDING_REAUDIT.md` (anchor cap × candidate multiplication; `maxCollaborativeComparisons` misleading for item-based).  
**Date:** 2026-11-07  
**Scope:** Phase 3 collaborative-only. No Phase 4/hybrid work. No new recommendation algorithms or unrelated refactoring. No runtime dependencies added; no dependency/lockfile changes. No commits, pushes, tags, or publication. No destructive Git operations. All existing user work (including modified/untracked files) preserved.

## 1. Root cause

`PHASE3_RESOURCE_BOUNDING_REAUDIT.md` found **REMEDIATION REQUIRED**:

- **User-based (R-01 path):** `maxCollaborativeComparisons` bounded similarity comparisons before evaluation (`min(overlapping_users, maxCollaborativeComparisons)`) — genuine for that phase.
- **Item-based (S-01 path):** `maxCollaborativeComparisons` only bounded **target liked-item anchors** selected before evaluation. Actual `computeSimilarity` calls occurred inside `eligible_candidates × anchors` (`src/candidates/collaborative.ts` prior implementation), so candidate count multiplied evaluations beyond the intended budget. Measured examples: 50 candidates × 10 anchors = 500 calls; 200 × 50 = 10,000. Theoretical maxima reached `maxItems * maxCollaborativeComparisons` under valid config.
- **Contract/naming:** `maxCollaborativeComparisons` was misleading for item-based (anchor cap, not total comparison/evaluation budget).
- **`auto`:** user-based then item-based fallback could compound work; each path respected only its own (insufficient for item-based total) structure.

## 2. Final configuration semantics and migration decision

### 2.1 New setting

`maxCollaborativeSimilarityEvaluations` (replaces `maxCollaborativeComparisons`)

- **Exact meaning:** maximum **total** collaborative similarity evaluations (`computeSimilarity` invocations) per recommendation request.
- **Scope:** applies to user-based collaborative filtering, item-based collaborative filtering, and the complete `auto` strategy **including fallback attempts**. The budget is request-scoped and shared across `auto` user→item attempts.
- **What it bounds:** actual `computeSimilarity` invocations only. It does **not** bound all CPU or memory consumption, and does not by itself bound all preselection overlap counting, sorting, model construction, result scoring passes, or memory allocations.
- **Distinct setting:** `maxCollaborativeNeighbors` / `collaborative.maxNeighbors` remain unchanged in meaning — they control how many neighbors are **selected after** similarity evaluation, not how many evaluations are permitted.

### 2.2 Bounds and rationale

| Parameter | Min | Default | Hard max | Rationale |
|---|---:|---:|---:|---|
| `maxCollaborativeSimilarityEvaluations` | 1 | 5,000 | 50,000 | **Default 5,000:** conservative, predictable per-request bound for library workloads while preserving useful collaborative signal in common cases. **Min 1:** preserves correctness/safety at tight budgets (processing stops deterministically; no bypass). **Hard max 50,000:** explicit upper cap to limit worst-case similarity CPU while allowing operator tuning; cannot be raised through configuration. Values are safe integers validated with existing config rules (`INVALID_CONFIG`, documented range). This is a resource bound, not a performance guarantee. |

### 2.3 Migration decision (pre-stable, clear)

`maxCollaborativeComparisons` is **removed** from `EngineLimits`/`LIMIT_KEYS`/defaults/bounds and is **rejected** when supplied:

- Validation throws `INVALID_CONFIG` with an explicit message naming both keys and stating that `maxCollaborativeSimilarityEvaluations` means maximum total collaborative similarity evaluations per recommendation request.
- No silent remapping, no dual semantics, no overlapping contradictory settings.

Updated consistently: `src/internal/limits.ts`, `src/contracts/config.ts`, `src/validation/config.ts`, `src/candidates/collaborative.ts`, `src/engine/pipeline.ts`, `tests/collaborative.test.ts`, `benchmarks/run.mjs`, `README.md` (tracked, modified). Historical audit/remediation reports mentioning the old name were left intact as records of prior state.

## 3. Budget enforcement and allocation

### 3.1 Request-scoped budget

`src/collaborative/budget.ts` introduces `SimilarityEvaluationBudget` (`configured`, `consumed`, `exhausted`) and `tryConsumeSimilarityEvaluation()`:

- **Every actual `computeSimilarity` call consumes 1 unit** and occurs only after a successful `tryConsumeSimilarityEvaluation()` check.
- When `consumed >= configured`, consumption fails, `exhausted` is set, and **no similarity evaluation occurs**.
- The budget object is created once per collaborative request in `src/engine/pipeline.ts` from `config.limits.maxCollaborativeSimilarityEvaluations` and passed through `attemptCollaborative()` to all `collectCollaborative()` calls.
- **`auto` sharing:** `collaborative.method === 'auto'` tries user-based then item-based when user-based is not applicable; both attempts receive the **same** budget instance, so total evaluations across fallback never exceed the configured cap.

### 3.2 User-based allocation

1. Build deterministic relevance order of overlapping other users: iterate target items → `model.itemUsers` to count overlap with target (excluding target). Sort by **overlap desc, `userId` asc**. Only overlapping users are considered (relevant to `minOverlap >= 1`).
2. Evaluate in that order, consuming one budget unit per attempted user evaluation (`computeSimilarity`) until budget exhaustion or list end.
3. Select top neighbors from positive-similarity results by **similarity desc, overlap desc, id asc**, capped by `collaborative.maxNeighbors` (distinct from evaluation budget).
4. Score eligible request items using selected neighbors (map lookups, no similarity math). Exclusions/target-interacted items preserved.

### 3.3 Item-based fair allocation (no naive candidate-order truncation)

**Problem avoided:** candidate-outer × anchor-inner with a total budget would let early candidates consume all evaluations and starve later candidates.

**Eligible candidates:** request items in request order that are not `excludedIds`, not already interacted with by target, and have a non-empty `itemUsers` map in the model.

**Anchors:** all target-user liked items with known `itemUsers`, deterministically ordered by **`abs(userStrength)` desc, `likedItemId` asc** (relevance priority preserved). No separate anchor-count cap is used as the total budget; anchors are consumed through the shared evaluation budget.

**Fair, deterministic allocation (anchor rounds):**

```text
for anchor A_r in anchors (relevance order), while budget not exhausted:
  for candidate C_i in eligible candidates (request order):
    if A_r is C_i or cannot evaluate: continue (no similarity call)
    if cannot consume budget: break current round / stop deterministically
    consume 1; perform computeSimilarity(C_i.itemUsers, A_r.likedUsers)
    accumulate weighted/sum/support for C_i from positive similarities
```

- **Fairness:** each eligible candidate receives an evaluation opportunity against `anchor[0]` before any candidate receives `anchor[1]`, etc. This prevents whole-candidate starvation and obvious front-loading. Candidates are treated equally across anchor rounds.
- **Determinism / tie-breaking:** anchors ordered by `abs(strength)` desc, `likedItemId` asc. Candidates keep request item order. If the budget is exhausted mid-round, remaining candidates in that round miss the current anchor deterministically; no similarity evaluation occurs without consuming budget.
- **More candidates than available evaluations:** with `C` candidates and budget `B < C`, the first `B` candidates in request order receive anchor[0] evaluations and the rest receive none for that exhausted state — distributed as evenly as the single-anchor-round budget allows, never concentrated on one candidate taking many anchors while others get none (unless `B >= C` and anchors available). This is the minimal-order bias inherent to a hard total budget; it is deterministic and documented.
- **Partially evaluated candidates:** scored only from anchors actually evaluated. `support` = number of contributing positive-similarity anchors actually evaluated; weighted score uses those same evaluated contributions. Candidates with no positive contributing evaluations are not emitted as scored collaborative candidates.
- **Budget exhaustion behavior:** processing stops safely/deterministically; `budgetExhausted` is reported truthfully in internal collection metrics. Public summaries remain the existing collaborative/fallback strategy summaries (they do not claim a complete calculation count; the public `RecommendationResult` metadata shape is unchanged).

## 4. Proof that actual similarity calls cannot exceed the per-request budget

1. **Single consumption gate:** `tryConsumeSimilarityEvaluation()` is called immediately before every `computeSimilarity()` invocation in `src/candidates/collaborative.ts` (user-based loop and item-based fair allocation loop). No other production path calls `computeSimilarity` except these budget-gated sites.
2. **Shared budget for `auto`:** `src/engine/pipeline.ts` creates one budget and passes it to user and (if needed) item fallback attempts.
3. **Instrumented proof:** `tests/collaborative.test.ts` mocks `../src/collaborative/similarity.js` with `vi.fn(actual.computeSimilarity)` (behavior preserved) and asserts actual mock call counts:
   - User-based cosine/jaccard: actual calls `<= budget` and equal `evaluationsPerformed` for below/at/above cases (20 overlapping users; budgets 5/20/25 and 7).
   - Item-based cosine/jaccard: 20×20=400 possible pairs, budget 25 → **25 actual calls**; 15×30=450, budget 40 → **40 actual calls**.
   - Candidates >> budget fairness case: 50 candidates × 10 anchors, budget 30 → **30 actual calls**, 30 candidates evaluated, 20 skipped (not starved by front-loading).
   - Anchors >> budget: 10 candidates × 50 anchors, budget 12 → **12 actual calls**, all 10 candidates evaluated.
   - `auto` fallback: total actual calls **`<= 8`** across user-check + item fallback with shared budget.
   - Exhaustion/determinism: repeated runs produce identical collections/results; actual calls equal budget.

## 5. Test evidence and exact counts

### 5.1 Added/updated coverage

- Config: `maxCollaborativeSimilarityEvaluations` validation (0, -1, 1.5, 50,001 invalid; 1 and 50,000 valid). Migration: `maxCollaborativeComparisons` rejected with clear `INVALID_CONFIG` naming both keys.
- User-based: actual `computeSimilarity` calls never exceed budget (below/at/above, cosine and Jaccard); `maxNeighbors` remains distinct from evaluation budget.
- Item-based: actual calls never exceed budget with many candidates/anchors; candidates >> budget; anchors >> budget; cosine and Jaccard.
- Fairness: no naive front-loading/starvation (50 candidates, 10 anchors, budget 30 → 30 candidates evaluated; recommendations include early and late-in-round candidates, not only the very first candidate). Full first anchor round when budget allows.
- `auto`: shared budget across user-based then item-based fallback.
- Budget exhaustion: safe, deterministic, repeatable.
- Exclusions/previously interacted handling; empty/sparse fallback.
- No mutation of caller-owned data.
- Existing F-02 normalization, F-03 negative-value rejection, F-04 unknown interaction-type default preserved under budget.

### 5.2 Exact verification results (this task)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run format:check` | PASS (after Prettier formatting `tests/collaborative.test.ts`) |
| `npm test` | **13 test files passed, 257 tests passed, 0 failed** |
| Focused collaborative (`npx vitest run tests/collaborative.test.ts`) | **1 file passed, 60 tests passed** |
| `npm run build` | PASS |
| `npm run bench` | PASS (18 scenarios completed; see §6) |
| `npm audit --omit=dev` | **found 0 vulnerabilities** |
| `npm audit` | **10 moderate severity vulnerabilities** (dev dependency chain: `minimatch` ReDoS advisory via eslint/jsdom; no runtime dependencies; `--omit=dev` clean; unchanged from prior audits) |

## 6. Benchmark evidence

- Existing results preserved before overwrite: `benchmarks/results.pre-total-budget-remediation.json`.
- Bench output overwritten by this run: `benchmarks/results.json` (gitignored in normal workflows; untracked file in worktree). Recorded as modified for this task.
- Environment (from harness output): Node `v24.18.0`, V8 `13.6.233.17-node.50`, `11th Gen Intel(R) Core(TM) i3-1125G4 @ 2.00GHz`, 8 logical CPUs, `win32 10.0.26300`. **Synthetic, machine-specific, not performance guarantees.**

Focused collaborative total-eval-budget scenarios (all returned strategy `collaborative`):

| Scenario | n | limit | p50 ms | p95 ms | mean ms | ops/s | returned |
|---|---:|---:|---:|---:|---:|---:|---:|
| `cf-user-2k-users-total-eval-budget-500` (cosine) | 2000 | 20 | 51.895 | 72.655 | 52.588 | 19.0 | 20 |
| `cf-user-2k-users-jaccard-total-eval-budget-500` | 2000 | 20 | 89.142 | 205.242 | 88.420 | 11.3 | 20 |
| `cf-item-large-history-total-eval-budget-200` (cosine) | 2000 | 20 | 8.190 | 22.964 | 10.393 | 96.2 | 4 |
| `cf-item-large-history-jaccard-total-eval-budget-200` | 2000 | 20 | 7.711 | 11.867 | 8.394 | 119.1 | 4 |

Item history-budget scenarios returned 4 items under a tight total budget (200 evaluations) with large target history and fair allocation; this is expected bounded behavior, not a completeness guarantee. Heap samples in bench results are post-call/GC samples, not peak-memory measurements.

## 7. Security, privacy, compatibility, and performance implications

- **Security/resource exhaustion:** item-based no longer multiplies similarity evaluations by `eligible_candidates × anchors` without a total cap. Actual `computeSimilarity` invocations per request are bounded by `maxCollaborativeSimilarityEvaluations` across user/item and `auto` fallback. Preselection/sorting/model construction are still bounded primarily by existing interaction/item/model limits; they are not claimed to be bounded by this setting.
- **Privacy:** no raw user IDs, item content, interaction records, or sensitive identifiers are exposed in result metadata or errors by this change. Internal collection metrics are not part of the public `RecommendationResult` JSON contract.
- **Compatibility (pre-stable):** `maxCollaborativeComparisons` is intentionally rejected with a clear `INVALID_CONFIG` migration message to avoid ambiguous or silently misleading semantics. `maxCollaborativeNeighbors`/`collaborative.maxNeighbors` unchanged. Public `RecommendationResult`/metadata field shapes unchanged.
- **Correctness/semantics preserved:** F-02 normalization denominator min 1; F-03 finite non-negative `interaction.value` with negatives rejected as `INVALID_INTERACTION` and `-0` canonicalized; F-04 unknown valid unconfigured interaction `type` defaults to strength 1 when `value` absent; effective strength precedence `value` > `interactionTypes[type]` > `1`. Exclusions, target-interacted exclusion, scoring bounds, support semantics, fallback behavior, and deterministic ranking/tie-breaking preserved where applicable.
- **Fairness trade-off:** fair anchor-round allocation avoids candidate starvation but, when exhausted mid-round, gives that round’s anchor to earlier candidates in request order deterministically. This is a bounded partial-evaluation trade-off, documented and tested; it is materially fairer than naive candidate-outer front-loading.

## 8. Remaining limitations and unverified checks

- **Not bounded by this setting:** all CPU/memory use, overlap preselection counting/sorting cost, model construction/validation cost, candidate scoring passes after neighbor/anchor evaluation, and memory footprint. These remain constrained by existing limits (`maxItems`, `maxInteractions`, etc.) but are not expressed as a total similarity-evaluation budget.
- **Small-order bias on mid-round exhaustion:** item-based fairness is by anchor rounds; exhaustion inside a round is deterministic by candidate iteration (request) order.
- **Public observability:** `RecommendationResult` metadata shape is unchanged (fixed fields). Detailed budget metrics are available in internal `CollaborativeCollection` for tests/instrumentation; the public API does not expose new budget fields.
- **Unverified:** real browser execution, Safari, WebKit, OS-level network isolation, peak memory, and worst-case hard-limit runtime/performance at maximum valid configuration combinations. Synthetic benchmarks are not production guarantees.
- **Dev audit:** `npm audit` reports 10 moderate dev-only `minimatch` vulnerabilities (eslint/jsdom chain); `npm audit --omit=dev` reports 0.

## 9. Exact modified files and Git status

### 9.1 Files changed/added for this remediation (implementation)

- `src/collaborative/budget.ts` *(added)* — request-scoped similarity-evaluation budget primitives.
- `src/internal/limits.ts` *(modified, untracked in worktree)* — renamed limit/bounds/defaults to `maxCollaborativeSimilarityEvaluations`.
- `src/contracts/config.ts` *(modified, untracked)* — public `EngineLimits` contract updated.
- `src/validation/config.ts` *(modified, untracked)* — validation/migration: rejects old `maxCollaborativeComparisons` with clear `INVALID_CONFIG`; resolves new limit.
- `src/candidates/collaborative.ts` *(modified, untracked)* — budget-gated `computeSimilarity` calls; fair item-based anchor-round allocation; truthful internal collection metrics.
- `src/engine/pipeline.ts` *(modified, untracked)* — creates/shares request-scoped budget across collaborative attempts including `auto` fallback.
- `tests/collaborative.test.ts` *(modified, untracked)* — updated to new semantics; added instrumented actual-call, fairness, auto-shared-budget, exhaustion, migration, config, and F-02/F-03/F-04 preservation tests.
- `benchmarks/run.mjs` *(modified, untracked)* — uses `maxCollaborativeSimilarityEvaluations`; focused total-eval-budget scenarios.
- `README.md` *(modified, tracked)* — collaborative limit documentation updated.
- `PHASE3_TOTAL_SIMILARITY_BUDGET_REMEDIATION.md` *(added, this report)*.

### 9.2 Generated/preserved artifacts

- `benchmarks/results.json` — overwritten by `npm run bench` (recorded). Previous results preserved as `benchmarks/results.pre-total-budget-remediation.json` (untracked backup, created before overwrite).
- `dist/` — rebuilt by build/bench (not reported as a tracked modification).

### 9.3 Git status (end of task)

```text
 M README.md
?? .gitignore
?? .prettierignore
?? .prettierrc.json
?? ARCHITECTURE.md
?? CONTRIBUTING.md
?? LICENSE
?? PHASE2_ACCEPTANCE.md
?? PHASE3_FINAL_SECURITY_AND_LOGIC_AUDIT.md
?? PHASE3_RESOURCE_BOUNDING_REAUDIT.md
?? PHASE3_RESOURCE_BOUNDING_REMEDIATION.md
?? PHASE3_TOTAL_SIMILARITY_BUDGET_REMEDIATION.md
?? PRIVACY.md
?? ROADMAP.md
?? SECURITY.md
?? SPECIFICATION.md
?? benchmarks/
?? eslint.config.js
?? package-lock.json
?? package.json
?? scripts/
?? src/
?? tests/
?? tsconfig.build.json
?? tsconfig.json
?? vitest.config.ts
```

(`benchmarks/` is an untracked directory and includes `results.pre-total-budget-remediation.json` preserved before benchmark overwrite, plus `results.json` overwritten by this run. `git diff --stat -- README.md` reports `README.md | 356 insertions(+)`, reflecting the pre-existing tracked README content state plus this task’s minimal collaborative-limit update. No destructive operations performed.)

## 10. Confirmation

- **No Phase 4 work begun.** Hybrid recommendations/personalization/blending not implemented.
- **No commits, pushes, tags, or publication.** All changes remain uncommitted for maintainer review.
- **No destructive Git operations.**
- **No runtime dependencies added; no dependency/lockfile changes.**

## Final recommendation

**READY FOR INDEPENDENT RE-AUDIT**
