# Recomet

**Intelligent Recommendations. Your Data. Your Control.**

Recomet is an open-source, privacy-first recommendation algorithm library for developers. It
runs inside the integrating application, processes application-supplied data locally, and
returns ranking results. It is a library — not a hosted service, central API, or
data-collecting platform.

> **Project status: Phases 2–5 are accepted by the maintainer (independent audits
> `APPROVE WITH CONDITIONS`; documented limitations remain visible; see phase-history acceptance
> records). Phase 5 (advanced ranking & discovery) is **formally accepted** (2026-11-13), subject
> to documented limitations and deferred features. Phase 6 is not started. Recomet is not
> published to npm.**
>
> Phase 2 delivers **explicit preference-based content relevance** from per-request preferences
> and mapped content attributes. Phase 3 adds **neighborhood-based collaborative filtering**
> (user-based and item-based) using interaction data explicitly supplied by the integrating
> application for the current call. Phase 4 adds an explicit `hybrid` strategy that fuses available
> content/collaborative signals without fabricating missing collaborative evidence; `auto` behavior is
> preserved and does not auto-select hybrid. Phase 5 adds explicit `trending`/`discovery` strategies
> and configurable local ranking controls (popularity, freshness with injectable time, diversity
> re-ranking, and trending windows) with deterministic, explainable, bounded behavior. Hybrid
> personalization (`R23`) and automatic profile learning remain deferred. All examples use synthetic
> data.

## Why Recomet

- **Local by design.** End-user data is processed inside the application that supplied it;
  Recomet itself does not transmit it.
- **Library, not platform.** No mandatory backend, hosted API, database, account system, or
  telemetry.
- **Storage-agnostic.** Bring your own data; Recomet processes it in memory and retains
  nothing between calls.
- **Modular.** Capabilities are independent and added in reviewed phases. Phase 1 defined the
  contracts, pipeline, validation, and ranking boundary; Phase 2 adds one content strategy
  behind that boundary.
- **Explainable by structure.** Every score carries a structured component breakdown. A
  content result reports the preference kinds that contributed to the score.
- **Lightweight.** Zero runtime dependencies, no GPU, cloud dependency, paid API, or ML
  framework.
- **Portable.** ESM TypeScript with no Node-specific APIs in the portable core. Node.js 22+ is
  the minimum supported runtime; modern browsers are targeted and tested separately.
- **Language-independent architecture.** Future implementations will share specifications,
  data contracts, and test vectors rather than importing TypeScript code.

## Quick Start

The public API is synchronous. `recommend()` returns a result or throws `RecometError`
directly.

### Neutral baseline

```ts
import { createRecommender, RecometError } from "@recomet/core";

const recommender = createRecommender();

try {
  const result = recommender.recommend({
    items: [
      { id: "article-1", attributes: { category: "space" } },
      { id: "article-2", attributes: { category: "cooking" } },
      { id: "article-3" },
    ],
    limit: 2,
  });

  console.log(result.strategy); // "baseline"
  for (const recommendation of result.recommendations) {
    console.log(recommendation.itemId, recommendation.score); // both 0.5
  }
} catch (error) {
  if (error instanceof RecometError) {
    console.error(error.code, error.category);
  }
}
```

### Explicit content preferences

```ts
const result = recommender.recommend({
  items: [
    {
      id: "article-1",
      attributes: {
        category: "space",
        tags: ["ai", "robotics"],
        contentType: "article",
      },
    },
    { id: "article-2", attributes: { category: "cooking", tags: ["recipes"] } },
    { id: "article-3" },
  ],
  preferences: {
    interests: [
      { kind: "category", value: "space", weight: 3 },
      { kind: "tag", value: "ai" },
    ],
  },
  limit: 3,
});

console.log(result.strategy); // "content"
// article-1 scores 1; article-2 and article-3 score 0.
```

