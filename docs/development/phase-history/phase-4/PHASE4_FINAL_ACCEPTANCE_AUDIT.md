# PHASE4_FINAL_ACCEPTANCE_AUDIT

**Project:** Recomet (`@recomet/core`)  
**Repository (local):** `F:\Recomet`  
**Remote (reference):** `https://github.com/arjunuxd/recomet.git`  
**Audit date:** 2026-11-07  
**Audit scope:** Phase 4 — Hybrid Recommendation (explicit `hybrid`, availability-aware fusion)  
**Audit type:** Independent, read-only acceptance review  
**Auditor stance:** Evidence-driven; implementation/tests inspected directly. Documentation and implementation reports treated as intent/context, not proof.

---

## 1. Executive summary

Phase 4 implements an explicit `hybrid` strategy with availability-aware weighted fusion, preserves `auto` behavior, reuses the request-scoped collaborative similarity-evaluation budget, and adds bounded hybrid weight configuration (`HYBRID_WEIGHT_MAX=1000`, both-zero rejected). Core formula/availability behavior observed in code and tests is consistent with `PHASE4_SPECIFICATION.md` and `PHASE4_DESIGN_APPROVAL.md`: missing collaborative evidence is not fabricated as zero (absence-based availability in `hybridScore` / pipeline), valid content `0` remains available, zero weights disable components, denominator guards prevent division by zero, and neither-signal explicit-hybrid requests return a truthful baseline fallback (`strategy: "baseline"` with hybrid fallback summary).

Local verification executed read-only relative to tracked intent (standard project commands; no formatting/apply commands run): `npm run typecheck` pass, `npm run format:check` pass, `npm test` pass (**14 files, 277 tests**). Prior implementation-audit evidence reports `npm run lint`, `npm run build`, `npm pack --dry-run`, `npm audit --omit=dev` (0 vulnerabilities) passing; full `npm audit` reports 10 moderate dev-only ESLint/minimatch advisories (no runtime dependencies). I did not re-run lint/build/pack/audit in this session to minimize command surface; those results are recorded as previously evidenced, not re-verified here.

No Critical or High defects were identified in the reviewed Phase 4 source, validation, pipeline, scoring, budget reuse, or relevant tests. Material non-blocking gaps/conditions remain: acceptance-criteria golden-vector coverage does not include every G1–G10 case as an exact named/spec-input vector test (coverage is partial via behavioral/golden-math tests); no dedicated hybrid benchmark scenarios were added; Safari/WebKit, OS-level network isolation, peak memory, and worst-case hard-limit performance remain unverified; dev-only audit advisories remain; JS proxy inspection remains an unavoidable runtime limitation (not sandboxed).

---

## 2. Final verdict

**APPROVE WITH CONDITIONS**

No Critical or High finding was identified. Phase 4 is close to formal acceptance for the approved scope, but the conditions in §14 must be satisfied, explicitly accepted as limitations, or tracked with maintainer-approved follow-up before declaring formal acceptance complete.

---

## 3. Repository state and audit scope

### 3.1 Recorded repository state (before evidence gathering)

- `git status --short`:
  - ` M README.md`
  - `??` untracked: `.gitignore`, `.prettierignore`, `.prettierrc.json`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `LICENSE`, `PHASE2_ACCEPTANCE.md`, `PHASE3_ACCEPTANCE.md`, `PHASE3_FINAL_SECURITY_AND_LOGIC_AUDIT.md`, `PHASE3_RESOURCE_BOUNDING_REAUDIT.md`, `PHASE3_RESOURCE_BOUNDING_REMEDIATION.md`, `PHASE3_TOTAL_SIMILARITY_BUDGET_INDEPENDENT_AUDIT.md`, `PHASE3_TOTAL_SIMILARITY_BUDGET_REMEDIATION.md`, `PHASE4_ACCEPTANCE_CRITERIA.md`, `PHASE4_ARCHITECTURE.md`, `PHASE4_DESIGN_APPROVAL.md`, `PHASE4_IMPLEMENTATION_AUDIT.md`, `PHASE4_RISK_REGISTER.md`, `PHASE4_SPECIFICATION.md`, `PRIVACY.md`, `ROADMAP.md`, `SECURITY.md`, `SPECIFICATION.md`, `benchmarks/`, `eslint.config.js`, `package-lock.json`, `package.json`, `scripts/`, `src/`, `tests/`, `tsconfig.build.json`, `tsconfig.json`, `vitest.config.ts`
- Branch: `main`
- Latest commit: `35e0f1f first commit`
- `PHASE4_FINAL_ACCEPTANCE_AUDIT.md` did not exist in the recorded status; creating it is safe (no overwrite of existing user work observed).

### 3.2 Audit scope

**In scope:** Phase 4 hybrid implementation and directly affected contracts/validation/pipeline/scoring/budget integration; Phase 1–3 regression surface as exercised by existing tests and inspected shared code; security/privacy/public-API/compatibility/resource-bound claims relevant to Phase 4.

