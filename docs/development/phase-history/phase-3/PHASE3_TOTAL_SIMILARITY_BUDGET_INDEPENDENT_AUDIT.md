# Phase 3 Total Similarity Budget — Independent Audit

**Repository:** `F:\Recomet`  
**Audit type:** Review-only (no source, tests, configuration, dependencies, lockfiles, documentation, or benchmark results modified)  
**Primary remediation report reviewed:** `PHASE3_TOTAL_SIMILARITY_BUDGET_REMEDIATION.md`  
**Previous audit reviewed:** `PHASE3_RESOURCE_BOUNDING_REAUDIT.md`  
**Audit date:** 2026-11-07  
**Files created by this audit:** `PHASE3_TOTAL_SIMILARITY_BUDGET_INDEPENDENT_AUDIT.md` only

## Scope and method

This audit independently verified the implementation (not only the remediation report) against the reported item-based collaborative similarity-evaluation multiplication problem and the required total-budget fix.

**Verified by direct inspection:**
- All `computeSimilarity` references/call sites in `src/**/*.ts` (PowerShell `Select-String` across `src`; no matches in `tests` or `benchmarks` source text for `computeSimilarity(` outside test mocking/imports as noted).
- `src/collaborative/budget.ts`, `src/collaborative/similarity.ts`, `src/collaborative/model.ts`
- `src/candidates/collaborative.ts`, `src/engine/pipeline.ts`
- `src/validation/config.ts`, `src/validation/request.ts`
- `src/internal/limits.ts`, `src/contracts/config.ts`, `src/contracts/result.ts`, `src/index.ts`
- `README.md` (migration/limit text), `benchmarks/results.json` (inspected only)

