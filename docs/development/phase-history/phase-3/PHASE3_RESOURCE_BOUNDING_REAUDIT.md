# PHASE3_RESOURCE_BOUNDING_REAUDIT.md

**Project:** Recomet (`F:\Recomet`)  
**Task:** Independent re-audit of R-01/S-01 resource-bounding remediation  
**Date:** 2026-11-07 (audit executed)  
**Mode:** Review-only. No source/tests/config/docs/dependency/lockfile modifications. No destructive git commands. No commits/push/tags/publish. No Phase 4. Existing work preserved.

## 1. Scope inspected

Read/inspected (actual implementation): `PHASE3_FINAL_SECURITY_AND_LOGIC_AUDIT.md`, `PHASE3_RESOURCE_BOUNDING_REMEDIATION.md`, `src/candidates/collaborative.ts`, `src/collaborative/similarity.ts`, `src/collaborative/model.ts`, `src/internal/limits.ts`, `src/contracts/config.ts`, `src/validation/config.ts`, `src/engine/pipeline.ts`, `tests/collaborative.test.ts` (R-01/S-01 and related CF coverage), `benchmarks/run.mjs`, `benchmarks/results.json` (existing). Built `dist/` was used only for read-only ad-hoc measurement via a temporary script in the pre-approved temp directory (`%LocalAppData%\Temp\opencode\reaudit-r01s01.mjs`, not a repo file).

**Git state (unchanged):** ` M README.md` and the same untracked working-tree set as remediation (including `src/`, `tests/`, `benchmarks/`, audit/remediation reports). `git diff --stat -- README.md`: `README.md | 351 insertions`.

## 2. Critical finding — total computation budget

### 2.1 Is `maxCollaborativeComparisons` a total comparison budget or an anchor/user-selection limit?

| Method | What `maxCollaborativeComparisons` limits | Is total similarity evaluation bounded by this value alone? |
|---|---|---|
| **User-based** | Number of other users **compared** (preselected) before `computeSimilarity` (`selectComparisonUsers` → `slice(0, maxCollaborativeComparisons)`; loop calls `computeSimilarity` once per selected user). | **Yes (genuine bound on similarity evaluations in the neighbor-finding phase).** Evaluations = `min(selected_overlapping_users, maxCollaborativeComparisons)` (≤ 50,000 at hard max). |
| **Item-based** | Number of target-user liked-item **anchors** selected before candidate similarity loop (`selectItemAnchors(..., limits.maxCollaborativeComparisons)`). | **No. It is an anchor limit, not a total comparison budget.** `computeSimilarity` is called inside `for (item of request items)` × `for (anchor of anchors)` (`src/candidates/collaborative.ts:225-245`), with `comparisonsEvaluated += 1` immediately before each call (244-245). Total actual similarity evaluations ≈ `eligible_candidates * anchors_used` (minus self-anchor/undefined-skip cases). |

**Conclusion:** `maxCollaborativeComparisons` correctly bounds **user similarity comparisons** (R-01) but only bounds **anchors** for item-based (S-01 partial). The remediation report stated the multiplication (`eligible_candidates * min(target_liked_items, maxCollaborativeComparisons)`, §7/§5 context) — that is mathematically honest — but the limit name/contract text “Upper bound on collaborative similarity comparisons…” is **misleading for item-based** because it does not express the candidate multiplier.

### 2.2 Actual measured similarity invocation counts (read-only, `dist/` + internal API)

Measured by importing `dist/candidates/collaborative.js` and `dist/collaborative/model.js` in a temp script (no repo modification); `comparisonsEvaluated` is the metric returned by the implementation and, for item-based, increments on each actual `computeSimilarity` call.

| Case | `comparisonsEvaluated` | `anchors` / `usersConsidered` | `neighborsOrAnchorsSelected` | Notes |
|---|---:|---:|---:|---|
| Item: 50 eligible candidates, 100 target anchors, **bound 10** | **500** | anchors 10 | — | `50 * 10 = 500` actual similarity evaluations |
| Item: 200 eligible candidates, 50 target anchors, **bound 50** | **10,000** | anchors 50 | — | Confirms candidate × anchor multiplication |
| User: 500 overlapping users, **bound 100**, maxNeighbors default 50 | **100** | users considered 100 | neighbors 50 | Comparisons bounded; neighbors distinct |
| User: 50 overlapping users, **bound 20**, `maxNeighbors 3` | **20** | users considered 20 | neighbors 3 | Bound distinct from `maxNeighbors` |