**Out of scope / not performed:** source/test/config/dependency/lockfile/docs/benchmark/Git-state modifications; fixes; Phase 5; Safari/WebKit execution; OS-level network isolation; peak-memory measurement; dependency upgrades; destructive Git operations; commit/push/tag/release/publish.

**Commands run during this audit session (read-only intent):** `git status --short`, `git branch --show-current`, `git --no-pager log -1 --oneline`, `Test-Path` check for this report file, `npm run typecheck`, `npm run format:check`, `npm test`. No repository files were modified by these commands as part of audit remediation; `npm test`/tooling may produce normal ephemeral worker/process activity but no intentional tracked/untracked content changes were made.

---

## 4. Phase 4 specification-to-implementation mapping

| Spec/approval area | Implementation evidence | Tests/evidence | Assessment |
|---|---|---|---|
| `hybrid` explicit only; `auto` unchanged | `config.strategy` accepts `hybrid` (`src/validation/config.ts:140-143`); request resolves `hybrid` only for `config.strategy==='hybrid'` (`src/validation/request.ts:238,251-252`); `auto` path unchanged (`253-257`); pipeline uses `request.strategy`; auto-collaborative/auto-content behavior preserved structurally | `tests/hybrid.test.ts` “auto strategy remains unchanged…”; full suite 277 pass incl. existing strategy tests | **Satisfied** (behavioral) |
| Availability-aware fusion; missing CF not zero | `hybridScore` takes `collaborativeScore?: number` and only adds collaborative component when defined and weight > 0 (`src/ranking/score.ts:185-223`); pipeline builds CF by `cfByItem.get` and omits when absent (`src/engine/pipeline.ts:247-259`) | Golden “missing collaborative evidence is not fabricated as zero” (`tests/hybrid.test.ts:430-449`), G2/G10-style cases | **Satisfied** |
| Truthful fallback/reporting | Neither-signal hybrid -> `baselineScore()` + `HYBRID_FALLBACK_BASELINE_SUMMARY`, result `strategy:'baseline'` (`src/engine/pipeline.ts:232-243`); CF-only/content-only summaries selected truthfully (`185-193`, `283-288`) | G4 test (`137-148`); summary assertions | **Satisfied** |
| All eligible items ranked; exclusions/target-interacted preserved | Pipeline builds all eligible candidates by iterating `request.items`, skipping `excludedIdsForCF`; CF target-interacted exclusion applied when collaborative context exists even if CF not collected (`215-228,246-251`) | “includes all eligible request items…”; “excludes target-interacted items even when collaborative weight is zero” | **Satisfied** |
| Weights defaults 1/1, finite/non-negative/bounded, zero disables, both-zero invalid | `resolveHybrid` defaults 1/1 (`src/validation/config.ts:452-489`); `HYBRID_WEIGHT_MAX=1000` (`69,441-448`); both-zero rejected (`484-486`); unknown keys rejected (`459-473`) | `tests/hybrid.test.ts` config cases incl. G9-equivalent | **Satisfied** |
| Public contracts/types/TS compatibility documented | `StrategyId` includes `'hybrid'` (`src/contracts/result.ts:3`); config/result/request contracts updated; `ScoreFactor` adds aggregate `'content'` (`8-10`); exports include hybrid config types (`contracts/index.ts`, root export path) | config/public-api/hybrid tests; typecheck pass | **Mostly satisfied**; exhaustive-switch impact is an additive contract change (maintainer-facing compatibility note remains relevant) |
| Support-aware weighting deferred | No confidence/support-weight formula added in hybrid fusion beyond existing CF internals; `hybridScore` uses global weights only | Code inspection | **Satisfied** |
| Budget reused, never reset/replenished | `collaborativeBudget` created once per request when `collaborativeRequested || hybridWantsCF` (`src/engine/pipeline.ts:149-151`); passed to each `collectCollaborative` call; never recreated/reset in reviewed flow | Budget test with mock counts <=2 (`tests/hybrid.test.ts:334-355`); collaborative budget tests (existing suite) | **Satisfied** for reviewed paths |
| Safety/privacy/no sensitive leakage | Value-free `INTERNAL_ERROR` for unexpected request inspection failures (`src/validation/request.ts:361-369`); safe summaries/components; no user IDs/interactions/preferences in result components | proxy tests; hybrid leakage/summary tests | **Satisfied** for reviewed/tested paths; proxy inspection not sandboxed (inherent limitation) |

---

## 5. Mathematical correctness findings

### 5.1 Formula and availability (evidence)

`src/ranking/score.ts` `hybridScore` (185-223): uses `hasContent = input.contentScore !== undefined && input.contentWeight > 0`, `hasCollaborative = input.collaborativeScore !== undefined && input.collaborativeWeight > 0`. Components are added only when active; `combineScore` computes weighted sum with normalized contributions and clamp/finite guards (38-90). Division by total weight occurs only inside `combineScore` with `totalWeight > 0 ? ... : 0`; if no components, `hybridScore` returns score 0 with empty components (213-215). Config validation rejects both-zero weights (`src/validation/config.ts:484-486`), preventing a normal valid-config both-zero denominator case; runtime remains defensive.

