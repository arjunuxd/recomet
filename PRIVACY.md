# Recomet Privacy

**Status:** Phase 1 implemented and verified locally. Phase 2 accepted by the maintainer
(2026-11-05; independent audit `APPROVE WITH CONDITIONS`; documented limitations remain visible).
Phase 3 collaborative filtering (collaborative-only) is **accepted** by the maintainer (2026-11-07).
Phase 4 explicit `hybrid` strategy (implemented subset) is **formally accepted** by the maintainer
(2026-11-07), subject to documented limitations; hybrid personalization (`R23`) remains deferred
unless separately approved. Phase 5 advanced ranking/discovery is **formally accepted** by the
maintainer (2026-11-13, subject to documented limitations and deferred features; see
[`PHASE5_ACCEPTANCE.md`](./docs/development/phase-history/phase-5/PHASE5_ACCEPTANCE.md)); Phase 6 is
not started. Historical evidence is preserved in [`docs/development/phase-history/`](./docs/development/phase-history/).
**Last updated:** 2026-11-13
**Tagline:** Intelligent Recommendations. Your Data. Your Control.

This document states Recomet's privacy guarantees, the boundaries of those guarantees, and
how developers and reviewers can verify them. It applies to the core library at runtime.
[SECURITY.md](./SECURITY.md) covers the threat model and controls.

---

## 1. Summary of Guarantees

Recomet's approved design requires that:

1. **All recommendation processing happens locally** inside the integrating application.
2. **Maintainers receive no end-user or application data** through the library.
3. **No telemetry, analytics, tracking, advertising, or crash reporting** exists in the
   library.
4. **No runtime network communication is permitted** — no HTTP, WebSocket, beacon, DNS
   lookup, or remote model call initiated by Recomet.
5. **No mandatory database, hosted API, cloud service, or account is required.**
6. **No hidden persistence exists** — no cookies, local storage, IndexedDB, files, or caches
   created by the core library.
7. **In-memory processing is the default.** Request data is not retained after the call.
8. **Results are minimal** — item IDs, scores, explanations, and counts, not copies of user
   profiles, interactions, content attributes, or preference labels.
9. **The integrating developer controls data**, including what to supply, retention,
   consent, and end-user controls. For explicit preferences, the developer supplies them per
   request and Recomet does not persist or learn them.
10. **Future persistence is opt-in and developer-controlled**, never a hidden default.

**Verification status:** these remain binding, release-blocking design guarantees. Phase 2
runtime code exists, and the local checks in §12 have been executed for the implemented library:
static policy scan, zero runtime dependencies, package inspection, result-minimization and
retention tests (including preferences and content labels), and browser execution of the built
ESM entry. They are **not yet a published release audit**: no package has been published, no
independent review has occurred, peak memory was not profiled, and a network-disabled execution
of the suite was not performed. Release claims still require the full §12 gate.

The approved architecture makes these properties enforceable: runtime modules are not
permitted network or storage capability, telemetry code, or a dependency intended to provide
one. Verification is a release gate, not an assumption.

---

## 2. Package Installation vs Runtime Behaviour

It is important to distinguish two different activities:

| Activity | Network access | Data sent to maintainers | Controlled by |
| --- | --- | --- | --- |
| Installing or updating the package | Yes — npm registry, possibly a proxy/mirror | Package name/version download metadata handled by npm; no application data | Developer / package manager |
| Reading documentation or repository | Yes — web/Git hosting | Standard web request metadata | Developer |
| Running Recomet in an application | **No** | **None** | Local process only |
| Building an application that bundles Recomet | Depends on the developer's build tooling | No Recomet runtime data | Developer's toolchain |

- `npm install` contacts a registry. That is package management, not Recomet runtime.
- Recomet does not operate an update checker, license server, configuration service, or
  remote feature flag service.
- The design prohibits phoning home at import time, initialization, or recommendation time.
- If a future optional adapter performs network I/O, it must be explicit, documented,
  implemented/controlled by the developer, and never required for core use. It is not part
  of the implemented phases.

---

## 3. Data Recomet Processes

Recomet processes only what the integrating application supplies in a call.