**Metric accuracy:** Item-based `comparisonsEvaluated` counts actual `computeSimilarity` invocations (accurate). User-based `comparisonsEvaluated` is set to `comparisonUsers.length` (134,179) and each selected user is attempted in the loop (118-127); it equals actual calls in the normal consistent-model case (a missing `userItems` entry would be `continue` without a call, but the model is request-consistent). Minor naming/precision nuance, not a security issue.

### 2.3 Maximum theoretical comparison counts (valid configuration)

From `src/internal/limits.ts` hard bounds/defaults:

| Limit | Default | Hard max |
|---|---:|---:|
| `maxItems` | 10,000 | 100,000 |
| `maxInteractions` | 10,000 | 100,000 |
| `maxCollaborativeComparisons` | 5,000 | 50,000 |
| `maxCollaborativeNeighbors` (ceiling for `collaborative.maxNeighbors`) | 50 | 500 |

**User-based (similarity evaluations):** `<= min(overlapping_other_users, maxCollaborativeComparisons)` → **max 50,000**. Scoring pass uses map lookups over `items * selected_neighbors` (not similarity math), bounded by `maxItems * maxCollaborativeNeighbors` lookups in worst case — cheap relative to cosine over vectors, but still a loop; no `computeSimilarity`.

**Item-based (similarity evaluations):** `<= eligible_request_items * min(target_anchor_items, maxCollaborativeComparisons)` (minus self/missing skips). Theoretical maxima:
- **Absolute hard-max config:** `100,000 items * 50,000 anchors = 5,000,000,000` similarity evaluations — **not a practical bound**.
- **Defaults:** `10,000 * 5,000 = 50,000,000` — still very high.
- **“Typical” bounded scenario from bench:** 1,830 eligible candidates × 50 anchors = 91,500 max possible by formula; actual was feasible because not all pairs produced useful work? (bench completed at ~16ms p50 with that shape due to small maps/overlap; cost scales with vector sizes.)

**Preselection/sorting costs (not similarity math):**
- User-based `selectComparisonUsers`: iterates target items and `itemUsers` members to count overlap (`O(sum |users(item)| over target items)`), then sorts overlap candidates (`O(U log U)`). Bounded indirectly by `maxInteractions`/model structure (interactions cap 100,000), but can still be non-trivial for dense data.
- Item-based `selectItemAnchors`: sorts target items `O(T log T)` with `T <= target_liked_items` (bounded by interactions/unique pairs).

### 2.4 Can candidate count multiply work beyond the intended budget?

**Yes, for item-based.** Demonstrated (200 candidates × 50 anchors = 10,000 evaluations). Candidate count is not limited by `maxCollaborativeComparisons`; it is limited by request `items`/`maxItems` and exclusions.

### 2.5 Can multiple processing stages exceed intended resource budget?

- **User-based:** neighbor-finding similarity evaluations are bounded. Preselection is bounded by interaction/model size (see above). No hidden full similarity computation found before selection.
- **Item-based:** anchor selection is bounded, but the main similarity stage is multiplied by candidates. `collectCollaborative` may also be called twice in `auto` method (`attemptCollaborative` tries user, then item if user not applicable) — doubling work in the fallback-to-item case; each call still respects its own (insufficient for item-based total) bound structure.
- Validation builds interaction model over up to `maxInteractions` (bounded). These stages are bounded by existing limits but represent additional work.

## 3. User-based computation (R-01)