Pipeline (`src/engine/pipeline.ts:245-259`): `cf` is obtained from `cfByItem.get(item.id)` only when `cfCollection` exists; `cf?.score` is passed as `collaborativeScore` (undefined when absent). Thus missing CF evidence is represented as absence, not `0`. Content score is computed from `contentScore(item.signals ?? EMPTY_SIGNALS, preferences, weights)` when usable preferences exist (253-255), so a valid content value of `0` is passed as a number (available signal) — consistent with tests.

### 5.2 G1–G10 mapping (acceptance criterion)

| Spec case | Exact spec vector present as test? | Evidence / note |
|---|---:|---|
| G1 both active (0.8,0.5,1,1 => 0.65) | **No** (principle covered) | `tests/hybrid.test.ts` “G1” uses different inputs; asserts both components and score bounds, not `0.65`. Golden 0.75 and 0.7 tests prove fusion math on other exact vectors. |
| G2 content only, CF missing for item | **Partial** (principle/exact-ish) | Test yields content-only score 1.0 and 1 component; demonstrates “not treated as zero”. Different S_c from spec table. |
| G3 CF only, no content | **Partial** | Collaborative-only behavior/components checked; exact 0.5 not asserted for spec setup. |
| G4 neither request-level => baseline | **Yes (behavioral)** | Reports `baseline` + hybrid fallback summary. |
| G5 custom weights 0.6/0.4 => 0.68 (0.8,0.5) | **No** (different exact vector exists) | Named G5 test uses weak bounds; separate golden test asserts exact `0.7` for `S_c=0.5,S_f=1.0,w_c=0.6,w_f=0.4`. |
| G6 content disabled by zero weight | **Yes** | Collaborative-only components asserted. |
| G7 CF disabled by zero weight | **Yes** | Content-only score 1.0 asserted. |
| G8 content 0 valid | **Yes** | Score 0, content component value 0. |
| G9 both-zero invalid config | **Yes** | `INVALID_CONFIG`. |
| G10 CF usable, item no evidence => content-only | **Yes (principle)** | Content-only score 1.0, content component present. |

**Conclusion:** Mathematical implementation is consistent with the approved formula in reviewed code and passes exact golden tests for key arithmetic cases (0.75, 0.7, 0.8-not-fabricated, 0.0-valid-content). However, the acceptance criterion states “Golden-vector tests cover every signal-availability combination…” including the listed G1–G10 cases; not all are present as exact spec-table vectors. This is tracked as **F-01 (Medium, non-blocking condition)**.

### 5.3 Numeric safety

- `combineScore` validates finite `[0,1]` values and finite non-negative weights; throws `RangeError` internally on invalid numeric state (44-64). `hybridScore` clamps unit values (165-176, 202, 209, 218). Pipeline final candidate validation rejects non-finite/out-of-range scores (`src/engine/pipeline.ts:261-263`) and guards ranking errors (`275-278`). Config/weight validation rejects NaN/Infinity/out-of-range weights.

---

## 6. Candidate, exclusion, and fallback findings

- **Eligible universe:** Hybrid iterates all `request.items` and can produce a candidate for any non-excluded item with no CF evidence, using content/baseline-or-fallback scoring path (`src/engine/pipeline.ts:246-272`). CF collection is not required for content-only items.
- **Exclusions:** Request exclusions always applied (`246-251`). When collaborative context exists, target-interacted items are excluded from the CF/hybrid ranking universe via `excludedIdsForCF` union (`215-228`). This applies even when `config.hybrid.collaborativeWeight` is 0 because the union is computed when `collaborativeContext` exists, while CF collection is separately gated by `hybridWantsCF` (174, 230). Matches approved semantics and test.
- **`auto` unchanged:** `auto` resolves in request validation as before (`253-257`), never to `hybrid`. Pipeline `auto` collaborative behavior remains separate branch (86-147). Test confirms.
- **Fallback truthfulness:** No-fusable-signal hybrid path returns `baselineScore()` candidates but `result.strategy` is `baseline` and explanation summary is `HYBRID_FALLBACK_BASELINE_SUMMARY` (`232-243`, `formatResult` uses `request.strategy` so top-level becomes `'baseline'`). This is truthful and avoids mislabeling as hybrid fusion.
- **Duplicate processing:** CF collected once when `hybridWantsCF` (230-241). Content computed per eligible item in a single fusion pass; no second full CF collection observed.

**Finding:** No blocking candidate/exclusion/fallback defect found.

---

## 7. Collaborative budget and resource findings

