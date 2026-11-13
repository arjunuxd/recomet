# Recomet Specification

**Status:** Phase 0 finalised; Phase 1 implemented and verified locally. Phase 2 accepted by the
maintainer (2026-11-05, independent audit `APPROVE WITH CONDITIONS`; documented limitations remain
visible). Phase 3 collaborative filtering (collaborative-only) is **accepted** by the maintainer
(2026-11-07, independent audit `APPROVE WITH CONDITIONS`; see [`PHASE3_ACCEPTANCE.md`](./docs/development/phase-history/phase-3/PHASE3_ACCEPTANCE.md)). Phase 4
explicit hybrid recommendation strategy (`R12` subset, availability-aware fusion) is **formally accepted** by the maintainer
(2026-11-07, implemented subset, independent audit `APPROVE WITH CONDITIONS`; see [`PHASE4_ACCEPTANCE.md`](./docs/development/phase-history/phase-4/PHASE4_ACCEPTANCE.md)), subject to documented limitations. Hybrid
personalization (`R23`) remains deferred unless separately approved. Phase 5 advanced ranking/discovery
is **formally accepted** by the maintainer (2026-11-13, subject to documented limitations and
deferred features; see [`PHASE5_ACCEPTANCE.md`](./docs/development/phase-history/phase-5/PHASE5_ACCEPTANCE.md)).
Phase 6 is not started. Nothing has been published.
**Version:** 0.1.0 (pre-release specification)
**Last updated:** 2026-11-13
**License:** Apache License 2.0

**Scope revision (2026-11-05):** `Phase 3 is collaborative-only. Hybrid recommendations and hybrid personalization are deferred to Phase 4.` This revision updates phase assignments and roadmap structure; it does not delete hybrid requirements.

This document defines what Recomet is, what it must do, what it deliberately does not do,
and how completion will be judged. It is the authoritative source for scope. Architecture
and implementation details belong in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. Vision

Recomet is a reusable, open-source recommendation algorithm library that developers embed
directly in their applications. It turns content, preferences, and interaction signals
supplied by the integrating application into ranked recommendations, entirely inside that
application's environment.

**Tagline:** Intelligent Recommendations. Your Data. Your Control.

**Core philosophy:** Build the intelligence. Empower developers. Keep the data where it
belongs.

Recomet exists because recommendation logic is useful to almost every content application,
but adopting it often requires surrendering end-user data to a hosted service, a central
API, or an opaque vendor. Recomet separates recommendation intelligence from data
ownership: the algorithm travels to the data, not the other way around.

### Long-term objectives

1. Provide trustworthy, explainable recommendation capabilities under a permissive license.
2. Keep all end-user data under the integrating application's control.
3. Offer a small, dependency-light library that works in Node.js and browsers.
4. Support gradual adoption: a simple default API first, advanced configuration when needed.
5. Keep recommendation capabilities modular so applications use only what they need.
6. Share language-neutral specifications and test vectors so future native implementations
   behave consistently without importing TypeScript.
7. Maintain security, privacy, and quality standards appropriate for code that processes
   user preference data.

---

## 2. Scope and Non-Goals

### 2.1 In scope

- A TypeScript recommendation engine distributed as an npm package.
- Local, in-memory processing inside Node.js and browser applications.
- Strongly typed, flexible data contracts for content, preferences, and interactions.
- Modular recommendation capabilities introduced through approved phases.
- Content-based, collaborative, hybrid, interest-based, trending, cold-start, diversity,
  freshness, ranking, and explanation capabilities as defined in the roadmap.
- Manual, automatic, and hybrid personalization modes.
- Configurable limits, filtering, ranking weights, and strategies where approved.
- Explainable, structured recommendation scores.
- Comprehensive tests, benchmarks, security review, and documentation.
- Language-neutral specifications and test vectors for future implementations.
- Developer-controlled optional persistence through future adapters; never mandatory.

### 2.2 Explicit non-goals

Recomet is **not** and will not become:

- A hosted recommendation service, SaaS platform, or central recommendation API.
- A managed infrastructure product or mandatory backend.
- A database, data warehouse, or storage provider.
- A platform that collects, receives, transmits, or accesses application or end-user data.
- A telemetry, analytics, tracking, advertising, or profiling service.
- A central authentication or user-account system.
- A model-hosting service or gateway to external AI APIs.
- A system requiring GPU, Docker, cloud resources, paid APIs, or heavy ML frameworks.
- A content-management system, front-end component library, or application framework.
- A guarantee of legal compliance (GDPR, CCPA, COPPA, DSA, or similar) for integrators.
- A tool that automatically crawls, scrapes, or licenses datasets on a developer's behalf.
- A universal ranking model that is optimal for every domain.

Recomet also does not claim to outperform other libraries or algorithms unless reproducible
evaluation supports the claim.

### 2.3 Trust boundary

The integrating application supplies the data and decides what data to supply. Recomet
processes that data and returns recommendations. Maintainers do not operate a service that
receives data. Any network access during package installation or updates is package
management, not Recomet runtime processing.

---

## 3. Definitions

| Term | Meaning |
| --- | --- |
| **Integrating application** | The developer's application that imports and calls Recomet. |
| **Engine instance** | An isolated object created by `createRecommender`, holding immutable configuration. |
| **Content item** | An application-owned item that can be recommended, identified by an opaque string ID. |
| **Interaction** | A locally supplied signal such as a view, like, save, share, skip, search, watch duration, or follow. |
| **Interest** | A manual preference expressed by a developer or end user, associated with a preference kind and weight. |
| **Content preference** | An explicit per-request label such as a category, tag, topic, keyword, or content type. It is not learned or persisted. |
| **Content signal** | A normalized label extracted from an item's mapped content attribute for content scoring. |
| **Candidate** | An item considered for the final recommendation list, with score components. |
| **Strategy / capability** | An independently implemented recommendation approach (for example baseline, content-based, collaborative). |
| **Ranker** | A component that combines validated score components into a deterministic ordering. |
| **Recommendation request** | The per-call input containing items and optional request parameters. |
| **Recommendation result** | The structured, ranked output returned to the integrating application. |
| **Baseline strategy** | Phase 1's non-personalized capability: eligible items receive a neutral score and retain input order. This is pipeline behaviour, not personalized relevance. |
| **End-user data** | Data about a person using the integrating application, including identifiers and interactions. |
| **n** | Number of items supplied in a request, bounded by `maxItems`. |
| **e** | Number of exclusion IDs supplied in a request, bounded by `maxExcludeItemIds`; duplicates are deduplicated for tracking. |
| **a** | Number of attribute values and keys inspected across all items in a request, bounded by the total attribute budgets. |
| **k** | Effective number of returned recommendations (`limit`), bounded by `maxLimit`. |

---

## 4. Approved Requirements Traceability

The 23 core approved requirements are grouped into nine product/architecture requirements
(R1–R9), eleven recommendation capability requirements (R10–R20), and three
personalization-mode requirements (R21–R23). The approved capability list's single
personalization entry is represented by R21–R23, so the total remains 23.

### 4.1 Core requirements (R1–R23)