Preferences are supplied **per request**. Recomet does not persist them, associate them with an
account, or learn them from interactions. All examples use synthetic data.

## Content Model and Scoring

Five preference kinds are supported: `category`, `tag`, `topic`, `keyword`, and `contentType`.
By default they map to attributes `category`, `tags`, `topics`, `keywords`, and `contentType`.
A mapped attribute may be a string or an array of strings. Other attributes are not interpreted
as recommendation signals.

For each active preference kind, an item's value is the sum of the weights of matching
preference terms divided by the total weight of terms of that kind. Kind values are combined
using configured factor weights (default `1` each):

```text
score = Σ(kindWeight × matchedWeight / totalKindWeight) / Σ(kindWeight)
```

Scores are finite and in `[0, 1]`. A missing signal scores `0`; it is never treated as a neutral
match. Duplicate preference terms are merged by adding their weights. Labels are trimmed,
NFC-normalized, and lowercased by default; set `content.caseSensitive: true` to preserve case.

When no usable preference term is supplied, or an empty `interests` array is supplied, Recomet
falls back to the exact Phase 1 baseline and reports `strategy: "baseline"`. Configuring
`strategy: "baseline"` while also supplying `preferences` is rejected rather than silently
ignored.

## Configuration

```ts
const recommender = createRecommender({
  strategy: "auto", // "auto" | "baseline" | "content" | "collaborative" | "hybrid"
  limits: {
    maxItems: 10_000,
    maxLimit: 100,
    defaultLimit: 10,
    maxPreferenceTerms: 256,
  },
  content: {
    attributes: {
      category: "section",
      tag: "labels",
      topic: "subjects",
      keyword: "terms",
      contentType: "kind",
    },
    weights: { category: 3, tag: 2, topic: 2, keyword: 1, contentType: 1 },
    caseSensitive: false,
  },
  hybrid: {
    weights: { content: 1, collaborative: 1 }, // finite, non-negative, <= 1000; both zero invalid
  },
});
```