- **Budget primitive:** `src/collaborative/budget.ts` is request-scoped mutable state by design (consumed/exhausted) but created per request; no module-global budget state.
- **All `computeSimilarity` call sites (source):** `src/candidates/collaborative.ts:146` (user-based) and `336` (item-based) — both immediately after `tryConsumeSimilarityEvaluation(budget)` success. `computeSimilarity` is defined in `src/collaborative/similarity.ts` and imported only by `collaborative.ts` and tests (mock target). No alternate production path found.
- **Hybrid reuse/no reset:** Pipeline creates one budget for `collaborativeRequested || hybridWantsCF` and passes it to `collectCollaborative`; no reset/replenish calls. Hybrid uses CF once (not the multi-attempt auto CF loop).
- **Exhaustion behavior:** deterministic in collaborative collector (ordered users/anchors, fair allocation, break on budget exhaustion). Hybrid receives whatever CF map was produced; missing evidence becomes absent components (safe).
- **Resource claim boundary:** Correctly scoped to actual `computeSimilarity` invocations per request. Not a bound on all CPU/memory, sorting, model construction, validation, candidate formatting, or other work. Docs/acceptance language in inspected files generally state this boundary; maintainer should ensure release-facing docs keep the same narrow claim.

**Finding:** No blocking budget/resource defect found. Unverified: peak memory and worst-case hard-limit performance (accepted condition category).

---

## 8. Security and privacy findings

### 8.1 Validation and hostile inputs

- Config/request validation uses allowlisted keys, plain-object assertions, descriptor-safe own-key/property access patterns (`readDataProperty`, `ownStringKeys`, `assertPlainRecord`, `UnsafeStructureError` handling), bounded lengths/counts, and typed `RecometError` categories. Hybrid weights validated as finite/non-negative/`<=1000`; unknown hybrid/weight keys rejected.
- Request validation catches unexpected non-`RecometError` failures and returns `new RecometError('INTERNAL_ERROR', 'An internal error occurred.')` without leaking raw error details (`src/validation/request.ts:361-369`). Expected structural `INVALID_*` and `UnsafeStructureError`-mapped request errors are preserved.
- Proxy tests (`tests/proxy.test.ts`) cover revoked proxies, throwing traps, config inspection failures, benign descriptor access avoiding `get` traps where designed, and the invariant that hostile cases throw `RecometError`/safe `INTERNAL_ERROR` to callers. **Limitation:** JS proxies cannot be reliably contained; traps may execute during inspection. Code/tests must not claim sandboxing.

### 8.2 Privacy / leakage

- Explanations/components contain strategy labels, summaries, factors (`baseline`, preference kinds in content paths, `content`, `collaborative`), numeric value/weight/contribution — no raw preference labels/values, user IDs, or interaction records. Targeted hybrid tests assert JSON serialization excludes `secret-user`, `USER_SECRET_123`, `OTHER_USER_456`, and `private-event`.
- Pipeline/validation operate on in-memory request data for the call; no persistence/network/telemetry APIs added in reviewed Phase 4 runtime source.

### 8.3 Dependencies/runtime surface

- Zero runtime dependencies policy preserved per package evidence and implementation audit; `npm audit --omit=dev` reported 0 in prior evidence. Full audit has 10 moderate dev-only advisories (ESLint/minimatch chain) — not a Phase 4 runtime blocker but should remain tracked.

### 8.4 Security/privacy classification

- **Critical:** none identified.
- **High:** none identified.
- **Medium/Low/Informational:** see §13.

---

## 9. Public API and compatibility findings

- `StrategyId` now `'baseline' | 'content' | 'collaborative' | 'hybrid'` (`src/contracts/result.ts`). Additive but affects exhaustive TypeScript switches in consumer code — documented as a known compatibility implication in Phase 4 docs/approval; this is acceptable for the approved Phase 4 contract change.
- `RecommenderConfig` includes `hybrid?: HybridStrategyConfig`; request still accepts `preferences`, `userId`, `interactions` as before (hybrid may use them together; baseline/content/collaborative restrictions preserved in request validation). Hybrid-specific: no new required request fields beyond existing strategy semantics.
- `runPipeline` exported/aliased in `src/engine/pipeline.ts` (338). Root public exports are controlled through `src/index.ts`/contracts; internal pipeline export is not necessarily part of the documented public API unless re-exported — maintainers should confirm intended surface (informational).
- Types/runtime validation/defaults for hybrid weights are consistent: default 1, max 1000, both-zero invalid, unknown keys rejected.
- Existing strategy contracts preserved as exercised by full suite.

**Finding:** No blocking public API/compatibility defect found in reviewed scope.

---

## 10. Test coverage assessment