Recomet's supported input boundary is JSON-compatible data. Arbitrary live JavaScript objects,
including proxies, can execute host code during inspection and are not a supported way to pass
untrusted data. See [SECURITY.md §4.4](./SECURITY.md#44-javascript-object-inspection-boundary).

### Implemented phases

| Data | Required | Purpose | Retained? |
| --- | --- | --- | --- |
| Content item IDs | Yes | Identify candidates and results | Only for the duration of the call; not stored |
| Content attributes (optional JSON-like metadata) | No | Contract validation; mapped label attributes read only when needed by implemented strategies | Validated in memory; mapped values normalized transiently; not copied into results |
| Recommendation limit | No | Bound output size | Stored as a number for the call |
| Excluded item IDs | No | Filter candidates | Converted to an in-memory set for the call; discarded |
| Explicit preferences (`preferences.interests`, per request) | No | Content relevance from caller-supplied labels | Normalized transiently for the call; not persisted, not associated with a user, not learned |
| Collaborative `userId` and `interactions` (per request) | Conditional (Phase 3 collaborative) | Neighborhood-based collaborative filtering from explicitly supplied data | Validated and processed in memory for the call only; **not retained** after the call; no automatic collection, persistence, telemetry, or transmission |
| Configuration | At initialization | Engine limits/strategy/content/collaborative settings | Frozen in the engine instance for its lifetime |

### Later phases (contracts defined now, not accepted)

- User identifiers, profiles, and interaction signals.
- Automatic interest learning, collaborative signals, and hybrid personalization.
- These will be processed locally only when the corresponding capability is implemented.
- They must never be sent to maintainers or a central service.
- Their retention will remain the integrating application's responsibility.

### What Recomet does not need

- Names, email addresses, addresses, phone numbers, government identifiers, or payment data.
- Precise location, contacts, photos, or device fingerprints.
- Authentication secrets, credentials, or tokens.
- Data from other applications.

Developers should not supply unnecessary personal data. Pseudonymous, application-scoped
user IDs are preferable to directly identifying information.

---

## 4. Data Flow

```mermaid
flowchart LR
    subgraph Host["Integrating application environment"]
        App[Application]
        Data[(Application data)]
        Engine[Recomet engine]
        Mem[(Transient in-memory<br/>request state)]
        Result[Recommendation result]

        Data -->|developer supplies request| App
        App -->|in-process call| Engine
        Engine -->|validated data| Mem
        Mem -->|scores, item IDs| Result
        Result --> App
        Mem -.->|released after call| GC[Garbage collection]
    end

    Engine -.x|no network| Maintainer[Recomet maintainers]
    Engine -.x|no telemetry| Analytics[Analytics services]
    Engine -.x|no hidden storage| Disk[(Disk / browser storage)]
```

### Lifecycle of a request

1. Application constructs a request from its own data and, optionally, explicit preferences.
2. Engine validates inputs in memory and normalizes preference labels and mapped content
   signals only for the call.
3. Candidate IDs, exclusions, scores, and selected results exist transiently.
4. Attributes and preference labels are not retained after the call.
5. Result is returned as new objects containing item IDs, scores, explanations, and counts.
   Preference values and content labels are not included.
6. Transient structures become unreachable and are eligible for garbage collection.
7. No cache, profile store, log, metric, file, or network event is produced.

The exact time of garbage collection is controlled by the JavaScript runtime, not Recomet.
Recomet does not pin request data in module-level structures.

---

## 5. No Collection by Maintainers

Maintainers are designed not to receive end-user data because:

- No server endpoint, account, API key, or SDK telemetry channel is permitted.
- Runtime code is required to have no network capability or analytics dependency.
- Errors are designed to be returned to the local caller and never reported remotely.
- No crash reports, feature flags, usage counters, or remote logging are permitted.
- The npm package must not run install-time scripts that could collect data.

### Voluntary communication

Developers may voluntarily open a public issue or security report. That communication is
chosen by the developer and handled by GitHub. Developers must:

- Use synthetic data in reports and examples.
- Never paste real end-user data, production identifiers, secrets, or private content.
- Share only what is necessary to reproduce an issue.

Voluntary report content is not "collected by Recomet" as part of library operation.

---

## 6. No Telemetry, Tracking, or Analytics

The core library is required to contain and continue to contain:

- No analytics SDKs, pixels, beacons, or event queues.
- No unique installation IDs, device fingerprints, or pseudonymous tracking IDs.
- No usage counters, timing beacons, or "anonymous statistics".
- No A/B testing or remote configuration.
- No advertising identifiers or audience segments.
- No crash or performance reporting to maintainers.

Recommendation results are returned only to the calling application. The application may
choose to display, log, or transmit them; that is outside Recomet's control and must be
documented by the application to its users.

---

## 7. No Runtime External Communication

Runtime modules must not use:

- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, or DNS APIs.
- Node.js `http`, `https`, `net`, `dns`, `tls`, or equivalent modules.
- Remote dynamic imports, remote configuration, or model downloads.
- External AI APIs, hosted vector databases, or recommendation services.
- Web workers or service workers created for network coordination.

The package targets **zero runtime dependencies**, reducing the chance that a transitive
package introduces network behaviour. Any dependency addition requires explicit review for
network and data-flow implications.

### Verification approach

1. Static source scan for network APIs and Node built-ins in `src/` and built output.
2. Dependency count check (`dependencies` must be empty in Phase 1).
3. Bundle inspection for unexpected code.
4. Runtime tests executed with network access disabled.
5. Test spies/mocks that fail on network API use.
6. Packed tarball inspection for install scripts or hidden artifacts.
7. Review of all new runtime dependencies for network capability.

**Recorded evidence (2026-11-05):** checks 1, 2, 3 (static policy test and package
inspection), and 6 were executed. The policy test scans all runtime source for network, Node
built-in, filesystem, storage, subprocess, and dynamic-code capabilities, and verifies the
packed-file allowlist. `dependencies` is empty. Checks 4 and 5 were not executed as an
OS-level network-disabled process; the static scan and absence of runtime dependencies support
the design but are not a substitute. No claim of a fully audited "network-free" release is made
until the remaining checks run for a published artifact. Development dependency advisories are
tracked separately in [SECURITY.md](./SECURITY.md#103a-development-dependency-advisory-tracked-open).

---

## 8. No Mandatory Database or Persistence

- Recomet core does not require a database, file system, object store, browser storage, or
  cache.
- The implemented phases store nothing between calls except immutable configuration inside the
  engine instance created by the developer. Explicit preferences are not cached or persisted.
- No cookies, `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, service worker, or
  filesystem write is performed.
- Multiple engine instances are isolated; no shared global store exists.

### Optional developer-controlled persistence (future)

Any future persistence must satisfy all of:

1. Off by default.
2. Explicitly configured by the integrating developer.
3. Implemented in the developer's environment or through a reviewed adapter.
4. Documented with data categories, retention, access, and security implications.
5. Never able to send data to maintainers by default.
6. Removable without breaking core in-memory operation.
7. Subject to privacy/security review before release.

Recomet will not become a data controller or processor for application data merely because
an optional adapter exists.

---

## 9. Isolation Between Applications

- Each application is intended to run its own copy of Recomet in its own process/context.
- Each engine instance will have its own frozen configuration.
- The design provides no central index, shared cache, cross-application profiling, or global
  user graph.
- Application A is not able to access application B's data through Recomet.
- Recommendations will be computed only from the data supplied in that application's call.
- Package updates must not transfer application data to maintainers.

---

## 10. Privacy Boundaries and Developer Responsibilities

Recomet is designed to provide a privacy-preserving processing library. It cannot guarantee
the privacy practices of the application that embeds it.

The integrating developer remains responsible for:

- Lawful basis, consent, notices, and user rights under applicable law.
- Collecting only necessary signals and minimizing personal data.
- Implementing reset, preference adjustment, export, deletion, and opt-out controls.
- Securing application storage, transport, logs, and backups.
- Deciding whether and where results are persisted or transmitted.
- Ensuring that recommendation outputs do not expose private content or infer sensitive
  traits inappropriately.
- Avoiding the use of recommendation scores for authorization, eligibility, pricing, or
  other high-impact decisions without separate governance and legal review.
- Complying with the terms of any dataset used to evaluate or configure the application.

Recomet cannot prevent a host application from logging inputs, sending results to a server,
or combining data with other sources. Developers should disclose their own data practices.

---

## 11. Sensitive Data Guidance

- Prefer pseudonymous IDs scoped to the application.
- Do not place secrets, credentials, or special-category personal data in free-form
  attributes or preference labels unless the application has a lawful basis and appropriate
  safeguards.
- The engine does not copy attributes or preference labels into results, but avoiding
  unnecessary data remains the safer practice.
- Error messages are designed to be value-free, but the host application's own logs may not
  be. Review them.
- Browser applications should consider memory inspection, extensions, and shared devices.
- Because processing is local, deleting application data will be sufficient to remove
  Recomet's input; Recomet is designed to retain no copy.

---

## 12. Verification Methods for Privacy Guarantees

Privacy claims must be testable. For each release:

### 12.1 Source and build inspection

- Search runtime source and build output for network, storage, telemetry, and eval APIs.
- Confirm `dependencies` is empty (Phase 1) and review dev-only packages.
- Confirm no `preinstall`/`install`/`postinstall` scripts.
- Inspect `npm pack` contents; ensure only intended files are shipped.
- Confirm source maps do not contain local paths or hidden data.

### 12.2 Automated tests

- Run the full suite with network access unavailable.
- Fail tests if `fetch`, XHR, WebSocket, Node network modules, or storage APIs are called.
- Assert no console output is produced during normal and error paths.
- Assert results contain only documented fields and no attribute/user data.
- Assert repeated calls do not retain references to prior requests (for example by
  overwriting inputs after the call and confirming results are unaffected).
- Verify multiple engine instances do not share state.

### 12.3 Dependency and supply-chain review

- Maintain a reviewed dependency list.
- Run dependency audits and report results.
- Review install scripts and transitive packages.
- Use lockfiles and pinned CI tooling.
- Prefer packages with clear maintenance and provenance.

### 12.4 Independent review

- Security/privacy-focused review for changes touching data flow, dependencies, build, or
  error handling.
- Reproducible build/benchmark methods documented so others can verify.
- Public documentation of any privacy-relevant limitation discovered.

### 12.5 What cannot be verified from inside the library

- The host application's own telemetry, logs, storage, and network calls.
- npm registry or CI infrastructure behaviour.
- Browser extensions, operating-system crash reporting, or developer debugging tools.
- Whether a developer supplies data to another library or service.

These are outside Recomet's runtime boundary and must not be implied as covered guarantees.

### 12.6 Executed checks (2026-11-05)

Local results on Node.js `v24.18.0` (reference runtime) and Node.js `v22.23.4`
(temporary-runtime compatibility check), Windows x64:

- **Source/build scan:** the static policy test found no network, Node built-in, filesystem,
  storage, subprocess, dynamic-code, telemetry, or logging capability in `src/`.
- **Dependencies:** `package.json` declares no runtime dependencies; the package ships ESM
  output, declarations, `package.json`, `LICENSE`, and `README.md`.
- **Package inspection:** `npm pack --dry-run --json` showed no install scripts, source maps,
  local paths, or unexpected files.
- **Result minimization:** tests confirm results contain only item IDs, ranks, scores, fixed
  explanation fields, and counts. Attribute keys/values and preference/content labels are not
  copied into results or errors.
- **Retention and isolation:** tests confirm input objects are not mutated or retained, results
  are fresh per call, and instances do not share configuration or request state.
- **Browser execution:** the built ESM entry passed 18/18 checks in Edge, Chrome, and Firefox.
  Safari and WebKit were not executed and remain unverified.
- **Not executed:** a network-disabled test process, test spies that fail on network API use,
  peak-memory profiling, and published-package verification. The browser harness itself uses a
  local loopback HTTP server to serve test files; the runtime library does not.
- **Audit:** development-only findings in the ESLint dependency chain, no high/critical
  findings, and no shipped runtime dependency affected.

---

## 13. Incident Response for Privacy Issues

If a privacy issue is discovered:

1. Report privately via the process in [SECURITY.md §11](./SECURITY.md#11-vulnerability-reporting-and-response).
2. Maintainers assess whether runtime data handling, dependencies, packaging, or
   documentation caused the issue.
3. A fix, regression test, advisory, and release follow the security process.
4. If user data could have been exposed, maintainers state clearly what Recomet could and
   could not have transmitted, without speculation.
5. Documentation is corrected immediately if a claim was inaccurate.

---

## 14. Future Changes

Any proposed feature that would:

- add runtime network access,
- add telemetry or analytics,
- persist data by default,
- add a hosted component,
- add an external AI/model API,
- or change what data leaves the process,

must be rejected for the core library or handled as an explicit, separately reviewed,
developer-controlled integration that is off by default. Such a change is not a routine
feature request and requires a specification change plus privacy and security review.

Phase 2 contains no such feature. See [ROADMAP.md](./ROADMAP.md) for approved phases.

---

## 15. Related Documents

- [SPECIFICATION.md](./SPECIFICATION.md) — data handling requirements.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — storage-agnostic design and request lifecycle.
- [SECURITY.md](./SECURITY.md) — threat model and verification controls.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — review requirements for privacy-sensitive changes.
