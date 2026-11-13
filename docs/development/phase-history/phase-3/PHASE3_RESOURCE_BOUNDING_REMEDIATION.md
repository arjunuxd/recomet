# PHASE3_RESOURCE_BOUNDING_REMEDIATION.md

**Project:** Recomet (`F:\Recomet`)  
**Task:** Remediate Phase 3 audit findings **R-01** and **S-01** from `PHASE3_FINAL_SECURITY_AND_LOGIC_AUDIT.md` (resource bounding for collaborative similarity comparisons)  
**Date:** 2026-11-06  
**Scope:** Phase 3 collaborative-only. No Phase 4/hybrid work. No dependency/lockfile changes. No commits/push/tags/publish. Existing user-owned modified/untracked work preserved.

## 1. Original findings addressed

- **R-01 (Medium, non-blocking condition in final audit):** “Derived collaborative work can be expensive within nominal input limits.” User-based evaluated similarity against all other users in the model (neighbors capped after), and item-based evaluated all target liked-item anchors per candidate. CPU cost could grow substantially with large `maxInteractions`/`maxItems` and dense data.
- **S-01 (Low, audit):** “Item-based collaborative path has no dedicated cap on target-user liked-item similarity anchors.” Item-based computed similarity between each eligible candidate item’s user map and **all** target-user liked items, with work scaling roughly `eligible_candidates * target_liked_items * similarity_cost`. No `maxNeighbors`/liked-item cap analogous to user-based.

Source: `PHASE3_FINAL_SECURITY_AND_LOGIC_AUDIT.md` §§3 (S-01), 5 (R-01), 10, 11.

## 2. Root cause

- **User-based (`collectUserBased`, `src/candidates/collaborative.ts`):** iterated over `model.userItems.entries()` for every other user and called `computeSimilarity(...)` (cosine/Jaccard with normalized-strength math) for each, before applying `topSimilarities(..., collaborative.maxNeighbors)`. The comparison count was bounded only indirectly by input size (`maxInteractions`/population), not by an explicit comparison budget applied *before* expensive similarity calculations.
- **Item-based (`collectItemBased`):** for every eligible candidate item, iterated over **all** `targetItems.entries()` (target-user liked-item anchors) and computed `computeSimilarity` between the candidate item’s user map and each liked item’s user map. No explicit anchor bound or comparison budget was applied before similarity calculations.

Both paths were deterministic given current JS `Map` insertion order from request-scoped model construction, but lacked explicit resource bounds and (for item-based) explicit anchor selection.

## 3. Exact implementation changes

| File | Change |
|---|---|
| `src/internal/limits.ts` | Added `maxCollaborativeComparisons` to `LIMIT_KEYS`, `ResolvedEngineLimits`, `LIMIT_BOUNDS` (**min 1, max 50,000, default 5,000**), and `resolveLimitDefaults()`. Documented as R-01/S-01 comparison/anchor bound applied before expensive similarity math with deterministic selection. |
| `src/contracts/config.ts` | Added optional `EngineLimits.maxCollaborativeComparisons?: number` with JSDoc (user-based: max other users compared before neighbor selection; item-based: max target-user liked-item anchors used before similarity calculations). Backward-compatible optional field. |
| `src/validation/config.ts` | Resolved `maxCollaborativeComparisons` via existing generic limit validation (safe integer within `LIMIT_BOUNDS`; unknown limit keys still rejected). Existing configs/defaults preserved. |
| `src/candidates/collaborative.ts` | **R-01 user-based:** added deterministic preselection `selectComparisonUsers()` that builds overlap counts from `model.itemUsers` for target items, ranks by **overlap count desc, userId asc** (deterministic, relevance-oriented; only overlapping users can satisfy `minOverlap >= 1`), and limits comparisons to `limits.maxCollaborativeComparisons` **before** calling `computeSimilarity`. Preserved `maxNeighbors` neighbor selection after comparison (`topSimilarities` still applies `collaborative.maxNeighbors`). Restored `similarity.id` assignment to compared `userId` (required for neighbor lookup) and preserved `support` counting / scoring behavior. **S-01 item-based:** added deterministic anchor preselection `selectItemAnchors()` ranking target liked items by **`Math.abs(strength)` desc, `likedItemId` asc** (stronger interactions more relevant), limited to `limits.maxCollaborativeComparisons` **before** the per-candidate similarity loop. Preserved candidate generation, target-interacted item exclusion, and `support`/scoring behavior. Added internal collection metrics on `CollaborativeCollection`: `comparisonsEvaluated`, `usersConsidered`, `neighborsOrAnchorsSelected` (distinguishes comparisons/users considered from neighbors/anchors selected; internal, non-breaking additive fields). |
| `src/engine/pipeline.ts` | Passed `limits: config.limits` into `CollaborativeCandidateContext` base (required by updated context type). No strategy/fallback/result semantics changed. |
| `tests/collaborative.test.ts` | Added `maxCollaborativeComparisons` to `testLimits`; added R-01/S-01 resource-bounding tests (see §6). Fixed test file structure after append (kept new describe inside outer Phase 3 describe). |
| `benchmarks/run.mjs` | Extended `makeCollaborativeData` to support larger target histories and deterministic target/neighbor overlap for stable collaborative benchmark scenarios; added focused bounded scenarios: `r01-user-2k-users-comparison-bounded`, `r01-user-2k-users-jaccard-bounded`, `s01-item-large-target-history-bounded`, `s01-item-large-target-history-jaccard-bounded`. (Bench script overwrites `benchmarks/results.json`; inspected before run.) |
| `README.md` | Minimal doc update listing `maxCollaborativeComparisons` in collaborative limits (tracked modified file; intent preserved). |