- **Suite:** 14 files, 277 tests passing (typecheck/format also pass in this session). Includes `tests/hybrid.test.ts` (26 tests), plus config, public-api, proxy, content-security, collaborative, and other regression suites.
- **Strengths:** covers hybrid config validation, both-zero rejection, unknown keys, core availability/fallback behaviors, exclusion/target-interacted (including CF weight 0), determinism, input immutability, leakage checks, shared budget cap via mocked `computeSimilarity`, score bounds, and several exact golden fusions (0.75, 0.7, 0.8 content-only when CF missing).
- **Weaknesses/gaps:**
  - **G1–G10 exact spec vectors not fully present** as named exact-table cases (see §5.2). Some named G-tests assert principles/bounds rather than the spec’s precise numbers.
  - No test explicitly proves a *request-level* CF-unusable hybrid path with content available vs all other permutations as a dedicated matrix beyond covered cases; core paths appear covered.
  - No dedicated adversarial hybrid fuzz/property tests beyond existing proxy/validation style; acceptable for this scope but not exhaustive.
  - Performance/load tests are not acceptance proof.

Coverage is good for a feature of this size, but the explicit golden-vector acceptance criterion is only partially met.

---

## 11. Performance assessment

- `PHASE4_IMPLEMENTATION_AUDIT.md` states no dedicated hybrid benchmark scenarios were added. I did not run benchmarks (risk of file effects/interpretation; accepted benchmark records must not be overwritten without approval). No hybrid-specific numbers are claimed here.
- Pipeline avoids duplicate CF collection in the reviewed hybrid path and reuses bounded budget. Performance remains dependent on candidate counts, content extraction, collaborative model work, and sorting/ranking — not bounded by similarity budget alone.
- **Assessment:** Dedicated hybrid performance evidence is a **documented gap/non-blocking limitation** relative to full optimization confidence, but not automatically a rejection given current acceptance framing. Representative workloads (content-only/collab-only/both/sparse/dense/budget exhaustion/large eligible lists within limits) should be benchmarked in a controlled, non-destructive manner before making hybrid performance claims.

---

## 12. Dependency, package, and platform assessment

| Area | Status | Evidence basis |
|---|---|---|
| Runtime dependencies | Verified zero (policy/design); no additions observed | implementation audit, source inspection |
| `npm audit --omit=dev` | 0 vulnerabilities (previous evidence) | `PHASE4_IMPLEMENTATION_AUDIT.md` |
| `npm audit` (full) | 10 moderate dev-only (ESLint/minimatch chain) | `PHASE4_IMPLEMENTATION_AUDIT.md`; not re-run |
| typecheck/lint/format/tests/build/pack | typecheck/format/tests verified this session; lint/build/pack evidenced previously | command results / implementation audit |
| Node 22 / Node 24 | Historical/project evidence exists; not re-executed in this audit | docs/roadmap/history |
| Real browser execution (Edge/Chrome/Firefox historical) | Historical evidence; not re-executed | project records |
| **Safari/WebKit** | **Unverified** | explicit project limitation |
| **OS-level network isolation** | **Unverified** | explicit limitation |
| **Peak memory** | **Unverified/not measured as guarantee** | explicit limitation |
| Package exports/ESM | Build/pack evidenced; exports reviewed in source | implementation audit, `src/index.ts` |

---

## 13. All classified findings

| ID | Severity | Location | Evidence | Reproduction/reasoning | Impact | Blocks acceptance? | Recommended remediation |
|---|---|---|---|---|---|---:|---|
| F-01 | Medium | `tests/hybrid.test.ts` (G1–G10 coverage) | Named G1/G2/G3/G5 tests do not assert the spec table’s exact numerical vectors (e.g., G1 expects 0.65 for 0.8/0.5/1/1; G5 expects 0.68 for 0.8/0.5/0.6/0.4). Exact golden tests exist for other vectors (0.75, 0.7, 0.8). | Compare `PHASE4_SPECIFICATION.md` §8 / acceptance criterion “Golden-vector tests cover every signal-availability combination…” to actual assertions in `tests/hybrid.test.ts`. | Reduces confidence that every documented canonical example is pinned; acceptance criterion not fully satisfied as written. | **No** (non-blocking if accepted as condition) | Add exact tests for G1–G10 spec-table inputs/expected outputs (or document approved equivalent mapping with rationale) without changing behavior. |
| F-02 | Low | Performance evidence (`benchmarks/`, no dedicated hybrid scenarios) | `PHASE4_IMPLEMENTATION_AUDIT.md` states no hybrid benchmark scenario added; I did not run benchmarks. | Inspect benchmark design/report; confirm no hybrid-specific synthetic scenarios. | Limited performance evidence for hybrid-specific paths; no safe measured numbers to cite. | No | Add non-destructive, synthetic hybrid benchmark scenarios (temp output or approved artifact policy) covering content-only, CF-only, both, sparse/dense, budget exhaustion, large eligible sets within limits. |
| F-03 | Low | Dev dependency audit | Full `npm audit` previously reported 10 moderate dev-only ESLint/minimatch advisories. | `PHASE4_IMPLEMENTATION_AUDIT.md` §3. | No known runtime impact; supply-chain hygiene/repo noise. | No | Upgrade dev toolchain in a separately authorized, scoped change; re-verify lint/test/build. |
| F-04 | Informational | `src/engine/pipeline.ts:338` (`runPipeline` alias) | `export const runPipeline = executePipeline;` | Source inspection. | Internal alias may or may not be intended public/stable; not exported from root index in reviewed path. | No | Confirm intended API surface; document or remove/restrict if internal-only. |
| F-05 | Informational | Hybrid CF method selection when `collaborative.method==='auto'` | Pipeline passes `method: config.collaborative.method === 'auto' ? 'user' : config.collaborative.method` to `collectCollaborative` in hybrid (`src/engine/pipeline.ts:236-237`). | Code inspection. | Reasonable deterministic choice, but not explicitly spelled out in the same way as auto-strategy behavior; could surprise advanced users. | No | Document hybrid’s collaborative method resolution (or make configurable) if behavior is intended to be stable. |
| F-06 | Informational | Platform/measurement limits | Safari/WebKit, OS-level network isolation, peak memory, worst-case hard-limit performance unverified. | Project limitations / audit instructions. | Residual compatibility and resource-assurance uncertainty. | No | Verify on Safari/WebKit when feasible; perform controlled memory/worst-case measurements; document network-isolation test method if claimed. |
| F-07 | Informational | JS proxy boundary | Proxy traps may execute during unavoidable inspection; not sandboxed. | `SECURITY.md`/tests/architecture constraints. | Hostile live JS objects remain a trust-boundary risk for in-process callers. | No | Keep JSON-compatible/untrusted-data boundary and non-sandbox claims explicit in security docs. |