| Check | Evidence | Assessment |
|---|---|---|
| Comparison limit enforced before similarity calculations | `selectComparisonUsers` returns `slice(0, maxComparisons)` (97); `computeSimilarity` only in subsequent loop over `comparisonUsers` (118-127). No similarity over all users. | **Pass** |
| Overlap counting/sorting bounded by existing input limits | Uses `model.itemUsers` over `targetItems` and validated interactions (`maxInteractions` hard max 100,000). Sorting over overlap candidates only. Not a separate hard numeric cap, but constrained by request/model limits. | **Pass with note** (indirectly bounded) |
| User selection deterministic | Overlap desc, `userId` asc via `compareIds` (89-96). | **Pass** |
| `maxNeighbors` distinct from users considered | `topSimilarities(..., collaborative.maxNeighbors)` after comparisons (128). Measured: 20 compared, 3 selected. | **Pass** |
| No hidden full similarity computation before selection | Preselection uses overlap counts/lookups only; no `computeSimilarity`/cosine/jaccard. | **Pass** |
| Comparison metrics match actual operations | `comparisonsEvaluated`/`usersConsidered` = `comparisonUsers.length`; actual calls are one per selected user except impossible missing-model case. Measured counts align. | **Pass (minor precision nuance)** |

## 4. Item-based computation (S-01)

| Check | Evidence | Assessment |
|---|---|---|
| Anchor selection deterministic and relevant | `abs(strength)` desc, `likedItemId` asc (190-203). Strength-based relevance is reasonable; deterministic. | **Pass** |
| Actual number of similarity calculations bounded | Anchors bounded, but total = anchors × eligible candidates (measured 500, 10,000). **Not bounded to `maxCollaborativeComparisons` total.** | **Fail for “genuine per-request total similarity bound”** |
| Candidate count cannot multiply work beyond intended budget | It can (see 2.2/2.3). | **Fail** |
| Candidate generation and previously interacted item exclusion correct | Skips `excludedIds` and `targetItems.has(item.id)` (226-228). Preserves exclusion rules. | **Pass** (regression tests + code) |
| No unnecessary similarity calculations before the limit | Anchors selected before candidate loop (221). No pre-limit similarity. | **Pass** |
| Scores and support counts logically consistent | Preserved `support` increment on positive similarity contribution (249), weighted/sum, `clamp01`, `collaborativeScore(score, support)`. Matches pre-remediation `dist` behavior. | **Pass** (255 tests; typecheck) |
| Selection process does not introduce misleading recommendation bias | Deterministic, relevance-oriented; truncation can omit anchors/quality beyond bound (documented tradeoff). Not “misleading” if explained, but behavior changes when over bound. | **Pass with note** (documented tradeoff) |

## 5. Configuration and compatibility

| Item | Finding |
|---|---|
| Default 5,000 / min 1 / max 50,000 | Implemented in `LIMIT_BOUNDS` and resolved defaults (`limits.ts:75,105`). |
| Validation and error handling | Generic limit validation in `validation/config.ts:163-178` enforces safe integer and `[min,max]`, returns `INVALID_CONFIG` (typed). Collaborative tests verify 0, -1, 1.5, 50,001 rejected; 1 accepted. |
| Backward compatibility when omitted | Optional on `EngineLimits` contract; resolved with default `5,000`. Existing configs without the field remain valid. |
| Name/contract accuracy | **Problem identified.** `maxCollaborativeComparisons` / “Upper bound on collaborative similarity comparisons” is accurate for **user-based** (bounds comparisons) but **inaccurate/misleading for item-based** (bounds anchors; actual comparisons multiply by candidates). This is a **naming and contract clarity defect** and contributed to overstating the bound in “total comparison budget” terms. |

## 6. Adversarial/boundary evidence

**Executed (review-only):**
- `npm test`: **13 files, 255 tests passed** (full suite).
- `npx vitest run tests/collaborative.test.ts`: **1 file, 58 tests passed**.
- `npm run typecheck`: PASS.
- `npm audit --omit=dev`: `found 0 vulnerabilities`.

**Test coverage observed (R-01/S-01 block + existing CF):** limit validation (0/-1/1.5/50001/1), below/at/above behavior, deterministic relevance selection, comparisons vs `maxNeighbors` distinction, large user population, Jaccard, empty/sparse fallback, anchor determinism (strongest anchor wins in crafted case), large target history, large candidate set with bounded anchors, target-interacted exclusion preserved, F-02/F-03/F-04 semantics preserved, no input mutation. Also both methods/similarities, fallback, normalization/interaction semantics elsewhere in suite.