**Implementation note (transparency):** an initial rewrite of `collaborative.ts` introduced two regressions (missing `similarity.id = userId` assignment for user-based neighbor lookup; incorrect `collaborativeScore` call arity/support handling) and a test-file nesting issue from append. These were caught by typecheck/tests, corrected, and the final state passes all verification below.

## 4. New limits and their rationale

| Limit | Default | Min | Max | Rationale |
|---|---:|---:|---:|---|
| `limits.maxCollaborativeComparisons` | 5,000 | 1 | 50,000 | Explicit, validated safe-integer bound on collaborative similarity work. **User-based:** caps other users compared before neighbor selection (R-01). **Item-based:** caps target-user liked-item anchors used before similarity calculations (S-01). Applied *before* expensive similarity math to provide predictable resource protection. Default is high enough to avoid changing typical workloads while bounding worst-case derived comparisons; hard max prevents unsafe configuration. Exposed as optional on public `EngineLimits` for backward compatibility; resolved config always supplies a value. |

Existing limits unchanged: `maxInteractions`, `maxItems`, `maxCollaborativeNeighbors` (neighbor selection cap / config ceiling), etc. `maxCollaborativeComparisons` is distinct from `collaborative.maxNeighbors` (selected neighbors) and from `maxCollaborativeNeighbors` (ceiling for `maxNeighbors`).

## 5. Deterministic selection behavior

- **R-01 user-based comparison selection (`selectComparisonUsers`):**
  1. Build overlap counts for other users that share at least one item with the target, using `model.itemUsers` over target items.
  2. Rank candidates by **overlap count descending**, then **userId ascending** (code-unit string comparison, deterministic).
  3. Select up to `maxCollaborativeComparisons` users. **No non-overlapping fill** because `computeSimilarity` requires `overlap >= minOverlap` and Phase 3 validates `minOverlap >= 1`; comparing non-overlapping users cannot produce eligible similarity.
  4. Compute similarity **only** for selected users (before neighbor selection). Select top neighbors from compared results by similarity desc / overlap desc / id asc, capped by `collaborative.maxNeighbors`.
  - **Users considered/compared** = number of similarity computations performed (bounded). **Neighbors selected** = `topSimilarities` result count (<= `maxNeighbors`). These are distinguished.

- **S-01 item-based anchor selection (`selectItemAnchors`):**
  1. Collect target-user liked items `(likedItemId, userStrength)`.
  2. Rank by **`Math.abs(userStrength)` descending**, then **`likedItemId` ascending** (deterministic; stronger anchors are more relevant to the request).
  3. Select up to `maxCollaborativeComparisons` anchors **before** candidate similarity loop.
  4. For each eligible candidate item, compute similarity only against selected anchors (comparisons counted). Candidate generation and target-interacted item exclusion rules preserved.

- **Determinism:** selection uses explicit sorts/tie-breakers; does not rely on arbitrary choice when bounds are exceeded. JS `Map` insertion order is deterministic for constructed models, but selection outputs are made explicit.