---

## 14. Acceptance conditions (for APPROVE WITH CONDITIONS)

1. **C-01 (F-01):** Maintainer explicitly accepts the current golden-test coverage as sufficient, **or** adds exact G1–G10 spec-table vector tests (behavior-preserving) and records the result.
2. **C-02 (F-02/F-06 subset):** Maintainer explicitly accepts missing dedicated hybrid benchmarks and unverified peak-memory/worst-case/Safari/WebKit/OS-network-isolation status as documented limitations for this acceptance, **or** schedules/executes verification without overwriting approved benchmark evidence.
3. **C-03:** Maintainer confirms public API/contract changes (`StrategyId` includes `hybrid`, aggregate `content` hybrid factor, hybrid config/weights, truthful fallback reporting) are acceptable and release notes/migration guidance cover exhaustive-switch implications.
4. **C-04:** Maintainer reviews and accepts/defers dev-only audit advisories (F-03) with an explicit decision; no runtime dependency regressions.
5. **C-05:** Any performance/scalability statements in user-facing docs must remain within measured evidence and must not imply similarity budget bounds all CPU/memory.

---

## 15. Verified versus unverified areas

| Area | Status |
|---|---|
| Hybrid config validation (defaults/bounds/both-zero/unknown keys) | **Verified** by code + tests |
| `auto` does not select hybrid; explicit hybrid resolution | **Verified** by code + tests |
| Availability-aware fusion core behavior; missing CF not zero; content 0 valid | **Verified** by code + tests (including golden cases) |
| Truthful neither-signal fallback (`baseline` strategy + hybrid summary) | **Verified** |
| Exclusions and target-interacted exclusion (incl. CF weight 0) | **Verified** |
| Similarity budget creation/reuse in hybrid; no alternate `computeSimilarity` source path found | **Verified** by inspection + budget test; full formal proof not provided |
| Request/proxy hostile-input safe `INTERNAL_ERROR` behavior | **Verified** by existing tests + implementation |
| `npm run typecheck`, `npm run format:check`, `npm test` (277) in this session | **Verified** |
| `npm run lint`, build, pack dry-run, production/full audit details from implementation audit | **Previously evidenced; not re-run this session** |
| Exact G1–G10 spec-table numeric vectors all present as tests | **Partially verified / gap (F-01)** |
| Dedicated hybrid benchmark scenarios | **Not verified / absent** |
| Safari/WebKit execution | **Unverified** |
| OS-level network isolation | **Unverified** |
| Peak memory / worst-case hard-limit performance | **Unverified** |
| Production release/publish readiness | **Out of scope / unverified** |

---

## 16. Eligibility for formal maintainer acceptance

**Phase 4 is eligible for formal maintainer acceptance review, but not automatically accepted by this audit.** With conditions C-01–C-05 addressed or explicitly accepted, the implementation appears suitable for maintainer acceptance of the approved Phase 4 scope (explicit hybrid fusion, compatibility-preserving integration, bounded config, budget reuse, and tested safety/privacy invariants). Maintainers should treat unresolved unverified platform/performance limitations as explicit acceptance caveats where applicable.

---

## 17. Confirmation: files and Git state

- **Read-only audit:** No source code, tests, configuration, dependencies, lockfiles, documentation (other than this new report), benchmarks, or Git state were modified.
- **No fixes implemented.** **No Phase 5 work started.**
- **Created file:** `PHASE4_FINAL_ACCEPTANCE_AUDIT.md` (new report; no existing user work overwritten).
- Git state was inspected (`status`/branch/log) but not changed by audit actions.