| ID | Requirement | Specification location | Target phase |
| --- | --- | --- | --- |
| R1 | TypeScript is the first implementation. | §2.1, ARCHITECTURE §10.2, §15 | 0–1 |
| R2 | Node.js and browser support are required. | §11, ARCHITECTURE §10 | 1 |
| R3 | Architecture is language-independent where practical. | ARCHITECTURE §12 | 0 |
| R4 | Future implementations are separate native implementations using shared specifications, data contracts, and common test vectors. | ARCHITECTURE §12, ROADMAP Phase 5 | 0 / 5 (shared artifacts; implementations separate) |
| R5 | Developers integrate Recomet directly as a library. | §2.1, ARCHITECTURE §5 | 0–1 |
| R6 | No mandatory backend, hosted API, or database. | §2.2, ARCHITECTURE §11 | 0–1 |
| R7 | In-memory processing by default, with optional developer-controlled persistence. | §9.3, PRIVACY §8 | 1 (in-memory); optional extension unscheduled — Q12 |
| R8 | Flexible data contracts that do not force database redesign. | §5, ARCHITECTURE §6 | 1 |
| R9 | Modular architecture with independent capabilities and well-defined interfaces. | ARCHITECTURE §4–8 | 1+ |
| R10 | Content-based recommendations. | §7.3 | 2 |
| R11 | Collaborative filtering. | §7.3 | 3 |
| R12 | Hybrid recommendations. | §7.3 | 4 |
| R13 | Personalized ranking. | §7.3 | 2–4 |
| R14 | Interest-based recommendations. | §7.3 | 2 |
| R15 | Content similarity. | §7.3 | 2 |
| R16 | Trending and discovery recommendations. | §7.3 | 4 |
| R17 | Cold-start handling. | §7.3 | 2–4 |
| R18 | Diversity and freshness. | §7.3 | 4 |
| R19 | Explainable recommendation scores. | §6.6, ARCHITECTURE §6.5 and §9 | 1, expanded later |
| R20 | Configurable recommendation strategies. | §6.8, ARCHITECTURE §6.4 and §9 | 1 allowlist, expanded later |
| R21 | Manual personalization: developer- or user-supplied interests. | §7.2 | 2 |
| R22 | Automatic personalization from locally supplied interaction signals. | §7.2 | 2–4 |
| R23 | Hybrid personalization combining manual and learned interests. | §7.2 | 4 |

### 4.2 Extended requirements

These requirements are equally binding even though they are not part of the 23 core items.

| ID | Requirement |
| --- | --- |
| DX1 | Simple API with sensible defaults. |
| DX2 | Advanced configuration for experienced developers. |
| DX3 | Customizable ranking weights and strategies, only where implemented. |
| DX4 | Filtering and recommendation limits. |
| DX5 | Clear API documentation. |
| PF1 | Lightweight and efficient implementation. |
| PF2 | Minimal dependencies; native and standard functionality preferred. |
| PF3 | No mandatory GPU, cloud, paid API, or heavy ML framework. |
| PF4 | No unnecessary background services or Docker requirement. |
| PF5 | Efficient support for small and medium applications. |
| PF6 | Benchmark larger workloads before making scalability claims. |
| SC1 | Strict security-first development. |
| SC2 | Input validation and safe error handling. |
| SC3 | Resource-exhaustion protection. |
| SC4 | Dependency and supply-chain review. |
| SC5 | No telemetry, tracking, or analytics. |
| SC6 | No runtime network communication with maintainers. |
| SC7 | No collection or transmission of end-user data. |
| SC8 | No hidden data storage or external sharing. |
| TQ1 | Unit and integration testing. |
| TQ2 | Edge-case and failure testing. |
| TQ3 | Security and regression testing. |
| TQ4 | Node.js and browser compatibility testing. |
| TQ5 | Performance and memory benchmarks. |
| TQ6 | Recommendation-quality evaluation. |
| TQ7 | Synthetic or appropriately licensed public datasets. |
| TQ8 | Reproducible test vectors and benchmark methods. |
| TQ9 | Defined release-quality gates. |
| DC1 | Beginner getting-started documentation. |
| DC2 | Installation and integration guides. |
| DC3 | API reference. |
| DC4 | Practical examples. |
| DC5 | Algorithm explanations. |
| DC6 | Architecture, security, and privacy documentation. |
| DC7 | Migration and compatibility documentation. |
| DC8 | Contribution guidelines. |
| GV1 | Core-team-controlled governance; community proposals are welcome but designated maintainers control official development and releases. |
| RL1 | Semantic Versioning, stable releases, changelogs, migration guidance, and backward compatibility where practical. |
| RL2 | LTS versions with realistic maintenance commitments. |
| LC1 | Apache License 2.0, subject to final license and notice review. |

### 4.3 Decision register (D01–D23)

The original 23-decision list was supplied for Phase 0 finalisation on 2026-11-05 and is
reproduced below. Every entry has been compared with that list and mapped to the requirement
or document section that records its effect. This register records **decisions**; R1–R23 in
§4.1 remain separate **requirements**. A decision may shape several requirements, and a
requirement may depend on more than one decision.

| ID | Original decision | Mapped requirement(s) / location | Verification |
| --- | --- | --- | --- |
| D01 | Language-independent architecture, TypeScript first. | R1, R3; ARCHITECTURE §10 and §12 | Verified against supplied list |
| D02 | Library-first direct integration. | R5; §2.1 and ARCHITECTURE §5 | Verified against supplied list |
| D03 | Local in-memory processing by default; optional developer-controlled persistence later. | R7; §9.2–9.3 and PRIVACY §8 | Verified against supplied list |
| D04 | Progressively support content-based, collaborative, hybrid, and personalized ranking. | R10–R13; §7.3 | Verified against supplied list. Scope revision (2026-11-05): roadmap delivery is collaborative (Phase 3), hybrid (Phase 4), advanced ranking/discovery (Phase 5). |
| D05 | Manual, automatic, and hybrid personalization with user controls. | R21–R23; §7.2 | Verified against supplied list. Hybrid personalization (`R23`) is deferred to Phase 4 by the 2026-11-05 scope revision. |
| D06 | Support social, e-commerce, education, entertainment, news, professional, and general applications. | R8; §2.1, §5, and §7.3 | Verified against supplied list |
| D07 | Simple developer API with advanced configuration. | DX1, DX2; §6.2 and §8 | Verified against supplied list |
| D08 | Support multiple cold-start approaches. | R17; §7.4 | Verified against supplied list |
| D09 | Configurable ranking, freshness, popularity, diversity, interaction, and explainability. | R18–R20; §6.6 and §7.3 | Verified against supplied list |
| D10 | Separate native implementations for future languages using shared contracts and test vectors. | R4; ARCHITECTURE §12 | Verified against supplied list |
| D11 | Minimal dependencies; prefer native features and the standard library. | PF2; §10.1 | Verified against supplied list |
| D12 | No mandatory AI/ML models, paid APIs, GPU, or external model downloads. | PF3; §2.2 and §10.1 | Verified against supplied list |
| D13 | Node.js and browser compatibility for the first TypeScript implementation. | R2; §11 | Verified against supplied list |
| D14 | Flexible developer-defined data mapped to common Recomet contracts. | R8; §5 | Verified against supplied list |
| D15 | Modular architecture with well-defined internal interfaces. | R9; ARCHITECTURE §4 | Verified against supplied list |
| D16 | Balanced lightweight and scalable design with measurable performance. | PF1, PF5, PF6; §10 | Verified against supplied list |
| D17 | Security-first development. | SC1–SC8; §12 and SECURITY | Verified against supplied list |
| D18 | Advanced testing, including quality, security, and performance evaluation. | TQ1–TQ9; §13 | Verified against supplied list |
| D19 | Comprehensive developer documentation. | DC1–DC8; §8.3 and §13 | Verified against supplied list |
| D20 | Apache License 2.0. | LC1; LICENSE | Verified against supplied list |
| D21 | Stable releases, SemVer, changelogs, and realistic LTS commitments. | RL1, RL2; ROADMAP release policy | Verified against supplied list |
| D22 | Core-team-controlled development and official releases. | GV1; CONTRIBUTING §1 | Verified against supplied list |
| D23 | Progressive releases: foundation first, then content-based recommendations and basic personalization, followed by collaborative, hybrid, and advanced ranking capabilities. | §7.3 and ROADMAP Phases 1–6 (revised) | Verified against supplied list. Scope revision (2026-11-05): collaborative Phase 3, hybrid Phase 4, advanced ranking/discovery Phase 5, release readiness Phase 6. |