**Verified by command execution (read-only commands; no benchmark overwrite):**
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run format:check` — PASS
- `npm test` — **13 files, 257 tests passed**
- `npx vitest run tests/collaborative.test.ts` — **1 file, 60 tests passed**
- `npm run build` — PASS
- `npm audit --omit=dev` — **0 vulnerabilities**
- `npm audit` — **10 moderate** dev-only `minimatch`-chain vulnerabilities (unchanged class; no runtime dependency change)

**Process restrictions observed:** no source/tests/config/deps/lockfiles/docs/benchmark-results modified; no commit/push/tag/publish/destructive Git operations; existing tracked/untracked/modified work preserved; Phase 4 not started; only this report created.

**Caveat (source-tree search):** authoritative runtime/library behavior was verified in `src/`. Built `dist/` artifacts (if present) were not treated as source of truth and were not modified; the audit focused on source paths. The remediation’s `computeSimilarity` gating was confirmed at the only source call sites.

## 1. Global similarity-call audit

**Verified — PASS with no bypass found in `src/`.**

| Location | Kind | Budget-gated? | Evidence |
|---|---|---:|---|
| `src/collaborative/similarity.ts:80` | `computeSimilarity` definition | n/a (primitive) | `export function computeSimilarity(...)` delegates to `cosineSimilarity`/`jaccardSimilarity`; no budget parameter/logic inside primitive (`:1-89`). |
| `src/candidates/collaborative.ts:4` | import | n/a | imports `computeSimilarity` from similarity module. |
| `src/candidates/collaborative.ts:146` | call (user-based) | **Yes** | `if (!tryConsumeSimilarityEvaluation(budget)) { break; }` at `:143-145`, `evaluationsPerformed += 1` at `:145`, then `computeSimilarity(...)` at `:146`. |
| `src/candidates/collaborative.ts:336` | call (item-based) | **Yes** | `if (!tryConsumeSimilarityEvaluation(budget)) { break; }` at `:333-335`, `candidate.evaluations += 1` at `:335`, then `computeSimilarity(...)` at `:336-342`. |
| `src/contracts/config.ts:35` | doc text only | n/a | mentions `computeSimilarity` in comment. |
| `src/internal/limits.ts:41,77` | doc/comment text only | n/a | mentions `computeSimilarity` invocations. |
| `src/collaborative/budget.ts:4` | doc text only | n/a | describes one unit per actual invocation. |

**Conclusion:** Every actual `computeSimilarity` invocation in source occurs only after a successful `tryConsumeSimilarityEvaluation`. No indirect/fallback/alternate source execution path was found that invokes similarity without consuming budget. Actual invocation count per request cannot exceed the configured budget consumed through this gate (bounded by `budget.configured` because `consumed >= configured` blocks further evaluations; `consumed` increments only on successful consume). User-based loop breaks on exhaustion (`:143-145`); item-based inner loop breaks on exhaustion and outer anchor loop stops when `budget.exhausted` (`:324`, `:333-335`).

**Unverified assumption:** No runtime monkey-patching/proxy replacement of imported `computeSimilarity` in production use; normal ESM module behavior assumed.

## 2. Budget lifecycle and auto strategy

**Verified — PASS.**

- **Creation:** `createSimilarityEvaluationBudget(validated.limits.maxCollaborativeSimilarityEvaluations)` is created in `src/engine/pipeline.ts:142-145` only when `needsCollaborative` (`:120-122`, attempts include a collaborative strategy). Exactly one budget instance is created for that request path and passed to every collaborative attempt via `collectCollaborative` (`:147-156`).
- **Shared across user/item and auto fallback:** For `strategy === 'auto'`, attempts are `[{strategy:'collaborative', method: method ?? 'user'}, {strategy:'collaborative', method:'item'}]` (`:63-72`), then fallback to `validated.fallbackStrategy` (`:76-78`). The same `budget` is used in the `for (const attempt of attempts)` loop (`:147-156`), so user→item collaborative attempts share consumed state; fallback does **not** reset or replenish budget (no `createSimilarityEvaluationBudget` inside loop; budget is `const`).
- **No cross-request leak:** Budget is a plain object created per request in `executePipeline` (`:142-145`); not stored globally/module-statefully. `SimilarityEvaluationBudget` is mutable only within that request instance.
- **Empty/invalid/failed/non-collaborative behavior:** Invalid requests throw during `validateRequest` (`pipeline.ts:112-114`) before budget creation. Non-collaborative requests (no collaborative attempt) skip budget creation (`:120-145`). Baseline-only path returns without collaborative processing. Collaborative attempts that produce no applicable candidates return an empty/failed attempt result; pipeline continues attempts/fallback deterministically (`:158-180`).
- **Exhaustion reporting:** `budget.exhausted` is set in `createSimilarityEvaluationBudget` when `configured <= 0` (`budget.ts:19`) and in `tryConsumeSimilarityEvaluation` when `consumed >= configured` (`budget.ts:31-36`). `CollaborativeCollection.budgetExhausted` returns `budget.exhausted` in user/item paths (`collaborative.ts:122,161,210,272,288,385`). Internal to collaborative collection (not exposed in public `RecommendationResult.metadata`; see §5).

## 3. Item-based fairness and correctness

**Verified — PASS for the stated deterministic fair-allocation design; minor documented mid-round bias assessed acceptable for pre-stable.**

- **Anchor selection/determinism:** `collectItemBased` builds anchors from `targetItems` entries with existing `itemUsers`, sorts by `Math.abs(userStrength)` descending then `likedItemId` ascending (`collaborative.ts:244-260`), slices to `maxNeighbors` (`:262-264`). Deterministic given deterministic `Map` iteration order of `targetItems` insertion and stable comparator.
- **Candidate selection/determinism:** Eligible candidates are collected in request `items` iteration order (`:296-314`), excluding `excludedIds` and items the target user has interacted with (`targetItems.has(item.id)`) (`:297-299`). Only candidates present in `model.itemUsers` are included. Deterministic.
- **Fair opportunity (no whole-candidate starvation):** Anchor-round allocation uses outer loop over anchors in relevance order and inner loop over all eligible candidates in request order (`:324-355`). Each candidate gets an evaluation opportunity against `anchor[0]` before `anchor[1]`, etc. This prevents naive front-loading across the whole candidate set. Verified by code structure and by focused collaborative tests selected by pattern (including “item-based fairness…” and budget tests; 60 collaborative tests passed).
- **Mid-round exhaustion determinism/bias:** If `tryConsumeSimilarityEvaluation` fails inside the current anchor pass, the inner loop `break`s (`:333-335`), and remaining candidates in that same pass miss that anchor; outer loop stops because `budget.exhausted` (`:324`). This is deterministic by `(anchor order, candidate request order)`. It can create minor within-round candidate-order bias (earlier candidates in the interrupted pass may receive the current anchor while later do not). **Assessment:** acceptable for this pre-stable release because it is deterministic, bounded, avoids whole-candidate starvation, never performs similarity without consuming budget, and uses only actual evaluated evidence for scoring.
- **Partial evaluation scoring:** Each consumed evaluation increments `candidate.evaluations` (`:335`). Evidence is added only when `sim !== undefined && sim.similarity > 0` (`:343-354`). Final score is `collaborativeScore(candidate.weighted / Math.max(1, candidate.support))` (`:363-367`), i.e., average over actual supporting neighbors/evidence count, not fabricated. Candidates with no positive evidence produce no candidate (`:364` guard path not shown in snippet end but consistent with `candidates` push only when evidence exists; return includes `applicable: candidates.length > 0`).
- **Support/weights/normalization:** Support increments only on positive similarity evidence (`:346-354`). Target normalization uses `normalizedStrength(anchor.userStrength, model.maxAbsStrength)` floored at 0 (`:347-350`). `normalizedStrength` clamps/handles finite values (`model.ts:92-105`); F-02 denominator floor behavior preserved in model (`model.ts:76-88`, `maxAbsStrength` floor 1).
- **Exclusions/previously interacted:** Excluded IDs and `targetItems` (user’s interacted items) are skipped (`:297-299`). Anchors equal to candidate item are skipped without consume (`:330-332`).
- **No misleading confidence:** Scores are averages over actual `support` (evidence count). No synthetic support/evaluations are added. Public result does not expose per-candidate evaluation/support counts.

## 4. Configuration and migration

**Verified — PASS.**

- **Bounds/defaults/hard max:** `src/internal/limits.ts` defines `maxCollaborativeSimilarityEvaluations` bound as `min: 1, max: 50_000, defaultValue: 5_000` (`LIMIT_BOUNDS`, also in resolved defaults). Contract documented in `src/contracts/config.ts:33-40` with same semantics (“maximum total collaborative similarity evaluations…”).
- **Validation:** `validateLimits` checks own limit keys against `LIMIT_BOUNDS` and rejects values that are not finite safe integers or outside `[min,max]` (`validation/config.ts:109-144`, using bounds/`RecometError` `LIMIT_EXCEEDED` path as applicable). Collaborative tests include invalid `0`, `-1`, `1.5`, `50001` and valid `1`, `50000` (`tests/collaborative.test.ts` pattern hits at `:911-928`).
- **Old key migration:** `maxCollaborativeComparisons` is explicitly rejected: `validation/config.ts:163-167` throws `INVALID_CONFIG` with message stating it was renamed to `maxCollaborativeSimilarityEvaluations` and clarifies the new setting is “maximum total collaborative similarity evaluations per request”, not per-candidate anchor comparisons. README states the same migration (`README.md:235-236`). No stale `maxCollaborativeComparisons` references found in `src/`, `README.md`, `SPECIFICATION.md`, `ARCHITECTURE.md`, or `benchmarks/run.mjs` except the explicit rejection and migration guidance.
- **`maxCollaborativeNeighbors` remains separate:** Defined separately in limits/contracts/config validation (`contracts/config.ts:28-32`, `internal/limits.ts` includes both keys, `validation/config.ts:388-401` validates collaborative `maxNeighbors`). Applied for neighbor/anchor selection (`topSimilarities`/slice to max neighbors; anchors sliced `:262-264`) and **not** used as similarity-evaluation budget.

## 5. Metrics and result truthfulness

**Verified — PASS for internal implementation; public API remains intentionally narrow.**

- **Evaluation counts represent actual invocations:** `evaluationsPerformed` increments only on paths where an evaluation is consumed and the code proceeds to call `computeSimilarity` (`collaborative.ts:145-146`, `335-336` with consumed budget and actual call). It matches “actual `computeSimilarity` invocations performed for this collection call” as documented (`:27-28`).
- **Budget exhaustion indicators:** `budgetExhausted` reports `budget.exhausted` for user/item collection results, including early returns (`:122,161,210,272,288,385`). Shared budget across auto attempts makes exhaustion state continuous.
- **Candidate counts/skipped definitions:** Item-based tracks `candidatesEvaluated` as eligible candidates with `evaluations > 0` and `candidatesSkipped = eligible.length - candidatesEvaluated` (`:356-390`). User-based returns `candidatesEvaluated: 0`, `candidatesSkipped: 0` (`:125-126,164-165,213-214`) because it tracks users/neighbors rather than item-candidate evaluation slots. **Finding (low):** internal definitions differ by method and are not documented in the public contract; this is not a correctness or safety defect because the metrics are internal (`CollaborativeCollection` is not exported in public result types) and public result behavior is unchanged.
- **No sensitive exposure in public results:** Public `RecommendationResult`/`RecommendationMetadata` do not include collaborative internal metrics, user IDs, item interaction details, or raw content (`contracts/result.ts:1-45`, `pipeline.ts:45-101,183-207`). `CollaborativeCollection` is internal to collaborative/pipeline code. `src/index.ts` exports contracts/types and core entrypoints; no collaborative collection internals exported.
- **Backward compatibility:** Public result shape unchanged. Intentional breaking change limited to pre-stable config migration: old `maxCollaborativeComparisons` rejected with clear `INVALID_CONFIG` guidance (documented). No overlapping/contradictory public settings observed.

## 6. Security and resource-exhaustion review

**Verified fixes:** similarity-evaluation multiplication is bounded by `maxCollaborativeSimilarityEvaluations` per request, shared across auto attempts, with no `computeSimilarity` bypass found in source.

**Bounded by design/config (within validated limits):**
- Actual `computeSimilarity` invocations: hard max `50_000`/request by config; gated at every source call site.
- Neighbor/anchor counts selected after evaluation: bounded by `maxCollaborativeNeighbors`/collaborative config.
- Request size/shape: validated by `validateRequest`/config/limits (items, interactions, ids, exclude lists, preference structures, attribute budgets, etc.); unsafe object structures guarded by `safe-object` helpers (`UnsafeStructureError` handling observed).
- Budget is request-scoped, plain data, no persistence/cross-request leak.

**Remaining/unbounded or not fully bounded by similarity-eval budget (must be distinguished):**
- **CPU outside `computeSimilarity` count:** preselection and per-evaluation work inside `computeSimilarity` (iterating user/item maps for cosine/Jaccard overlap and norms) is paid when an evaluation is consumed; total evaluations are bounded, but cost per evaluation depends on map sizes (interaction data/model shape) subject to existing interaction/validation limits. Candidate/anchor loops still perform comparisons/checks (e.g., excluded/target checks, anchor-candidate identity checks, loop control) even when many evaluations are skipped by exhaustion.
- **Memory:** interaction models, candidate lists, per-eligible `ItemEvidence` objects in item-based path, and similarity neighbor arrays are bounded by request/config/limits but not by the similarity-evaluation budget itself. Item-based allocates `eligible` evidence entries for all eligible candidates (`collaborative.ts:296-314`), which is O(eligible candidates) memory independent of evaluation budget.
- **Sorting:** anchor sort (`:251-260`) and `topSimilarities`/ranking sorts operate on bounded collections but are not governed by `maxCollaborativeSimilarityEvaluations`.
- **Public metadata observability:** budget exhaustion is not surfaced publicly (shape preserved) — not a resource issue, but reduces operator visibility.

**No evidence found** of validation bypass, unsafe object mutation/retention in the reviewed paths, runtime network/telemetry, or fabricated similarity evidence.

## 7. Independent verification

Commands executed (all read-only relative to source/config/benchmarks):

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm test` | **13 files passed, 257 tests passed** |
| `npx vitest run tests/collaborative.test.ts` | **1 file passed, 60 tests passed** |
| `npm run build` | PASS |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `npm audit` | **10 moderate** dev-only `minimatch` chain vulnerabilities |