---

## 18. Remediation update (2026-11-07, targeted) — preserves original independent verdict/history

**Purpose:** Resolve findings from the independent audit (§13) and address acceptance conditions (§14) for Phase 4 only. This section is appended; §§1–17 remain unchanged as the original read-only audit record. **No production scoring behavior changed.** **Phase 5 not started.** **Formal Phase 4 acceptance remains a maintainer decision.**

### 18.1 Repository state (remediation session)

- `git status --short` recorded at start of remediation: same working-tree shape as §3.1 plus `?? PHASE4_FINAL_ACCEPTANCE_AUDIT.md` (created by prior audit step). All existing user work preserved.
- No destructive Git operations, no commits/push/tags/publish/release, no dependency/lockfile changes.

### 18.2 F-01 resolution — exact G1–G10 golden vectors

**Status:** **Resolved** (test evidence added).

- Source of truth: `PHASE4_SPECIFICATION.md` §8 (G1–G10). Each expected result was independently recalculated against the spec formula `S_h(i)=(w_c*A_c(i)*S_c(i)+w_f*A_f(i)*S_f(i))/(w_c*A_c(i)+w_f*A_f(i))` when `D(i)>0`; G4 fallback and G9 validation confirmed.
- Added 10 individually identifiable tests in `tests/hybrid.test.ts` under describe: `Phase 4 acceptance remediation: exact G1-G10 golden vectors (PHASE4_SPECIFICATION.md §8)`.
- Tolerance: `toBeCloseTo(expected, 12)` used where deterministic IEEE 754 binary64 arithmetic makes decimal literals non-exact (e.g., G5: `0.68` vs `0.6799999999999999`); integer/exact values and structural assertions use exact equality where appropriate. No tolerance weakens the spec expectation.
- Production code was **not** modified to make tests pass.

| Spec | Test name | Inputs / availability (spec) | Expected | Result |
|---|---|---|---:|---|
| G1 | `G1 exact: both signals available, defaults w_c=1 w_f=1, S_c=0.80 S_f=0.50 => S_h=0.65` | `A_c=1,A_f=1,S_c=0.80,S_f=0.50,w_c=1,w_f=1` | `0.65` | **Pass** (`hybridScore` formula) |
| G2 | `G2 exact: content only (CF missing for item), S_c=0.80, missing CF not treated as zero => S_h=0.80` | `A_c=1,A_f=0,S_c=0.80` (no CF evidence); integration: tag weights 4/5 match | `0.80` | **Pass** (integration + absence) |
| G3 | `G3 exact: collaborative only (no usable content preferences), S_f=0.50 => S_h=0.50` | `A_c=0,A_f=1,S_f=0.50` | `0.50` | **Pass** (`hybridScore` formula) |
| G4 | `G4 exact: neither signal available (request-level) => truthful baseline fallback` | `A_c=0`, no usable CF context | baseline path / truthful fallback | **Pass** (integration) |
| G5 | `G5 exact: both active, custom weights w_c=0.6 w_f=0.4, S_c=0.80 S_f=0.50 => S_h=0.68` | `S_c=0.80,S_f=0.50,w_c=0.6,w_f=0.4` | `0.68` | **Pass** (`toBeCloseTo(0.68,12)`) |
| G6 | `G6 exact: content disabled by zero weight, S_c=0.80 S_f=0.50 w_c=0 w_f=1 => S_h=0.50` | `w_c=0,w_f=1` | `0.50` | **Pass** (`hybridScore`) |
| G7 | `G7 exact: collaborative disabled by zero weight, S_c=0.80 S_f=0.50 w_c=1 w_f=0 => S_h=0.80` | `w_c=1,w_f=0` | `0.80` | **Pass** (`hybridScore`) |
| G8 | `G8 exact: content score 0 is valid (not missing), A_c=1 A_f(i)=0 S_c=0.00 => S_h=0.00` | `A_c=1,A_f=0,S_c=0.00` | `0.00` | **Pass** (`hybridScore`) |
| G9 | `G9 exact: both-zero weights invalid config => INVALID_CONFIG (no division/fusion)` | `w_c=0,w_f=0` | `INVALID_CONFIG` | **Pass** (config validation) |
| G10 | `G10 exact: CF context usable but item has no CF evidence, A_c=1 S_c=0.60 => S_h=0.60` | request CF usable, `A_f(i)=0`, `S_c=0.60`; integration: tag weights 3/5 match | `0.60` | **Pass** (integration + absence) |

**Targeted result:** `npm test -- tests/hybrid.test.ts` → **1 file, 36 tests passed** (after tolerance fix for G5 floating-point representation).

### 18.3 C-01–C-05 disposition