## 6. Tests added and exact results

Added in `tests/collaborative.test.ts` under **`R-01/S-01 resource bounding (collaborative comparisons)`** (16 tests):

- Validates `maxCollaborativeComparisons` as a safe bounded integer (rejects 0, -1, 1.5, >50,000; accepts 1).
- **R-01 user-based:** below comparison limit compares all overlapping users; at limit deterministic; above limit uses deterministic relevance-oriented selection (no arbitrary) with a concrete oracle-like expectation (strongest-overlap neighbor selected, weaker-only recommendations excluded); distinguishes comparisons from `maxNeighbors` selection; large user population bounded deterministically; Jaccard under bounds; empty/sparse falls back safely.
- **S-01 item-based:** below anchor limit uses all anchors; at/above limit uses deterministic relevant anchors (strongest anchor selected, weaker-anchor-only recommendation excluded); large target history bounded deterministically; large candidate set with bounded anchors; Jaccard under bounds; preserves exclusion of target-interacted items.
- Preserves F-02/F-03/F-04 semantics under bounded comparisons; no input mutation under bounded comparisons.

Coverage also exercises existing normalization/interaction semantics (F-02/F-03/F-04), fallback behavior, both methods/similarities, empty/sparse cases, determinism/idempotence patterns, and no-mutation/non-retention expectations through existing and added tests.

**Exact test results (2026-11-06, `F:\Recomet`):**

```text
> @recomet/core@0.1.0 test
> vitest run

 Test Files  13 passed (13)
      Tests  255 passed (255)
   Duration  4.40s
```

(Counts increased from 239 to 255; no failures, no skips.)

## 7. Benchmark results

Benchmarks run via `npm run bench` (builds first, `node --expose-gc benchmarks/run.mjs`), which overwrote `benchmarks/results.json` (inspected; untracked output). Results are **synthetic, local, machine-specific measurements — not performance guarantees**. “After call” heap includes unreclaimed garbage; final heap sampled after explicit GC when available; not peak-memory measurements.

**Environment (from run):** Node `v24.18.0`, V8 `13.6.233.17-node.50`, Windows `win32 10.0.26300`, `11th Gen Intel(R) Core(TM) i3-1125G4 @ 2.00GHz`, 8 logical CPUs.

**Focused R-01/S-01 scenarios added:**

| Scenario | Strategy | N items | Users | Interactions/user (target) | Limit | maxCollaborativeComparisons | Method/Similarity | p50 ms | p95 ms | mean ms | ops/s | Returned | Eligible |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| `r01-user-2k-users-comparison-bounded` | collaborative | 2,000 | 2,000 | 10 (10) | 20 | 500 | user/cosine | 43.408 | 65.673 | 47.519 | 21.0 | 20 | 1,991 |
| `r01-user-2k-users-jaccard-bounded` | collaborative | 2,000 | 2,000 | 10 (10) | 20 | 500 | user/jaccard | 45.339 | 57.101 | 45.517 | 22.0 | 20 | 1,991 |
| `s01-item-large-target-history-bounded` | collaborative | 2,000 | 300 | 8 (400) | 20 | 50 | item/cosine | 15.616 | 19.648 | 15.997 | 62.5 | 20 | 1,830 |
| `s01-item-large-target-history-jaccard-bounded` | collaborative | 2,000 | 300 | 8 (400) | 20 | 50 | item/jaccard | 16.478 | 23.064 | 16.707 | 59.9 | 20 | 1,830 |

**Comparison/complexity notes (qualitative, scenario-specific):**
- **R-01:** user-based now evaluates similarity for at most `maxCollaborativeComparisons` deterministically selected overlapping users (500 in bounded scenarios) **before** `maxNeighbors` selection, instead of all other users. Worst-case similarity evaluations are bounded by the comparison limit; preselection adds overlap counting/sorting over target-related users (cheap map lookups + sort of overlap candidates) but avoids unbounded expensive similarity math.
- **S-01:** item-based uses at most `maxCollaborativeComparisons` target anchors (50 in bounded scenarios) **before** similarity calculations. Per eligible candidate, similarity calls are bounded by anchors (minus self-anchor checks), reducing worst-case from `eligible_candidates * target_liked_items` to `eligible_candidates * min(target_liked_items, maxCollaborativeComparisons)` similarity evaluations.
- Existing collaborative benchmark scenarios also completed successfully after the deterministic overlap adjustment in the bench data generator (required to keep strategy assertions stable); their timings changed relative to prior runs and are machine-specific.