**Gaps relative to adversarial request:** tests do **not** assert actual `comparisonsEvaluated` counts via internal API (would catch the multiplication misconception explicitly), and do not exercise worst-case `maxItems` × `maxComparisons` magnitudes (impractical in unit tests). I measured actual counts with a temp script (see 2.2). `auto` method’s double-attempt behavior (user then item when user not applicable) is implemented but not specifically audited for compounded item-based cost here.

## 7. Performance and mathematical correctness

- **Scoring semantics:** preserved (`clamp01(weighted/weightSum)`, `Math.max(0, normalizedStrength(...))`, `support` = number of contributing neighbors/anchors, `collaborativeScore(score,support)`). No change to similarity math, normalization (F-02), or interaction semantics (F-03/F-04).
- **Ranking/tie-breaking:** unchanged pipeline (`deterministicRanker.select`, BoundedTopK). Neighbor sort retains similarity desc, overlap desc, id asc.
- **Explanations/fallback:** unchanged (`summaryFor`, `COLLABORATIVE_*` summaries, truthful fallback strategies).
- **Documented selection policy impact:** when users/anchors exceed bounds, deterministic preselection (overlap/strength relevance) may change which neighbors/anchors are considered vs. an unbounded run. This is an intended tradeoff for the bound but can change recommendations; it is deterministic and now partially documented.

**Benchmarks (existing results, not re-run to avoid overwriting untracked output during review; remediation ran them):** `benchmarks/results.json` records 18 scenarios including 4 R-01/S-01 focused cases, all `collaborative` where expected. Not worst-case at hard maxima. Machine-specific, not guarantees.

## 8. Security and resource-exhaustion concerns (remaining)

1. **Item-based total similarity evaluations not bounded to `maxCollaborativeComparisons` (acceptance-relevant).** Candidate multiplication allows very large `computeSimilarity` counts under valid config (`maxItems` × anchors). This leaves a **predictable upper bound on anchors but not on total expensive similarity calculations** for item-based.
2. **`maxCollaborativeComparisons` naming/contract misleading for item-based** (anchor cap vs total comparisons). Can cause operators to misconfigure or overestimate protection.
3. **`auto` collaborative** may try user-based then item-based when user is inapplicable, compounding cost (each path still uses current bounds).
4. **Preselection work** (overlap counting/sorts) is bounded by interaction/model size, not by a dedicated small cap; usually smaller than unbounded similarity but not zero.
5. **Unverified:** browser/Safari/WebKit, OS network isolation, peak memory, worst-case hard-max runtime. Dev-only `npm audit` moderate findings remain (no runtime deps; `--omit=dev` clean).

## 9. Sufficiency for Phase 3 acceptance

- **R-01 (user-based):** remediation is **genuine and correctly enforced** for the similarity-comparison phase (bounded before similarity, deterministic, `maxNeighbors` distinct). Sufficient on this specific path.
- **S-01 (item-based):** remediation provides a **deterministic anchor cap** and is implemented correctly for anchor selection, but **does not provide a genuine per-request upper bound on total expensive similarity calculations** because eligible candidate count multiplies anchor evaluations. The limit name/contract is also misleading for this behavior.

Given the audit objective (“genuine, predictable upper bound on expensive collaborative computations”), item-based fails that criterion under valid large-candidate configurations.

## 10. Final recommendation

**REMEDIATION REQUIRED**

**Required follow-up (for acceptance confidence on R-01/S-01):** make item-based total similarity work genuinely bounded/predictable under valid config (e.g., enforce a true total comparison budget across `candidates × anchors` with deterministic truncation/selection semantics, or restructure evaluation with an explicit capped work budget and clear behavior), and correct the `maxCollaborativeComparisons` contract/name/docs to match actual semantics (or split limits if needed) with backward-compatible migration. Add tests that assert actual `comparisonsEvaluated`/total similarity-call bounds under multiplication cases.

*This re-audit does not formally accept Phase 3 and does not authorize Phase 4.*