| Condition | Disposition | Evidence / note |
|---|---|---|
| **C-01 (F-01)** | **Resolved (implementation/test change)** | Exact G1–G10 spec-table vectors added and passing (see §18.2). |
| **C-02 (F-02/F-06 subset)** | **Explicitly accepted as documented limitation** (no mandatory code/benchmark change made) | No dedicated hybrid benchmark scenarios added; no benchmark records overwritten. Safari/WebKit, OS-level network isolation, peak memory, and worst-case hard-limit performance remain **unverified**. Phase 4 acceptance criteria do not require new hybrid benchmarks as a mandatory gate in reviewed text; if maintainers require them, run controlled synthetic benchmarks without overwriting approved evidence. |
| **C-03** | **Addressed by existing design/contract evidence; maintainer confirmation required** | `StrategyId`/hybrid config/weights/result semantics/truthful fallback are implemented and typechecked; exhaustive-switch implications are an additive TS compatibility consideration per Phase 4 design approval. Maintainer should confirm release notes/migration guidance cover this. |
| **C-04** | **Explicitly accepted/tracked limitation** (no dependency upgrades) | `npm audit --omit=dev`: **0 vulnerabilities**. Full `npm audit`: **10 moderate** dev-only vulnerabilities in ESLint/minimatch chain (`GHSA-g3hv-75wg-m249` path as reported); fix would require breaking `eslint` changes — **not applied** (no authorization). No runtime dependency regressions. |
| **C-05** | **Already satisfied by existing discipline / ongoing requirement** | Similarity budget is scoped to actual per-request `computeSimilarity` evaluations; code/docs reviewed in this project distinguish it from all CPU/memory. No performance/scalability overclaims added. |

### 18.4 Other findings (F-02 onward) disposition

| Finding | Disposition |
|---|---|
| **F-02** (Low) | Documented limitation; no hybrid benchmark scenarios added (see C-02). |
| **F-03** (Low) | Tracked dev-only advisory; prod audit clean (see C-04). |
| **F-04** (Informational) | `runPipeline` remains an internal alias export in `src/engine/pipeline.ts`; it is **not** re-exported from root `src/index.ts`. No approved-design conflict requiring change identified. |
| **F-05** (Informational) | Hybrid collaborative collection resolves `collaborative.method==='auto'` to `'user'` in pipeline (`src/engine/pipeline.ts:236-237`). Deterministic and compatible with observed behavior; explicit method choice is not contradicted by reviewed Phase 4 design text. Maintainer may document if desired. |
| **F-06** (Informational) | Unverified platform/measurement items remain (C-02). |
| **F-07** (Informational) | JS proxy inspection remains non-sandboxed; existing security posture unchanged. |

### 18.5 Verification results (remediation session)

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass** |
| `npm run lint` | **Pass** |
| `npm run format:check` | **Pass** (`All matched files use Prettier code style!`) |
| `npm test` | **Pass** — **14 files, 293 tests** |
| `npm run build` | **Pass** |
| `npm pack --dry-run` | **Pass** — `@recomet/core@0.1.0`, 69 files, 42.2 kB / 170.6 kB (`recomet-core-0.1.0.tgz`) |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `npm audit` | **10 moderate** severity vulnerabilities (dev-only ESLint/minimatch chain); not fixed/upgraded |

### 18.6 Files changed (remediation)

- `tests/hybrid.test.ts` — added `hybridScore` import and 10 exact G1–G10 golden-vector tests (behavior-preserving; no production code changes).
- `PHASE4_FINAL_ACCEPTANCE_AUDIT.md` — appended §18 remediation evidence/history (original §§1–17 preserved).
- `PHASE4_ACCEPTANCE_REVIEW.md` — **new** acceptance-readiness summary for maintainers.

No other files were modified as part of remediation.

### 18.7 Final unresolved findings / accepted limitations

- **No Critical/High unresolved findings.**
- **F-02/F-06-related limitations remain accepted/unverified:** no dedicated hybrid benchmark scenarios; Safari/WebKit, OS-level network isolation, peak memory, and worst-case hard-limit performance unverified.
- **F-03:** dev-only `npm audit` advisories remain (10 moderate); production audit clean.
- **F-04/F-05/F-07:** informational; no blocking action taken.

### 18.8 Remediation conclusion

F-01 is resolved with exact, individually identifiable G1–G10 golden-vector tests matching `PHASE4_SPECIFICATION.md` §8 (with justified IEEE 754 tolerance where needed). C-01 is resolved; C-02/C-04 are explicitly accepted/tracked limitations; C-03/C-05 are addressed by existing evidence/discipline with maintainer confirmation/ongoing care required. All required quality gates pass (293 tests). **This update does not change the original independent verdict text in §2;** it provides maintainer-facing evidence that the primary acceptance condition (F-01/C-01) is now satisfied. **Phase 4 is ready for formal maintainer acceptance review** subject to the accepted limitations above. **Do not declare Phase 4 formally accepted.**

---

*End of remediation update.*