No universal performance guarantee is claimed.

## 8. Security and privacy impact

- **Positive:** explicit comparison/anchor bounds reduce worst-case CPU cost for derived collaborative work (R-01/S-01), improving predictability against large valid inputs within nominal limits. Bounds are validated (safe positive integers, hard maxima) and applied before expensive similarity math.
- **No new sensitive data exposure:** added fields are numeric limit/config values and internal counters; no raw user IDs, item IDs, interaction values, or user data added to errors/results/explanations.
- **Preserved non-negotiables:** zero runtime dependencies (`npm audit --omit=dev` 0 vulnerabilities); no runtime network calls/telemetry/tracking/external AI services added; in-memory per-request processing only; no persistence/hidden retention/cross-application data sharing added. Input mutation/retention tests pass for bounded paths.
- **Determinism:** bounded selection is explicit and deterministic (documented sort keys), avoiding silent arbitrary truncation.

## 9. Remaining limitations

- Formal **Phase 3 acceptance not granted**; Phase 4/hybrid not started.
- `maxCollaborativeComparisons` is a **single bound** applied as user-comparison cap (R-01) and item-anchor cap (S-01). This is explicit and minimal, but semantics differ by method; default/max may need tuning based on future benchmarks/workloads.
- Bounded preselection can change results compared to unbounded comparison when populations/target histories exceed the cap (by design). Selection is deterministic and relevance-oriented, but may omit some globally strong neighbors/anchors outside the selected set.
- Not run/reverified in this session: browser runtime, Safari/WebKit, OS-level network isolation, peak-memory profiling. Dev-only `npm audit` still reports **10 moderate** (`minimatch` ReDoS chain, ESLint/tooling); no fix applied.
- Quality/effectiveness claims are out of scope; no universal performance guarantee.

## 10. Git status and files changed

**`git status --short` (end of remediation):**

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
?? PHASE3_RESOURCE_BOUNDING_REMEDIATION.md
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

**Implementation-relevant files changed/created for R-01/S-01 (all pre-existing modified/untracked except this report):**
- Modified (tracked): `README.md`
- Modified/created in working tree (untracked in this repo state): `src/internal/limits.ts`, `src/contracts/config.ts`, `src/validation/config.ts`, `src/candidates/collaborative.ts`, `src/engine/pipeline.ts`, `tests/collaborative.test.ts`, `benchmarks/run.mjs`, `PHASE3_RESOURCE_BOUNDING_REMEDIATION.md` (new report)
- Regenerated (gitignored): `dist/` (via build/bench). `benchmarks/results.json` overwritten by bench (untracked output).

**All existing user-owned modified/untracked work preserved.** No destructive git commands, no dependency/lockfile changes, no commits/push/tags/publish.

## 11. Exact verification summary

| Check | Result |
|---|---|
| `npm run typecheck` | PASS (`tsc -p tsconfig.json`) |
| `npm run lint` | PASS (`eslint .`) |
| `npm run format:check` | PASS (all matched files Prettier) |
| `npm test` | PASS — **13 files, 255 tests passed, 0 failed/skipped** |
| `npm run build` | PASS (clean + `tsc -p tsconfig.build.json`) |
| `npm audit --omit=dev` | PASS — **0 vulnerabilities** |
| `npm audit` (read-only) | **10 moderate**, 0 high/critical (`minimatch` `GHSA-g3hv-75wg-m249`, dev ESLint/tooling chain); no fix applied |
| `npm run bench` | PASS — all scenarios completed; 4 focused R-01/S-01 bounded scenarios returned `collaborative` (see §7). Overwrote `benchmarks/results.json`. |

## 12. Recommendation

**READY FOR INDEPENDENT RE-AUDIT**

R-01/S-01 are addressed with explicit, validated, deterministic comparison/anchor bounds applied before expensive similarity calculations; existing collaborative semantics, fallback behavior, and prior F-01–F-04 fixes are preserved; verification and focused benchmarks pass. Phase 3 is **not** formally accepted and Phase 4 must not start.