**Benchmarks:** existing `benchmarks/results.json` and `benchmarks/results.pre-total-budget-remediation.json` were inspected only; **no benchmark files overwritten or altered**. Results JSON indicates synthetic local measurements and notes heap figures are not peak-memory measurements (`benchmarks/results.json:1-16`).

## 8. Process restrictions

Confirmed: review-only audit; no source/tests/configuration/dependencies/lockfiles/documentation/benchmark results modified; no commit/push/tag/publish; no destructive Git operations; existing tracked/untracked/modified work preserved; Phase 4 not started; only `PHASE3_TOTAL_SIMILARITY_BUDGET_INDEPENDENT_AUDIT.md` created.

## Findings (by severity)

| Severity | Finding | Evidence | Status/impact |
|---|---|---|---|
| **None (resolved)** | Prior R-01/S-01 item-based similarity-evaluation multiplication | `collaborative.ts:143-146,333-336`; `budget.ts`; `pipeline.ts:120-156`; migration in `validation/config.ts:163-167`; 257 tests pass | Core reported issue fixed in source. |
| **Low** | Internal metric definition inconsistency: item-based reports `candidatesEvaluated`/`candidatesSkipped` from eligible evidence; user-based always returns `0/0` | `collaborative.ts:125-126,164-165,213-214,356-390` | Internal-only; public metadata unchanged; can confuse future maintainers/debugging. Recommend clarifying names/semantics in internal type/docs if touched later. |
| **Low** | Public `RecommendationResult` metadata does not expose budget exhaustion/evaluation counts | `contracts/result.ts:34-44`, `pipeline.ts:45-101` | Truthful (no false claim) but limited observability. Acceptable given intentional public-shape preservation; consider explicit metadata in a future contract revision if needed. |
| **Informational** | Minor deterministic mid-round candidate-order bias when item-based budget exhausts mid-anchor-pass | `collaborative.ts:324-335`; remediation report | Documented, bounded, avoids whole-candidate starvation; acceptable for pre-stable. |
| **Informational** | Similarity-evaluation budget does not bound all CPU/memory (preselection, per-evaluation map work when consumed, sorting, model/candidate memory) | `similarity.ts`, `collaborative.ts`, `model.ts`, `pipeline.ts` | Explicitly outside budget scope; still constrained by existing limits/validation but should not be described as fully resource-bounded. |

## Final verdict

APPROVE WITH CONDITIONS

**Conditions (for maintainer consideration; do not block the core total-budget fix):**
1. Accept or follow up on internal `candidatesEvaluated`/`candidatesSkipped` semantics (user-based `0/0` vs item-based evidence-based counts) to avoid maintainer confusion; keep public behavior unchanged unless intentionally versioned.
2. Treat “resource bounded” claims narrowly: `maxCollaborativeSimilarityEvaluations` bounds **actual `computeSimilarity` invocations per request only**; preselection, sorting, model construction, per-invocation map work (when consumed), and memory remain bounded by other limits/design, not by this budget.
3. Retain awareness that public metadata does not currently report evaluation-budget exhaustion; if operators need observability, add it via an explicit, versioned contract change.

**Verified facts:** the reported anchor×candidate multiplication path is gated by a request-scoped, auto-shared similarity-evaluation budget at all source `computeSimilarity` call sites; migration rejects the old key; required checks pass as recorded above. **Unverified assumptions:** real browser/Safari/WebKit execution, OS-level network isolation, peak memory, worst-case hard-limit production performance, and non-source built artifacts’ equivalence.

**Maintainer decision required:** this audit does not formally accept Phase 3.