`auto` is the default and preserves existing behavior (it does not auto-select `hybrid`).
`content` uses content scoring when preferences exist and otherwise falls back to baseline.
`hybrid` is explicit: it fuses available content/collaborative signals with configured weights,
does not fabricate missing collaborative evidence as zero, and falls back truthfully when no
usable signals are available. Unknown fields, unsupported strategies, accessors, invalid
mappings/weights, and out-of-range limits throw `RecometError` during creation. Default and hard
limits are documented in [ARCHITECTURE.md](./ARCHITECTURE.md#8-configuration-defaults-and-hard-caps).
They remain **provisional** and are not performance guarantees.

## Collaborative Filtering (Phase 3, accepted)

Phase 3 processes interaction records **explicitly supplied in the request** and produces
deterministic, explainable collaborative recommendations. Interactions are validated, used only
for the current call, and not retained. Formal acceptance is recorded in
[docs/development/phase-history/phase-3/PHASE3_ACCEPTANCE.md](./docs/development/phase-history/phase-3/PHASE3_ACCEPTANCE.md),
subject to documented limitations.

```ts
const recommender = createRecommender({
  strategy: "collaborative", // "baseline" | "content" | "collaborative" | "auto"
  collaborative: {
    method: "auto",        // "user" | "item" | "auto" (tries user-based, then item-based)
    similarity: "cosine",  // "cosine" | "jaccard"
    minOverlap: 1,
    maxNeighbors: 50,
    interactionTypes: { like: 2, save: 1.5, view: 1, skip: 0 }, // optional defaults
  },
});

const result = recommender.recommend({
  items: [{ id: "a" }, { id: "b" }, { id: "c" }],
  userId: "user-1",
  interactions: [
    { userId: "user-1", itemId: "a", type: "view", value: 1 },
    { userId: "user-2", itemId: "a", type: "view", value: 1 },
    { userId: "user-2", itemId: "b", type: "like", value: 2 },
    { userId: "user-1", itemId: "c", type: "custom-event" }, // valid unconfigured type => default strength 1
  ],
  limit: 5,
});
```

Interaction records accept `userId`, `itemId`, `type`, and optional finite, **non-negative**
`value`. **Phase 3:** negative `value` inputs are rejected with `INVALID_INTERACTION` (no
dislike/negative-feedback semantics). The integrating application controls event meanings.
Effective strength precedence: explicit `value` > `interactionTypes[type]` > default `1` (unknown
but valid unconfigured types default to `1` when `value` is absent). Duplicate `(user,item)`
records are aggregated by summing strengths.

**Normalization (Decision A / F-02):** the denominator has a minimum value of `1`. Strengths with
absolute value `<= 1` retain magnitude (no all-below-1 rescaling). When the maximum absolute
observed strength exceeds `1`, strengths are normalized relative to that maximum. Scores/components
are finite and clamped to `[0,1]`; negative or zero-similarity neighbors are not used as positive
evidence. Items already interacted with by the target user are excluded.

**Strategies and fallback:** `baseline` and `content` reject collaborative inputs. `collaborative`
requires `userId` and `interactions` and may accept optional `preferences` for fallback only.
When collaborative data is insufficient (cold start, no overlap, no applicable neighbors/candidates),
it falls back to `content` if usable preferences exist, otherwise `baseline`. `auto` selects one
applicable strategy by precedence/availability (collaborative when target-user signal is present,
else content when usable preferences exist, else baseline) and **never auto-selects `hybrid`**.
Explicit `hybrid` uses availability-aware fusion: missing collaborative evidence is not treated as
an observed zero; items with only content or only collaborative evidence use that available signal;
if neither signal is usable, it falls back truthfully to baseline. No silent blending occurs in
`auto`/non-hybrid paths. Fallback results report the actual strategy used.

## What the Current Implementation Provides

- Synchronous `createRecommender(config?)` and `recommender.recommend(request)`.
- Phase 1: validation, limits, exclusions, duplicate detection, deterministic top-k selection,
  metadata, and baseline behaviour.
- Phase 2: per-request explicit preferences (five label kinds), attribute mappings, factor
  weights, optional case-sensitive matching, deterministic weighted-coverage content scoring,
  and baseline fallback when no usable preferences are supplied.
- Phase 3: user-based and item-based neighborhood collaborative filtering (cosine/Jaccard),
  strict interaction validation, deterministic ranking, explainable collaborative components,
  configurable method/similarity/interaction-type weights/minOverlap/maxNeighbors, and explicit
  cold-start/fallback behavior.
- Phase 4 (accepted): explicit `hybrid` strategy with availability-aware weighted fusion,
  configurable bounded hybrid weights, safe hybrid explanations/components, preserved
  exclusions/target-interacted behavior, and truthful fallback. Hybrid reuses the existing
  request-scoped collaborative similarity-evaluation budget.
- Phase 5 (accepted 2026-11-13, implemented subset): explicit `trending` and `discovery`
  strategies computed locally from supplied data with injectable `now`, explicit time-window
  semantics, and cold-start/fallback handling; configurable ranking controls for popularity,
  freshness, diversity re-ranking, and trending factors with bounded/deterministic/explainable
  application. Advanced learned profiles and automatic interaction collection remain out of scope.
- Collaborative limits: `maxInteractions`, `maxInteractionTypeLength`,
  `maxInteractionTypeWeights`, `maxCollaborativeNeighbors`,
  `maxCollaborativeSimilarityEvaluations` (maximum **total** `computeSimilarity` evaluations per
  request, shared across collaborative paths that perform similarity evaluation, including explicit
  hybrid; bounds similarity evaluations only, not all CPU/memory; distinct from
  `maxCollaborativeNeighbors`/`collaborative.maxNeighbors`, which select neighbors after
  evaluation; plus existing global limits). Pre-stable migration: `maxCollaborativeComparisons`
  was removed and is rejected with `INVALID_CONFIG` guidance.
- `INVALID_INTERACTION` validation errors (value-free); preference/collaborative identifiers and
  labels are not echoed in errors.
- No mutation or retention of caller-owned input objects (including interaction records).
- No telemetry, network, filesystem, subprocess, dynamic code, hidden storage, logging, or
  mutable global state in the runtime core.

Not implemented and not advertised as accepted/stable beyond documented scope: hybrid
personalization (`R23`), automatic/learned user profiles and automatic interaction
collection/learning, content similarity/similar-item recommendations, hosted trend feeds/external
data, persistence adapters, plugins, and hosted services. Support-aware/confidence weighting for
hybrid is deferred. Advanced ranking/discovery controls implemented in Phase 5 are pending formal
acceptance and remain subject to documented bounds/trade-offs.

## Testing and Verification

The repository contains 303 automated Node tests across 15 files (current working-tree
verification snapshot, including Phase 5 coverage), including unit, integration, edge/failure,
security/privacy, hostile-Proxy, static runtime-policy, strategy-specific functional/mathematical/
validation/security coverage, and regression coverage against naive/reference expectations. All
use synthetic data. In this task, `npm run verify` (`format:check`, `lint`, `typecheck`, `test`,
`build`) passed locally. Real-browser tests, `npm run bench`, `npm run pack:check`, and
`npm audit --omit=dev` were not re-run in this task. Historical 2026-11-05 browser results are
recorded below. Historical phase snapshots and acceptance records are preserved in
[SPECIFICATION.md](./SPECIFICATION.md) and
[docs/development/phase-history/](./docs/development/phase-history/).

Latest known GitHub Actions CI for commit `3168d19` (run
[43381147821](https://github.com/arjunuxd/recomet/actions/runs/43381147821), before this Phase 5
working-tree change set) completed with **Failure** (Windows Node 22/24 verification jobs failed);
current uncommitted changes have not been validated by CI. Do not infer CI pass/fail for this
working tree without new evidence.

```text
npm run verify        # typecheck + lint + format check + tests + build
npm run test:browser  # real installed browsers, no automation dependency
npm run bench         # reproducible synthetic benchmark, writes benchmarks/results.json
npm run pack:check    # inspect packed package contents
```

Real-browser results on 2026-11-05 (18 browser checks each, all passed):

| Browser | Version | Result |
| --- | --- | --- |
| Microsoft Edge | 156.0.4314.58 | 18/18 passed |
| Google Chrome | 156.0.8078.80 | 18/18 passed |
| Mozilla Firefox | 160.0 | 18/18 passed |
| Safari | — | Unverified; not available on Windows |
| WebKit | — | Unverified; not executed |

WebKit results would not be treated as Safari evidence. Firefox was executed through its
WebDriver BiDi remote agent.

### Recorded benchmarks

Environment (this task): Windows 11 `win32 10.0.26300`, x64, 11th Gen Intel Core i3-1125G4 @
2.00 GHz, 8 logical CPUs, ~8 GB RAM, Node.js `v24.18.0`, V8 `13.6.233.17-node.50`, 2026-11-06.
Synthetic data; measurements are machine-specific and **not performance guarantees**.

| Scenario | Strategy | Items | Limit | p50 | p95 | Returned |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| No attributes | baseline | 1,000 | 10 | 0.77 ms | 1.40 ms | 10 |
| No attributes | baseline | 10,000 | 10 | 9.20 ms | 15.00 ms | 10 |
| No attributes | baseline | 10,000 | 100 | 8.89 ms | 11.25 ms | 100 |
| 20 attributes/item | baseline | 10,000 | 100 | 52.48 ms | 90.42 ms | 100 |
| 10% excluded | baseline | 10,000 | 10 | 11.15 ms | 13.84 ms | 10 |
| 5 content signals | baseline | 1,000 | 10 | 5.31 ms | 6.45 ms | 10 |
| 5 content signals | content | 1,000 | 10 | 12.75 ms | 15.08 ms | 10 |
| 5 content signals | baseline | 10,000 | 100 | 57.25 ms | 65.68 ms | 100 |
| 5 content signals | content | 10,000 | 100 | 132.99 ms | 143.02 ms | 100 |
| 20 tags/item | content | 10,000 | 100 | 223.43 ms | 254.25 ms | 100 |
| 1k items, 200 users, sparse | collaborative (user, cosine) | 1,000 | 10 | 2.94 ms | 4.20 ms | 8 |
| 1k items, 200 users, sparse | collaborative (item, cosine) | 1,000 | 10 | 3.42 ms | 4.44 ms | 8 |
| 10k items, 1k users, medium | collaborative (user, cosine) | 10,000 | 100 | 25.50 ms | 29.50 ms | 7 |
| 10k items, 1k users, medium | collaborative (item, Jaccard) | 10,000 | 100 | 32.42 ms | 38.62 ms | 7 |

Collaborative scenarios use synthetic interaction datasets (8 interactions/user for 1k sparse;
12/user for 10k medium), `minOverlap: 1`, bounded neighbors (`25`/`50`), and may return fewer
items when sparse data yields fewer applicable candidates. Heap samples in
`benchmarks/results.json` (gitignored) are post-call/GC samples, not peak-memory measurements.
No scalability claims are made.

## Requirements

- **Node.js:** 22 or newer (ESM only, no CommonJS build).
- **Browsers:** latest two stable major versions of Chrome, Edge, Firefox, and Safari. The core
  uses standard ECMAScript only. Browser support is reported per actual browser; WebKit results
  are not Safari verification.
- **Runtime dependencies:** none.
- **Development reference environment:** Windows x64, Intel Core i3-1125G4, 8 GB RAM,
  Node.js 24.18.0, npm 9.6.1.

## Documentation

| Document | Purpose |
| --- | --- |
| [SPECIFICATION.md](./SPECIFICATION.md) | Vision, scope, requirements, and success criteria |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, modules, contracts, limits, and flow |
| [SECURITY.md](./SECURITY.md) | Threat model, security controls, and vulnerability process |
| [PRIVACY.md](./PRIVACY.md) | Privacy design, boundaries, and verification |
| [ROADMAP.md](./ROADMAP.md) | Phase status, deliverables, and acceptance criteria |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution, review, and release governance |
| [LICENSE](./LICENSE) | Apache License 2.0 |

## Privacy in One Paragraph

The runtime core performs no telemetry, analytics, tracking, network communication,
filesystem access, subprocess execution, dynamic evaluation, logging, or hidden persistence.
Explicit preferences and collaborative interaction records supplied in requests are processed in
memory for the duration of one call and are not retained by Recomet. All processing is
synchronous and in memory. A static policy test scans runtime source for forbidden capabilities.
These properties are enforced by design and tests, but the library is **not published**; release
verification and remaining pre-release actions are tracked in [PRIVACY.md](./PRIVACY.md) and
[SECURITY.md](./SECURITY.md). Hostile objects with Proxy traps can execute code during
inspection; JSON-compatible input is the supported untrusted-data boundary. OS-level
network-disabled execution has not been verified, and after-GC heap samples are not peak-memory
measurements.

## Package Name

`@recomet/core` remains the proposed package name. Registry checks on 2026-11-01 found neither
`@recomet/core` nor `recomet` registered. Registration alone does not reserve an npm scope, and
the scope is **not** claimed as secured. Nothing has been published.

## License

Licensed under the [Apache License 2.0](./LICENSE). The copyright holder and any `NOTICE`
content are not finalised; no ownership details have been invented. See
[SPECIFICATION.md](./SPECIFICATION.md#15-decisions-and-pre-release-actions).