### 4.4 Differences from the provisional draft register

The earlier provisional register was derived from R1–R23 and did not reproduce the original
decision list. It is replaced by §4.3. The differences are recorded here so the correction is
auditable:

- The earlier draft mapped D01–D23 almost one-to-one onto R1–R23 and described requirement
  statements as decisions. That mapping was inaccurate and has been removed.
- The original list groups several requirements into single decisions (for example D04 and
  D23) and includes decisions that no single core requirement captures: D06 (application
  domains), D08 (cold-start approaches), D09 (configurable factors), D11–D12 (dependency and
  model constraints), D16 (lightweight/scalable balance), D18–D19 (testing and documentation),
  and D20–D23 (license, release policy, governance, and progressive delivery).
- Those decisions are mapped to the extended requirements and roadmap sections that implement
  them rather than being forced onto an unrelated R row.
- R1–R23 are unchanged. No requirement was renumbered, and no decision content was invented.
- The repository still does not contain the original interview transcript. The supplied list is
  recorded here as the authoritative Phase 0 decision record. The absence of a transcript is no
  longer an unverified-register blocker.

### 4.5 Decision traceability finding

- Decision-level traceability is now **verified** against the supplied 23-decision list.
- Requirement-level traceability remains separate in §4.1 and is unchanged.
- Extended requirements (DX, PF, SC, TQ, DC, GV, RL, LC) carry decisions that are not one-to-one
  with the core requirements.
- Any future change to a decision requires a documented specification change; it must not be
  inferred from a requirement edit.

---

## 5. Data Contracts (Specification Level)

Data contracts are TypeScript types in the first implementation, but their semantics must be
expressible in JSON so future native implementations can share them. The detailed signature
definitions are in [ARCHITECTURE.md §6](./ARCHITECTURE.md#6-common-data-contracts).

### 5.1 Contract principles

1. **Opaque identifiers.** IDs are application-defined case-sensitive strings. Recomet does
   not parse, normalize, or reinterpret them.
2. **Content is extensible.** Application-specific content properties live in an optional
   `attributes` bag rather than requiring schema changes in Recomet.
3. **No storage assumptions.** Inputs are supplied per call. Recomet does not require a
   database, ORM, or specific record shape beyond the documented envelope.
4. **Additive evolution.** New optional fields may be added in minor versions. Removing or
   changing field meaning requires a major version.
5. **No hidden metadata.** Recomet does not add identifiers, tracking fields, or hidden
   properties to inputs or outputs.
6. **Bounded input.** Every variable-size collection and free-form value is subject to
   documented limits.
7. **Serializable by design.** Contracts use JSON-compatible primitives, arrays, and plain
   objects. Functions, symbols, class instances, dates, binary buffers, and cyclic graphs
   are not accepted inside free-form attributes. JSON-compatible input is the supported
   security boundary for untrusted external data. Arbitrary live JavaScript objects,
   including proxies, are outside that boundary: they can execute host code during
   inspection, throw, or block. See [SECURITY.md §4.4](./SECURITY.md#44-javascript-object-inspection-boundary).

### 5.2 Required contracts

Phase 1 defines types for content items and identifiers, recommendation requests and results,
ranking scores and explanations, engine configuration and resolved limits, error codes and safe
details, and forward-looking personalization containers.

Phase 2 implements a subset of the personalization contracts: `PreferenceKind`,
`ContentPreference`, and `RecommendationPreferences`, supplied as the optional
`preferences.interests` field of a request. The forward-looking `UserReference`, `Interest`,
`UserProfile`, and `Interaction` types remain contracts only. They are **not accepted by the
current request** and are not silently ignored. Profiles, interaction records, automatic
learning, and content similarity are deferred; accepting them without implementing their
semantics would misrepresent engine behaviour. See §7.5.

---

## 6. Functional Requirements

### 6.1 Engine initialization (FR-1)

- `createRecommender(config?)` creates an independent engine instance.
- Configuration is optional; valid defaults apply.
- Invalid configuration fails safely with a typed error before any request is processed.
- Multiple instances must not share mutable state.
- Initialization must not perform I/O, network access, background work, or eager data loading.
- Initialization overhead should be small and proportional to configuration validation only.

### 6.2 Configuration (FR-2)

- Configuration is validated against an allowlist.
- Unknown configuration keys are rejected to catch typos and unsupported features.
- Limits are safe integers within documented ranges and hard caps.
- Invalid values are rejected, not silently clamped.
- Resolved configuration is immutable for the engine's lifetime.
- Only options approved for the current phase are accepted. Phase 2 accepts `strategy: "auto"`,
  `"baseline"`, or `"content"`, documented resource limits, and a `content` block containing
  attribute mappings, factor weights, and a case-sensitivity flag.
- `auto` is the default. It selects content scoring only when usable explicit preferences are
  supplied; otherwise the baseline is used.
- The resolved `content` configuration is immutable and isolated per engine instance.

### 6.3 Request validation (FR-3)

- Every public entry point validates input.
- The request must be a plain object with only supported keys.
- `items` is required and must be an array within the configured item limit.
- Each item must contain a non-empty, bounded string `id` and an optional bounded,
  JSON-compatible `attributes` object.
- Duplicate item IDs are rejected.
- `excludeItemIds` is optional, bounded, and contains bounded strings; duplicates are
  deduplicated for matching.
- `limit` is optional and must be an integer within `1..maxLimit`.
- `preferences` is optional. When present it must be a plain object with only an `interests`
  array. Each interest requires a supported `kind`, a non-empty bounded string `value`, and an
  optional finite positive `weight` (default `1`, maximum `1000`).
- Supplying `preferences` with the explicit `baseline` strategy is rejected with
  `INVALID_REQUEST`; it is never silently ignored. Empty `interests` is a valid request that
  falls back to the baseline.
- Values are checked against the expected type. Unsupported values — functions, symbols,
  accessor properties, class instances, cyclic or shared-reference objects — are rejected.
  `null` and arrays are valid only where the attribute contract permits them.
- JSON-compatible input is the supported boundary for untrusted external data. Arbitrary
  live JavaScript objects, including proxies, cannot be reliably detected or safely
  inspected. Validation reads own data descriptors, avoids getters and `toJSON`, and converts
  inspection failures to sanitized errors. That reduces accidental execution and prevents raw
  error leakage, but it does **not** guarantee protection against arbitrary code execution or
  blocking caused by a hostile object, because inspection itself can run proxy trap code.
- Validation does not invoke user-defined getter accessors or `toJSON` hooks. Proxy traps may
  still run during unavoidable inspection; see [SECURITY.md §4.4](./SECURITY.md#44-javascript-object-inspection-boundary).
- Applications accepting untrusted external input must make it JSON-compatible before passing
  it to Recomet — for example, by parsing JSON text in the host application and discarding
  exotic objects.

### 6.4 Candidate collection (FR-4)

- The default `auto` strategy uses the baseline when no usable preferences are supplied and the
  content capability when they are.
- Candidates are all validated items not present in `excludeItemIds`.
- The baseline source preserves input order as the deterministic tie-breaker.
- The content source streams eligible items in input order, extracts only mapped signal
  attributes, and computes a relevance score for each item. Missing signals score `0`.
- If there are no eligible items, the result is a successful empty recommendation list.
- Candidate collection is in-memory and streaming over the supplied array; the engine must
  not clone the entire attribute payload or retain it after the request.

### 6.5 Execution pipeline (FR-5)

Each recommendation request follows this order:

1. Validate the request envelope and request-level limits, including optional preferences.
2. Validate each content item and its attributes within resource budgets.
3. Normalize preferences and determine whether content scoring is active.
4. Build an ID index and exclusion set without prototype-sensitive object keys.
5. Extract mapped content signals when content scoring is active.
6. Collect eligible candidates from the selected source.
7. Compute structured score components.
8. Select and order the top `limit` candidates deterministically.
9. Format a fresh result object and return it.

Responsibilities are split across modules; no single module owns validation, candidate
generation, ranking, and formatting.

### 6.6 Scoring and explainability (FR-6)

- Scores are finite numbers in the inclusive range `[0, 1]`.
- Component weights are normalized across the components present in a candidate; each
  contribution is `value × normalizedWeight`, and the total score is the sum of
  contributions.
- Every recommendation includes a rank (1-based), score, strategy identifier, summary, and
  structured score components.
- Phase 1 baseline score is a neutral `0.5`, represented as a single component
  `{ factor: "baseline", value: 0.5, weight: 1, contribution: 0.5 }`.
- The baseline explanation states that no personalization was applied.
- Phase 2 content scores are explicit relevance values in `[0, 1]`, not a neutral `0.5`. For
  each active preference kind, the value is `matchedPreferenceWeight / totalPreferenceWeight`
  for that kind. Active kinds are combined with configured factor weights. Missing signals
  contribute `0`.
- Content explanations include one component per active preference kind, in the fixed order
  `category`, `tag`, `topic`, `keyword`, `contentType`, with the configured raw factor weight
  and normalized contribution.
- The content summary states that explicit preferences were used and no interaction history
  was used.
- The baseline is explicitly documented as non-personalized ordering, not relevance.
- Unimplemented factors (freshness, popularity, diversity, collaborative or interaction
  signals) are not emitted and are not accepted as configuration.
- Scoring must not use randomness, wall-clock time, environment variables, or locale.

### 6.7 Determinism and ordering (FR-7)

- Identical inputs and configuration produce identical recommendations and metadata,
  independent of host locale and time zone.
- Ties are resolved by original input order, then (only if needed for internal robustness)
  by exact item ID comparison.
- The engine does not shuffle, sample randomly, or use unstable sort assumptions.
- Results are returned in ranked order; no internal candidate objects are exposed.

### 6.8 Strategy configuration (FR-8)

- Phase 2 supports `"auto"`, `"baseline"`, and `"content"`.
- `"auto"` (default) selects content scoring only when usable explicit preferences exist.
- `"baseline"` always produces the neutral Phase 1 baseline; supplying `preferences` with it is
  rejected with `INVALID_REQUEST`.
- `"content"` uses content scoring when usable preferences exist and falls back to the baseline
  otherwise. The result strategy always identifies the capability that actually ran.
- Configuring an unknown, not-yet-implemented, or misspelled strategy raises
  `UNSUPPORTED_STRATEGY`.
- Future strategies are added only when implemented, tested, documented, and versioned.
- The public result identifies the strategy that produced it so callers can never mistake a
  baseline result for a personalized one.

### 6.9 Result formatting (FR-9)

A result contains:

- Strategy identifier.
- Ordered recommendations (possibly empty).
- Per-recommendation item ID, rank, score, and explanation.
- Metadata: total items, eligible items, excluded items, returned items, and applied limit.
- No echoed attributes, user identifiers, raw interactions, or input copies.
- No internal candidate source index or other implementation detail.

### 6.10 Errors (FR-10)

- Configuration and request failures raise a typed `RecometError`.
- Malformed explicit preferences raise `INVALID_PREFERENCES` (category `validation`).
- Errors include a stable machine-readable code, a category, and a human-readable message.
- Messages identify the problem and, where useful, a safe path/index — never an input value,
  user identifier, attribute content, or full request object.
- Unknown internal failures are converted to a generic `INTERNAL_ERROR` without leaking
  stack data through the error message. Stack traces remain available for local debugging
  but must not embed input data.
- The library does not log to the console, files, or external services.

### 6.11 Isolation (FR-11)

- Every engine instance is independent.
- No global registry, singleton cache, mutable module-level configuration, or cross-instance
  recommendation state.
- No filesystem, network, timer, worker, or process access in runtime code.
- Concurrent requests to one instance are safe because per-request state is local and
  configuration is immutable.

### 6.12 Runtime portability (FR-12)

- Core code uses standard ECMAScript only.
- No reliance on Node.js built-ins (`node:*`, `Buffer`, `process`, `fs`, `crypto`) in runtime
  modules.
- No DOM dependency or browser-only API in core.
- Build output is usable by Node.js and bundled browser applications.
- Package metadata must not run install scripts.

---

## 7. Personalization and Recommendation Capabilities

### 7.1 Phase 2 — Content-Based Recommendations and Basic Personalization

Phase 2 implements **explicit, per-request preference-based content relevance**. The caller
supplies content attributes and a set of manual interests; Recomet extracts only the mapped
label attributes, normalizes them, and ranks eligible items by weighted label overlap, with a
structured explanation for every result.

The engine still does **not** infer interests, build or persist user profiles, learn from
interaction history, compute content similarity, use collaborative filtering, or rank by
popularity. Those capabilities require separate contracts, quality evaluation, cold-start
behaviour, privacy review, and tests. The neutral `0.5` baseline remains available and is the
documented fallback when no usable preferences are supplied.

### 7.2 Personalization modes

| Mode | Definition | Data source | Status |
| --- | --- | --- | --- |
| **Manual** | Developer- or user-supplied interests/preferences, explicit and inspectable. | Per-request `preferences.interests`. | Implemented in Phase 2 for five label kinds. |
| **Automatic** | Interests inferred locally from interaction signals supplied by the application. | Views, likes, saves, shares, skips, searches, watch duration, follows, and app-defined signals. | Not implemented; deferred beyond the authorized Phase 2 subset. |
| **Hybrid** | Combination of manual preferences and locally learned interests with explicit weighting. | Manual interests plus local interaction-derived signals. | Not implemented; planned for Phase 4 (deferred from Phase 3 by explicit scope revision). |

The integrating application remains responsible for providing signals and implementing
end-user controls such as reset, preference adjustment, export, and opt-out. Recomet does
not collect signals or provide a user account system.

### 7.3 Capability phases

| Capability | Phase | Notes |
| --- | --- | --- |
| Neutral baseline ordering | 1 | Implemented; non-personalized fallback and foundation for ranking/explanation contracts. |
| Content-based recommendations | 2 | Implemented for explicit per-request preferences and mapped label attributes. |
| Content similarity | 2 | **Deferred.** Similar-item and similarity inputs are not implemented or advertised. |
| Interest-based recommendations | 2 | Implemented for manual interests with weights. |
| Manual personalization | 2 | Implemented as explicit preferences with weights. |
| Personalized ranking | 2–5 | Implemented as explainable content/collaborative relevance; advanced weights remain later work. |
| Automatic personalization | 2, advanced in 5 | **Deferred.** No automatic interaction learning/profile persistence is implemented. |
| Collaborative filtering | 3 | **Accepted** (2026-11-07, collaborative-only; see `PHASE3_ACCEPTANCE.md`). User–item signals supplied explicitly per call; no central data sharing. Resource-bound claims are limited to the actual per-request `computeSimilarity` evaluation budget; that budget does not bound all CPU or memory. |
| Hybrid recommendations | 4 | Not started; deferred from Phase 3. Combines content and collaborative signals. |
| Hybrid personalization | 4 | Not started; deferred from Phase 3. Merges manual and learned interests. |
| Cold-start handling | 2–5 | Explicit fallback behavior in implemented phases (Phase 2 content/no-signal; Phase 3 collaborative insufficient-data). Advanced fallbacks remain later work. |
| Trending and discovery | 5 | **Implemented and accepted (2026-11-13).** Explicit `trending`/`discovery` strategies computed locally from supplied data with injectable `now`, explicit time-window semantics, bounded work, and cold-start/fallback handling; not a hosted trend feed. |
| Diversity and freshness | 5 | **Implemented and accepted (2026-11-13).** Configurable freshness/popularity/trending ranking factors and bounded diversity re-ranking with deterministic, explainable behavior and documented trade-offs/limits. |
| Advanced ranking weights and strategies | 4–5 | Content factor weights implemented; hybrid weighting is Phase 4 scope; broader strategy profiles/evaluation remain later work. |
| Full recommendation-quality optimization | 5–6 | Not implemented. Evaluation harness and release gates remain later work. |

No capability may be advertised as available before its implementation and tests are
merged. Partial or experimental capabilities must be labelled explicitly.

### 7.4 Cold-start principles

- Missing signals must not crash the engine or produce hidden fallbacks.
- A missing content signal contributes `0` relevance for that preference kind.
- A request with no usable preference term uses the baseline, and the result strategy and
  summary make the fallback observable.
- Phase 2's content strategy is an explicit relevance model, not a quality guarantee; it has
  not been evaluated against a recommendation-quality benchmark.

### 7.5 Authorized Phase 2 scoring and deferred scope

For each preference kind `j` with at least one term, let `M_j` be the summed weight of
preference terms that match the item's normalized signal for that kind, and `T_j` the summed
weight of all terms of that kind. The kind value is `V_j = M_j / T_j` (0 when absent).
With configured factor weights `W_j`, the content score is:

```text
score = Σ(W_j × V_j) / Σ(W_j)   over active kinds
```

The score is in `[0, 1]`. Scores are pure relevance: an item with no matching signals receives
`0`, not the baseline `0.5`. Duplicate preference terms are merged by adding weights. Labels are
trimmed, NFC-normalized, and lowercased unless `content.caseSensitive` is true. The fixed kind
order is `category`, `tag`, `topic`, `keyword`, `contentType`.

The following are explicitly **out of scope for the authorized Phase 2 implementation** and
must not be described as delivered: content similarity or similar-item endpoints, automatic
interaction-based preferences, learned profiles, cross-user analysis, collaborative or hybrid
algorithms, popularity/trending, freshness or time decay, diversity re-ranking, persistence,
and any network or external ML service.

### 7.6 Phase 3 collaborative filtering semantics (collaborative-only, accepted)

Phase 3 implements neighborhood-based collaborative filtering from **explicit, per-request**
interaction data supplied by the integrating application. It is collaborative-only: no hybrid
strategy, no content+collaborative blending, no hybrid personalization, no automatic interaction
collection, no persistent profiles, and no cross-application data sharing.

**Inputs:** `userId` (target user) and `interactions[]` records with `userId`, `itemId`, `type`,
and optional `value`. Records are validated as untrusted plain objects; processing is in memory
for the current call only.

**Interaction strength:** Effective strength for a record is `value` when provided; otherwise
`interactionTypes[type]` when configured; otherwise `1`. `interactionTypes` weights must be
finite and non-negative. Explicit `value` must be a finite, **non-negative** number in Phase 3;
negative values are rejected (`INVALID_INTERACTION`) because dislike/negative-feedback semantics
are not implemented. Signed zero (`-0`) is canonicalized to `0`. Unknown but valid interaction
`type` strings default to strength `1` when `value` is absent.

**Aggregation:** Duplicate `(userId, itemId)` interactions are aggregated by summing effective
strengths deterministically.

**Normalization (Decision A / F-02):** The normalization denominator has a minimum value of `1`.
Effective strengths with absolute value `<= 1` retain their magnitude (no rescaling to make the
dataset maximum `1`). When the maximum absolute observed strength exceeds `1`, strengths are
normalized relative to that maximum. Normalized values remain finite and bounded.

| Effective strengths | Denominator | Normalized strengths |
|---|---:|---|
| `0.2`, `0.1` | 1 | `0.2`, `0.1` |
| `1`, `0.5` | 1 | `1`, `0.5` |
| `2`, `1` | 2 | `1`, `0.5` |
| `-2`, `1` (defensive/internal) | 2 | `-1`, `0.5` |

**Methods/similarity:** User-based and item-based neighborhood filtering with cosine or Jaccard
similarity, `minOverlap`, bounded `maxNeighbors`, and deterministic neighbor selection. Only
positive-similarity neighbors contribute. Target-user interacted items are excluded.
`maxCollaborativeSimilarityEvaluations` bounds **actual per-request `computeSimilarity`
invocations only** (shared across user/item methods and `auto` attempts); it does not bound all
CPU or memory usage.

**Strategies/fallback:** Supported strategies remain `baseline | content | collaborative | auto`.
`auto` selects collaborative when usable target-user interaction signal exists; else content when
usable preferences exist; else baseline. Explicit `collaborative` requires `userId` and
`interactions` and may accept optional `preferences` for fallback only. When collaborative data
is insufficient, the engine falls back to content or baseline and reports the **actual** strategy
used; fallback output is never labeled collaborative.

**Quality note:** Phase 3 provides deterministic, explainable collaborative mechanics, not a
recommendation-quality guarantee. No benchmark-based quality or scalability claims are made.

---

## 8. Developer Experience Requirements

### 8.1 Simple path

```ts
const recommender = createRecommender();
const result = recommender.recommend({ items, limit: 10 });
```

The simple path must work with sensible defaults, no mandatory setup files, no environment
variables, no accounts, and no network access.

### 8.2 Advanced path

Advanced configuration is opt-in and validated. It must not change defaults for existing
instances. Phase 2 exposes the `auto`, `baseline`, and `content` strategies, documented
resource limits, and a `content` block with attribute mappings, factor weights, and a
case-sensitivity flag. Similarity options, learned-profile options, and persistence adapters
arrive only with their capabilities.

### 8.3 Documentation

Every public type, option, error code, and limit must be documented. Examples use synthetic
data. Documentation must distinguish implemented features from planned features and must
not promise unmeasured performance or unverified quality.

### 8.4 Type safety

- Public APIs ship TypeScript declarations.
- `strict` TypeScript settings are required.
- Invalid states are represented by validation at runtime, not by type assertions.
- Exported types avoid `any`; unknown input boundaries are typed as `unknown` and narrowed.

---

## 9. Data Handling Requirements

### 9.1 Local processing

All recommendation processing is required to occur in the integrating application's runtime.
Recomet is designed to send no data to maintainers or third parties and to contain no
runtime network calls. This is verified before release; see [PRIVACY.md](./PRIVACY.md).

### 9.2 In-memory by default

- Request data is processed in memory.
- The engine does not persist, cache across requests, or write inputs to disk.
- Temporary structures are eligible for garbage collection after the call.
- The engine does not clone full attribute payloads that it does not need.

### 9.3 Optional developer-controlled persistence

Future persistence must be:

- Off by default.
- Implemented through an explicitly configured adapter owned by the integrating developer.
- Documented with data-flow, retention, and security implications.
- Never a prerequisite for using the core engine.
- Never able to transmit data to maintainers by default.

### 9.4 Data minimization

- Phase 2 accepts only what it uses: item IDs, optional bounded attributes, and optional
  per-request preferences. Only mapped label attributes are interpreted as content signals;
  all other attributes are validated for contract safety only.
- Preferences are scoped to a single call. They are not associated with a user, persisted, or
  reused by a later request.
- Results echo item IDs and scores, not content payloads, preference labels, or user data.
- Error messages exclude values and personal identifiers.
- The library emits no logs or telemetry.

### 9.5 Privacy boundaries

- Each engine instance is isolated.
- Nothing is shared between integrating applications.
- No central index, global cache, or cross-application state exists.
- Host applications remain responsible for consent, legal basis, retention, and end-user
  controls.

---

## 10. Performance and Resource Requirements

### 10.1 Constraints

- No mandatory GPU, cloud service, paid API, external AI API, or heavy ML framework.
- No mandatory Docker, background daemon, worker pool, or database.
- Runtime dependency target: zero.
- Aim to support small and medium applications on ordinary hardware; validate with measured
  benchmarks rather than unverified claims.
- Avoid copying large collections; prefer iteration and bounded top-k selection.
- Avoid unbounded recursion, unbounded maps, or attacker-controlled allocation.

### 10.2 Engineering budgets and recorded results

These are internal validation budgets, not published guarantees. They were measured on the
reference environment with the conditions recorded below. Results describe that machine and
runtime only.

**Reference environment (measured 2026-11-05):** Windows 11 `win32 10.0.26300`, x64, 11th Gen
Intel Core i3-1125G4 @ 2.00 GHz, 8 logical CPUs, 8 GB RAM. Node.js `v24.18.0`, V8
`13.6.233.17-node.50`. Synthetic data. The reproducibility harness is
`benchmarks/run.mjs`; raw output is written to a local, untracked `benchmarks/results.json`.

| Scenario | Strategy | Items | Limit | p50 | p95 | Iterations | Budget | Result |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| No attributes | baseline | 1,000 | 10 | 0.93 ms | 1.58 ms | 950 | p95 ≤ 10 ms | Met |
| No attributes | baseline | 10,000 | 10 | 11.39 ms | 16.01 ms | 84 | p95 ≤ 50 ms | Met |
| No attributes | baseline | 10,000 | 100 | 11.76 ms | 15.69 ms | 82 | p95 ≤ 50 ms | Met |
| 20 attributes/item | baseline | 10,000 | 100 | 71.06 ms | 104.76 ms | 20 | No initial time budget | Measured only |
| 10% excluded | baseline | 10,000 | 10 | 12.14 ms | 14.52 ms | 82 | No initial time budget | Measured only |
| 5 content signals, no preferences | baseline | 1,000 | 10 | 6.37 ms | 9.44 ms | 148 | No initial time budget | Measured only |
| 5 content signals | content | 1,000 | 10 | 17.16 ms | 37.44 ms | 52 | No initial time budget | Measured only |
| 5 content signals, no preferences | baseline | 10,000 | 100 | 62.28 ms | 80.83 ms | 20 | No initial time budget | Measured only |
| 5 content signals | content | 10,000 | 100 | 156.85 ms | 272.72 ms | 20 | No initial time budget | Measured only |
| 20 tags/item | content | 10,000 | 100 | 313.64 ms | 683.50 ms | 20 | No initial time budget | Measured only |

The 20-attribute and content scenarios explicitly raised `maxTotalAttributeNodes` to
`500,000` and `maxTotalAttributeCharacters` to `5,000,000`, the documented hard caps. The
default total attribute budgets are lower and reject those payloads unless configured. The
default limits therefore remain **provisional**: the time budgets were met for the measured
no-attribute and limit scenarios, but the defaults have not been shown to fit typical
attribute-heavy payloads, and no memory budget has been validated. Content scoring is slower
than the baseline because mapped labels are extracted, normalized, and scored for every
eligible item; the measured content results are not a recommendation-quality claim.

Memory and complexity expectations:

| Property | Expectation | Phase 1/2 evidence |
| --- | --- | --- |
| Peak additional engine memory, 10,000 items | ≤ 20 MB above baseline, excluding caller input | **Not measured.** After-call GC heap deltas ranged from roughly `-17,000` to `+553,000` bytes, with one outlier, across scenarios. These are not peak-memory measurements. |
| Top-k heap storage | O(`k`), independent of item count | Enforced by the bounded top-k implementation and covered by unit tests; not a measured memory result. |
| Request-tracking state | O(`n` + `e` + `a` + `p`) auxiliary state | Stated from implementation structure; not a measured result. |
| Total auxiliary memory | O(`n` + `e` + `a` + `p` + `k`), excluding caller-owned input and the returned result | Stated from implementation structure; not a measured result. |

`n` is the number of items, `e` the number of exclusion IDs, `a` the number of attribute
values and keys inspected, `p` the number of normalized preference terms, and `k` the
effective returned limit (definitions in §3). Total auxiliary memory is **not** O(`k`) alone:
duplicate-ID tracking is O(`n`), exclusion tracking is O(`e`), attribute-graph tracking is
O(`a`), and normalized preference tracking is O(`p`). The per-request item, attribute, and
preference budgets bound these terms.

If budgets are missed, the implementation must be optimized or the limitation documented
before release. Budgets may be revised with evidence, not silently waived. The recorded
results do not validate any value as optimal and do not justify a scalability claim beyond the
measured sizes.

### 10.3 Scalability claims

No claim of scalability beyond measured benchmark sizes is permitted. Benchmarks must state
hardware, Node.js version, dataset shape, attribute sizes, warm-up method, iterations, and
memory measurement method. Recommendations are single-process in-memory operations.

---

## 11. Compatibility Expectations

### 11.1 Node.js (decided)

- Minimum Node.js 22.x, ESM import support.
- Development/reference runtime: Node.js 24.18.0, npm 9.6.1.
- Phase 2 executed the full 197-test suite and type check on Node.js `v24.18.0` (reference
  runtime) and on Node.js `v22.23.4` (temporary runtime, not added to project dependencies).
  Both runs passed. The `engines.node` floor is `>=22`.
- No native addons, no child processes, no worker threads in core.
- Package install must not require compiling native code.

### 11.2 Browsers (decided)

- The latest two stable major versions of Chrome, Edge, Firefox, and Safari at release time.
- ES2022 JavaScript baseline.
- No DOM dependency in core library code.
- Works with standard bundlers and browser-native ESM where the bundler supports it.
- No `eval`, `new Function`, dynamic `import()` of remote code, or WebAssembly requirement.
- Browser support is reported per engine and per actual browser. A WebKit-based test runner is
  **not** Safari: it does not reproduce Safari's full browser, operating-system integration,
  JIT, or version-specific behaviour. Passing a WebKit runner is evidence of engine
  compatibility, not Safari support. Safari may be claimed only after execution in Safari on a
  supported platform; otherwise the release must report Safari as unverified.
- Phase 2 executed the built ESM entry in Microsoft Edge `156.0.4314.58`, Google Chrome
  `156.0.8078.80`, and Mozilla Firefox `160.0` on Windows; all 18 browser checks passed in each.
  Safari and WebKit were not available or executed and remain **unverified**. These results do
  not establish support for other browser versions or operating systems.

### 11.3 Package format (decided)

The current package is **ESM-only** with TypeScript declarations and no runtime dependencies.
Node.js 22+ is the minimum supported runtime. CommonJS output is not provided; it would only be
added if a concrete compatibility requirement is approved, and must avoid a dual-package
hazard.

### 11.4 Cross-language compatibility

Future language implementations are independent native packages. They must consume shared
specifications, data contracts, and common test vectors — never import TypeScript source.
Numeric tolerances and deterministic ordering rules must be defined in the test-vector
format.

---

## 12. Security and Privacy Requirements

Security and privacy are release-blocking. The detailed threat model and controls are in
[SECURITY.md](./SECURITY.md) and [PRIVACY.md](./PRIVACY.md).

Non-negotiable requirements:

1. No collection of end-user data for maintainers.
2. No transmission of end-user data to maintainers or third parties.
3. No telemetry, tracking, analytics, or crash reporting.
4. No hidden runtime network calls.
5. No mandatory cloud infrastructure, external AI API, or central authentication.
6. No storage outside the integrating developer's environment.
7. Input validation at every public entry point.
8. Prototype-pollution resistance.
9. No unsafe dynamic code execution.
10. No arbitrary filesystem access.
11. Bounded CPU, memory, recursion, and output size.
12. Safe, non-sensitive error messages.
13. No hardcoded secrets.
14. Dependency and supply-chain review before adoption.
15. Security tests covering malformed input, pollution attempts, and resource exhaustion.

---

## 13. Quality and Testing Requirements

### 13.1 Required test categories

- Unit tests for initialization, configuration, validation, request processing, ranking,
  content scoring, result formatting, and errors.
- Integration tests for end-to-end calls with synthetic data, including baseline fallback.
- Edge cases: empty collections, missing IDs, duplicates, invalid limits, malformed
  preferences, unknown preference kinds, missing mapped signals, unexpected types, missing
  optional attributes, and large collections.
- Security tests: malformed objects, accessors, prototype-pollution keys, cyclic attributes,
  cyclic or sparse preference arrays, resource-exhaustion attempts, and safe errors.
- Regression tests for fixed defects.
- Node.js and real-browser compatibility checks.
- Performance and memory benchmarks with reproducible methods.
- Recommendation-quality evaluation once relevance capabilities exist. Phase 2 has
  correctness and determinism tests but **no** recommendation-quality evaluation, so no
  quality claim is made.

### 13.2 Quality commands

Before any phase is declared complete, the repository must run and report actual results for:

- Unit and integration tests.
- Type checking.
- Linting.
- Formatting check.
- Build validation.
- Dependency audit.

Tests must be executed, not merely configured. Coverage percentage alone is not a quality
gate; meaningful assertions and failure-path coverage are required.

### 13.3 Release-quality gates

Defined in [ROADMAP.md](./ROADMAP.md) and [CONTRIBUTING.md](./CONTRIBUTING.md). At minimum:
all required checks pass, no known high/critical vulnerability in shipped code, privacy
invariants verified, documentation matches implementation, and maintainers approve.

---

## 14. Success Criteria

Recomet succeeds when all of the following hold for a release:

1. A developer can install the package and obtain recommendations with the documented simple
   API, without creating an account, service, database, or configuration.
2. Every advertised capability is implemented, tested, documented, and clearly identified.
3. Manual, automatic, and hybrid personalization are supported as specified by phase.
4. Recommendation results include structured, explainable scores appropriate to the
   strategies used.
5. No runtime network communication, telemetry, hidden persistence, or end-user data
   collection exists in shipped code.
6. Security tests demonstrate resistance to malformed input, prototype pollution, and
   bounded resource exhaustion.
7. Node.js and browser compatibility is verified by execution, not assumption.
8. Benchmarks are reproducible and no unmeasured scalability or quality claims are made.
9. Documentation covers getting started, integration, API, algorithms, architecture,
   security, privacy, migration, and contribution.
10. The release passes defined quality gates and uses Semantic Versioning with a changelog.
11. The architecture supports future native implementations through shared specifications
    and test vectors rather than cross-language source imports.
12. Governance and licensing are documented and internally consistent.

### Phase 0 completion criteria

- All required foundation documents exist and agree with each other.
- All 23 core requirements and extended requirements are traceable.
- The D01–D23 decision register has been checked against the supplied original decision list
  and is recorded in §4.3.
- Privacy guarantees are enforceable/verifiable by design.
- Node.js and browser strategy is explicit and does not assume unavailable features.
- Cross-language strategy does not assume TypeScript is importable elsewhere.
- Data contracts accommodate multiple application domains without schema redesign.
- Roadmap capabilities are phased and do not promise unverified behaviour.
- License and governance documents are consistent.
- No algorithm was implemented during Phase 0.
- Human approval is recorded before Phase 1 begins.

Phase 0 is now closed. Phase 1 implementation evidence and residual pre-release actions are
recorded in the other project documents; they are not retroactively claimed as Phase 0 work.

### Phase 1 completion evidence (historical record, 2026-11-05)

Recorded on 2026-11-05 for the Phase 1 milestone. These are **historical** local results for that phase, preserved for traceability; they are not current worktree totals and not release guarantees.

- **Implementation:** synchronous ESM TypeScript library with zero runtime dependencies;
  `createRecommender` and `recommend` implemented, built, and packaged for inspection.
- **Automated tests:** 136 tests across 9 files passed (`npm test`), covering unit, integration,
  edge/failure, security/privacy, hostile-Proxy, static runtime-policy, and regression scenarios.
- **Quality commands:** `npm run verify` passed (typecheck, lint, format check, 136 tests, build).
- **Node.js:** executed the 136-test suite and type check on Node.js `v24.18.0` and on Node.js
  `v22.23.4`; both passed. The Node.js 22 run used a temporary `npx node@22` runtime and did not
  add a project dependency.
- **Browsers:** 11/11 checks passed in Edge `156.0.4314.58`, Chrome `156.0.8078.80`, and Firefox
  `160.0`. Safari and WebKit remain unverified.
- **Benchmarks:** recorded in §10.2 with hardware, runtime, dataset shape, and methodology.
  Initial time budgets were met for the measured no-attribute and limit scenarios; peak memory
  was not measured, and all limits remain provisional.
- **Privacy/security:** static policy tests found no network, filesystem, process, dynamic-code,
  telemetry, logging, or storage capability in `src/`, and no runtime dependencies. Hostile
  Proxy traps can execute during inspection; JSON-compatible input is the supported
  untrusted-data boundary. Cross-realm arrays and plain objects are rejected by strict prototype
  checks. The audit reported 10 moderate development-only vulnerabilities in the ESLint
  dependency chain and no high/critical findings in shipped code.
- **Not established:** maintainer review/approval, Safari/WebKit execution, peak-memory
  validation, published-package verification, or any personalized recommendation quality claim.
  Phase 2 was not part of Phase 1.

Phase 1 is complete as an implementation milestone only when the maintainer review in
[ROADMAP.md](./ROADMAP.md) approves it and explicitly authorises Phase 2.

### Phase 2 completion evidence (historical record, 2026-11-05)

Recorded on 2026-11-05 for the Phase 2 milestone. These are **historical** local results for that phase, preserved for traceability; they are not current worktree totals and not release guarantees.

- **Implementation:** explicit per-request content preferences over mapped label attributes,
  with deterministic weighted-coverage scoring, structured per-kind explanations, developer
  attribute mappings, factor weights, optional case-sensitive matching, and automatic
  baseline fallback. No interaction learning, profiles, similarity, or persistence.
- **Automated tests:** 197 tests across 12 files passed (`npm test`), covering all Phase 1
  categories plus preference validation, content scoring, content-request integration, and
  content-specific security/privacy scenarios.
- **Quality commands:** `npm run verify` passed (typecheck, lint, format check, 197 tests,
  build). The package dry run and dependency audit were also recorded.
- **Node.js:** executed the 197-test suite and type check on Node.js `v24.18.0` and on Node.js
  `v22.23.4`; both passed. The Node.js 22 run used a temporary `npx node@22` runtime and did
  not add a project dependency.
- **Browsers:** 18/18 checks passed in Edge `156.0.4314.58`, Chrome `156.0.8078.80`, and
  Firefox `160.0`. Safari and WebKit remain unverified.
- **Benchmarks:** recorded in §10.2; the content strategy is slower than the baseline on the
  same synthetic datasets. No performance or recommendation-quality guarantee is established.
- **Privacy/security:** content and preference labels are not echoed in results or errors;
  preference arrays reject accessors, cycles, sparse arrays, symbols, and prototype-pollution
  keys. Static policy tests still find no network, filesystem, process, dynamic-code,
  telemetry, logging, or storage capability in `src/`, and no runtime dependencies.
- **Not established (at Phase 2 historical record time):** formal Phase 3 acceptance had not
  occurred; Safari/WebKit execution, peak-memory validation, published-package verification,
  recommendation-quality evaluation, content similarity, automatic interaction-based
  personalization beyond authorized scope, and hybrid ranking were not established.

Phase 2 completion for its authorized subset was recorded and accepted by the maintainer on
2026-11-05 (independent audit `APPROVE WITH CONDITIONS`; documented limitations remain visible).
Phase 3 collaborative-only implementation was subsequently **formally accepted** by the maintainer
on 2026-11-07 (independent audit `APPROVE WITH CONDITIONS`; see
[PHASE3_ACCEPTANCE.md](./docs/development/phase-history/phase-3/PHASE3_ACCEPTANCE.md)). Phase 4 was
later authorized, implemented for its approved subset, and formally accepted (2026-11-07). Phase 5
advanced ranking/discovery was implemented and formally accepted (2026-11-13, subject to documented
limitations and deferred features; see
[PHASE5_ACCEPTANCE.md](./docs/development/phase-history/phase-5/PHASE5_ACCEPTANCE.md)).

### Phase 3 implementation and verification evidence (collaborative-only; historical record, 2026-11-06)

Recorded on 2026-11-06 for the Phase 3 collaborative-only milestone and subsequent audit-resolution
hardening. This section preserves historical implementation and verification evidence from that
worktree state; it does **not** represent current overall project acceptance status. Current status:
Phases 3, 4, and 5 are formally accepted (subject to documented limitations). Phase 6 is not
started. No release-readiness or package-publication claim is made.

- **Scope:** collaborative-only neighborhood filtering (user-based/item-based, cosine/Jaccard),
  explicit per-request `userId`/`interactions`, deterministic ranking/explanations, truthful
  fallback; Phase 3 included no hybrid strategy/blending/personalization, no automatic
  collection/persistence/telemetry/network/runtime deps.
- **Audit-resolution changes (F-01–F-04):** normalization semantics preserved/documented
  (denominator floor `1`; strengths with abs `<= 1` retain magnitude; rescale relative to max
  only when max abs `> 1`). Explicit `interaction.value` validated as finite, non-negative
  (negative rejected, `INVALID_INTERACTION`; no dislike semantics in Phase 3; signed zero
  canonicalized to `0`). Unknown but valid unconfigured interaction `type` defaults to strength
  `1` when `value` is absent (documented/tested). Historical evidence sections labeled to avoid
  confusion with current status.
- **Pre-correction audit baseline (historical, 2026-11-06):** `npm test` reported **13 test files,
  224 tests passed** before audit-resolution corrections. This is audit evidence, not the final
  post-correction count.
- **Post-correction verification (2026-11-06, this worktree):** `npm run typecheck` PASS;
  `npm run lint` PASS; `npm run format:check` PASS; `npm test` PASS (**13 test files, 239 tests
  passed, 0 failed, 0 skipped**); `npm run build` PASS (regenerated gitignored `dist/`);
  `npm audit --omit=dev` PASS (`found 0 vulnerabilities`); `npm audit` (read-only, no fixes)
  reported **10 moderate** dev-only vulnerabilities (`minimatch` `GHSA-g3hv-75wg-m249`,
  ESLint/typescript-eslint chain), 0 high/critical. No unsafe dependency fixes applied.
- **Not established/verified in this task:** formal Phase 3 acceptance, `npm run bench`/scalability
  claims, `npm run test:browser` re-run, Safari/WebKit, OS-level network isolation, peak-memory
  measurement, recommendation-quality evaluation, published-package verification.

---

## 15. Decisions and Pre-Release Actions

Q1–Q13 are resolved for Phases 1 and 2. The decisions below are binding. Any remaining item
is a pre-release verification or appointment action, not an open design decision.

| ID | Decision | Remaining action |
| --- | --- | --- |
| Q1 | `@recomet/core` remains the proposed package name. The npm scope is **not** claimed as secured, and nothing is published. | Confirm ownership and availability before any publication. Do not present the name as reserved. |
| Q2 | The existing Apache License 2.0 text is preserved. No copyright holder or `NOTICE` content is invented. | Finalise ownership and any `NOTICE` before the first public release. |
| Q3 | ESM-only. Node.js 22+ is the minimum. No CommonJS output unless a concrete compatibility requirement is approved. | None for Phases 1 and 2. |
| Q4 | The public API is synchronous: `recommend()` returns a result directly and throws `RecometError` synchronously. No Promise boundary is introduced for hypothetical future adapters. | If asynchronous adapters are ever required, design them separately rather than changing this API silently. |
| Q5 | Phase 1 baseline: every eligible item receives a neutral `0.5` score, ties preserve input order, and the result is explicitly identified as non-personalized pipeline behaviour. | None for Phase 1. |
| Q6 | Target the latest two stable major versions of Chrome, Edge, Firefox, and Safari. Browser results are reported per actual browser. WebKit test results are not Safari verification. | Execute available browsers; report Safari and any other unexecuted browser as unverified. |
| Q7 | Use GitHub private vulnerability reporting when it is enabled and verified for the repository. Do not invent a security contact or guaranteed response times. | Verify the repository setting before relying on it; document an accurate alternative if unavailable. |
| Q8 | The repository owner initially controls core development and official releases. No additional maintainers or approvers are invented. | Record named maintainers when appointed. |
| Q9 | The limits and hard caps in ARCHITECTURE §8 remain provisional. Benchmarks must be recorded before any value is described as validated or optimal. | Revise with evidence if measurements justify it; do not present proposals as guarantees. |
| Q10 | Contributions are governed by Apache License 2.0 Section 5. No mandatory CLA or DCO is required at this stage. | Revisit only if a concrete governance requirement appears. |
| Q11 | Use synthetic datasets initially. External datasets require provenance and licence review. Never use real end-user data in tests or benchmarks. | Record provenance for any future external dataset. |
| Q12 | Phases 1 and 2 implement no persistence, database integration, or storage adapter. Processing is in memory only. | Any future persistence requires a separate approved design and review. |
| Q13 | The D01–D23 register has been verified against the supplied original 23-decision list and is recorded in §4.3. R1-R23 remain separate requirement statements. | None for Phases 1 and 2. |

---

## 16. Change Control

- This specification changes through reviewed pull requests.
- Adding a capability to a phase requires updating scope, contracts, tests, privacy/security
  review, and acceptance criteria before implementation.
- Removing a requirement requires explicit maintainer decision and documentation.
- The 23 core requirements may only be changed by maintainer decision; they are not silently
  reinterpreted.
- Phase completion claims require evidence, not intention.
