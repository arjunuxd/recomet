# Contributing to Recomet

Thank you for considering a contribution. Recomet handles recommendation logic that may
process personal preference data, so contributions are reviewed for correctness, privacy,
security, and long-term maintainability — not only whether they work.

**Status:** Phase 0 finalised. Phase 2 accepted by the maintainer (2026-11-05; independent audit
`APPROVE WITH CONDITIONS`; documented limitations remain visible). Phase 3 collaborative filtering
(collaborative-only) is **accepted** by the maintainer (2026-11-07). Phase 4 explicit `hybrid`
strategy (implemented subset) is **formally accepted** by the maintainer (2026-11-07), subject to
documented limitations; hybrid personalization (`R23`) remains deferred unless separately approved.
Phase 5 advanced ranking/discovery is **formally accepted** by the maintainer (2026-11-13, subject
to documented limitations and deferred features); Phase 6 is not started and requires separate
authorization. Historical evidence is preserved in [`docs/development/`](./docs/development/).
Please coordinate before starting significant work.

---

## 1. Governance

- Recomet is **core-team-controlled**.
- The repository owner initially controls core development and official releases. Additional
  maintainers are documented only when appointed; this document does not invent a roster.
- Community members may propose features, report bugs, submit pull requests, and participate
  in design discussion.
- Designated maintainers control official development, roadmap changes, releases, and
  package publishing.
- Consensus is sought where practical, but maintainers make final decisions to protect
  scope, quality, security, and privacy.
- No contribution is merged merely because it is large, popular, or complete; scope fit and
  review capacity matter.
- Maintainer roles, release approvers, and security owners are recorded by the project when
  appointed.

### Phase gates

- Phase 2 is accepted (2026-11-05). Phase 3 is authorized for collaborative filtering only; hybrid recommendations and hybrid personalization are deferred to Phase 4 by explicit maintainer decision.
- Each later phase requires the previous phase's acceptance criteria and maintainer approval.
- Pull requests that implement later-phase features early will be deferred, even if useful.

---

## 2. Ways to Contribute

- Bug reports with minimal synthetic reproduction.
- Documentation fixes and examples using synthetic data.
- Tests for edge cases, failures, and regressions.
- Security reports through the private process (never a public issue).
- Performance measurements with reproducible methods.
- Design proposals that respect the approved scope and privacy model.
- Accessibility and developer-experience improvements to documentation.
- Dataset suggestions with clear licensing and provenance.

Please open an issue before large changes, new dependencies, public API changes, new
capabilities, or anything touching data flow, packaging, or security.

---

## 3. Development Workflow

### 3.1 Before coding

1. Check existing issues and the roadmap to avoid duplicate or out-of-scope work.
2. For non-trivial changes, open a proposal describing problem, approach, alternatives,
   security/privacy impact, and tests.
3. Wait for maintainer direction on scope. This prevents wasted effort and accidental
   later-phase implementation.
4. Never include real end-user data, credentials, or private content in issues, fixtures, or
   commits.

### 3.2 Branches and commits

- Branch from `main`; do not commit directly to `main` unless you are a maintainer performing
  a reviewed release action.
- Use descriptive branch names, for example `feat/phase-1-validation` or
  `fix/limit-error-code`.
- Keep commits focused and reviewable. Conventional Commit prefixes (`feat:`, `fix:`,
  `docs:`, `test:`, `chore:`, `security:`) are recommended.
- Do not rewrite published history or force-push shared branches.
- Rebase or merge according to maintainer preference; keep the final history understandable.

### 3.3 Pull requests

A pull request must include:

- **Problem:** what is wrong or missing, with a synthetic example.
- **Approach:** what changed and why; alternatives considered for significant decisions.
- **Scope:** which phase and requirement(s) it addresses; explicit confirmation it does not
  implement deferred features.
- **Tests:** what was added or changed and the commands actually executed with results.
- **Documentation:** what was updated, or why no documentation change is needed.
- **Security/privacy:** impact assessment, especially for input validation, errors,
  dependencies, build, packaging, or data flow.
- **Breaking changes:** whether any public behaviour changes and migration notes.
- **Dependencies:** for every new dependency, the review information required in §7.
- **Checklist:** completed PR checklist once the template exists.

Draft pull requests are welcome for early feedback. A draft is not merged until checks and
review are complete.

### 3.4 Review expectations

- At least one maintainer approval is required for routine changes.
- Security-, privacy-, release-, dependency-, or public-API-relevant changes require review
  by a maintainer with the relevant responsibility and, where possible, a second reviewer.
- Authors must respond to review comments or explain disagreement with evidence.
- Maintainers may request smaller PRs, additional tests, or removal of out-of-scope work.
- Review is about the change, not the contributor; be respectful and specific.

---

## 4. Testing Requirements

### 4.1 Required for all code changes

- Unit tests for new or changed behaviour.
- Integration tests where modules interact or public behaviour is exercised.
- Edge cases and failure paths, not only the happy path.
- Regression test for every bug fix. The test should fail before the fix and pass after.
- Tests must be deterministic: no network, wall-clock dependence, randomness without a fixed
  seed, or reliance on execution order.
- Use synthetic fixtures only. Never commit real user data or unlicensed datasets.

### 4.2 Security and privacy tests

Changes touching validation, limits, errors, configuration, dependencies, build, packaging,
or data handling must include or update tests for:

- Malformed and unexpected object shapes.
- Prototype-pollution keys at every depth.
- Accessors, symbols, exotic objects, cycles, and shared references.
- Proxy traps: document that inspection can run host code, throw, or block, and do not claim
  containment. Verify sanitized error reporting only.
- Resource-exhaustion boundaries.
- Safe error messages containing no input values, IDs, attribute keys, or preference/content
  labels.
- No network, filesystem, telemetry, storage, or console output.
- No retention of input references after a call.

### 4.3 Compatibility

- Core runtime changes must pass Node.js and browser tests where available.
- Do not introduce Node built-ins, DOM APIs, `eval`, or platform-specific code into core.
- New APIs must be usable from TypeScript with strict settings.

### 4.4 Commands

The repository provides these commands; run them and report actual results:

```text
npm run typecheck     # tsc --noEmit
npm test              # unit, integration, security, regression tests
npm run lint          # ESLint
npm run format:check  # Prettier check on source, tests, scripts, and config
npm run build         # TypeScript declaration and ESM build
npm run verify        # typecheck + lint + format + tests + build
npm audit             # dependency audit
npm run pack:check    # inspect packed package contents
npm run bench         # reproducible synthetic benchmarks
npm run test:browser  # real installed Edge/Chrome/Firefox; reports others unverified
```

Do not claim a command passed unless it was executed. Report failures honestly; do not
disable tests to make a PR green without maintainer approval.

**Recorded results (2026-11-05):** `npm run verify` passed with 197 tests across 12 files (the
current Phase 2 verification snapshot) and a successful build on Node.js `v24.18.0` (reference
runtime). The 197-test suite and type check also passed on Node.js `v22.23.4` as a
temporary-runtime compatibility check. Historical Phase 1 verification recorded 136 tests
across 9 files. `npm run test:browser` passed 18/18 checks in Edge `156.0.4314.58`, Chrome
`156.0.8078.80`, and Firefox `160.0`; Safari and WebKit were not executed and remain
unverified. `npm run bench` recorded the results in SPECIFICATION §10.2. `npm audit` reported
development-only findings in the ESLint chain and no high/critical findings (see
[SECURITY.md](./SECURITY.md#103a-development-dependency-advisory-tracked-open)). These results
describe the reference machine and are not release guarantees.

### 4.4a Temporary Node.js 22 compatibility verification (optional, recorded 2026-11-05)

The project's supported Node.js version remains `>=22` as declared in `package.json`. The
locally installed Node.js version and a temporary runtime used for compatibility verification
are different things. Do not add a permanent Node version manager, do not add dependencies, and
do not change `package.json` scripts or the supported Node.js floor as part of this check.

If Node.js 22 is not installed locally, a temporary runtime can be used for a focused
compatibility check. The following procedure was used on 2026-11-05 (Windows, npm available;
network access is required only for npm to obtain the temporary runtime package if it is not
already cached):

```powershell
# Temporary runtime only; does not modify project dependencies.
npx -y node@22 ./node_modules/typescript/bin/tsc -p tsconfig.json
npx -y node@22 ./node_modules/vitest/vitest.mjs run
```

Record the actual Node.js version reported by the temporary runtime and the actual command
results. On 2026-11-05 this produced Node.js `v22.23.4` and passed the type check and all 197
tests. A transient npx module-path message may appear before success in some environments;
treat the final command result as authoritative and report any real failure. This is
temporary-runtime evidence, not a claim that every local environment is configured identically.

### 4.5 Benchmarks and quality evaluation

- Performance claims require reproducible benchmarks with hardware, runtime, dataset shape,
  iterations, warm-up, and memory method recorded.
- Recommendation-quality claims require a defined metric, dataset provenance/license, and
  actual results. Synthetic data is preferred until licensed datasets are approved.
- Do not add numbers to documentation that were not measured.
- Resource-limit defaults and hard caps are provisional until benchmarks validate them; do not
  present them as performance results.
- Do not tune algorithms against test data in a way that invalidates evaluation.

---

## 5. Code Quality Expectations

- TypeScript `strict` mode; no `any` at public boundaries; validate `unknown`.
- Match existing structure, naming, and patterns; avoid unrelated rewrites.
- Keep modules focused. No giant engine file, circular dependencies, or duplicate logic.
- Separate public API from internal algorithms; do not leak candidate/ranker internals.
- Store no mutable global state. Engine instances must be independent.
- Prefer standard ECMAScript and native functionality over dependencies.
- Handle errors explicitly with typed `RecometError` codes; never log or leak data.
- Avoid premature abstraction, microservices, background workers, and unnecessary caches.
- Document public types, options, limits, error codes, and non-obvious algorithms.
- Keep comments accurate and useful; do not narrate obvious code.
- Do not reformat unrelated files or change line endings across the repository.

### Type and API changes

- Public API changes require a proposal and compatibility review.
- Adding optional fields may be a minor change; changing meaning or removing fields is a
  major change.
- Error codes are stable within a major version.
- Internal modules may change without notice; public exports may not.

---

## 6. Security and Privacy Review Requirements

### 6.1 Non-negotiables

Contributions must not add to the core library:

- Telemetry, analytics, tracking, advertising, or remote logging.
- Runtime network calls to maintainers or third parties.
- External AI APIs, hosted vector stores, or model downloads.
- Mandatory cloud services, accounts, databases, or authentication.
- Hidden storage or persistence.
- Collection or transmission of end-user data.
- Unsafe dynamic code execution (`eval`, `new Function`, remote dynamic imports).
- Arbitrary filesystem, process, environment, or subprocess access in core.
- Hardcoded secrets, tokens, or credentials.
- Unbounded input processing or output size.
- Silent fallbacks that hide invalid data or bypass limits.

### 6.2 Required review triggers

A change requires explicit security/privacy review if it touches:

- Public entry points, request handling, or validation.
- Free-form attributes, preferences, mapped content signals, object traversal, ID indexing, or
  the JavaScript object-inspection/proxy boundary.
- Resource limits or complexity characteristics.
- Error construction or error serialization.
- Logging, console output, or debugging hooks.
- Dependencies, install scripts, build tooling, or package exports.
- Storage, persistence, adapters, or any I/O.
- Configuration and default behaviour.
- Ranking scores, explanations, or anything that could expose inferred sensitive traits.

### 6.3 Privacy impact assessment

For privacy-relevant changes, describe:

1. What data is read, transformed, retained, or emitted.
2. Whether any data can leave the process, and how that is prevented.
3. Whether inputs are still released after the call.
4. Whether results contain more than the documented minimum.
5. Whether the change introduces cross-request or cross-instance state.
6. How the claims are verified by tests or static inspection.

### 6.4 Vulnerability handling

- Report vulnerabilities privately via GitHub Security Advisories:
  `https://github.com/arjunuxd/recomet/security/advisories/new`
- Do not open a public issue, PR, or discussion with exploit details before coordinated
  disclosure.
- Do not include real user data or secrets in a report.
- Maintainers follow the response process in [SECURITY.md](./SECURITY.md).

---

## 7. Dependency Policy

### 7.1 Runtime dependencies

The target is **zero runtime dependencies**. Any proposal to add one must include:

1. Exact purpose and why native functionality is insufficient.
2. Alternatives considered, including internal implementation.
3. Maintenance status, release cadence, and bus factor.
4. Known vulnerabilities and security history.
5. Transitive dependency count, install scripts, and network behaviour.
6. License compatibility with Apache 2.0.
7. Bundle size and performance impact.
8. Why the dependency is safe to ship to every integrating application.

Maintainers may reject any runtime dependency, regardless of convenience.

### 7.2 Development dependencies

- Keep the toolchain minimal and justified.
- Lockfile changes are reviewed like source changes.
- No unexplained install scripts or binary downloads.
- Run dependency audit before release and report results.
- Dev dependencies must not be shipped in the runtime package or become runtime imports.
- Review updates deliberately; do not blindly bump versions.

### 7.3 Generated and third-party code

- Do not copy code without a compatible license and attribution.
- Do not add AI-generated code unless you can verify correctness, licensing, and provenance.
- Dataset contributions require license, source, and usage documentation.
- Vendored code requires maintainer approval and a recorded rationale.

---

## 8. Documentation Requirements

Documentation is part of the product. PRs that change public behaviour must update:

- API reference and contracts.
- Configuration and limits.
- Error codes and failure behaviour.
- Examples using synthetic data.
- Compatibility and migration notes when applicable.
- Privacy/security implications when applicable.

Rules:

- Never document unimplemented features as completed.
- Distinguish planned, experimental, and stable behaviour.
- Do not claim performance, quality, or scalability that was not measured.
- Keep examples compiling or clearly marked as illustrative.
- Use inclusive, precise language and consistent terminology.
- Update the changelog for user-visible changes once a changelog exists.

---

## 9. Licensing and Contributions

- Recomet is licensed under the Apache License 2.0 (see [LICENSE](./LICENSE)).
- Unless you explicitly state otherwise, contributions intentionally submitted for inclusion
  are accepted under the terms of the Apache License 2.0, consistent with Section 5.
- You must have the right to submit your contribution and must not include code, data, or
  assets under incompatible terms.
- Do not add copyright notices, `NOTICE` content, or ownership claims without maintainer
  approval. The project copyright holder and `NOTICE` content are not finalised; no ownership
  details have been invented.
- No mandatory CLA or DCO is required at this stage. Contributions are governed by Apache
  License 2.0 Section 5. This may be revisited only if a concrete governance requirement
  appears, with contributors informed before any new agreement is required.

---

## 10. Release Governance

Only designated maintainers may publish releases.

### 10.1 Release process

1. Confirm scope matches the approved phase and roadmap.
2. Ensure all quality gates in [ROADMAP.md](./ROADMAP.md) pass with recorded results.
3. Update changelog, version, migration notes, and documentation.
4. Review dependency and security status.
5. Verify no telemetry, network, persistence, or data-collection regressions.
6. Inspect the packed artifact (`npm pack --dry-run` and actual tarball contents).
7. Obtain two-person review where the maintainer roster allows; otherwise record the
   limitation.
8. Publish with npm 2FA and least-privilege access.
9. Tag the release and publish notes/advisories as needed.
10. Announce support/LTS commitments only if capacity is confirmed.

### 10.2 Versioning

- MAJOR: breaking public API/contract/behaviour change.
- MINOR: backward-compatible feature or option.
- PATCH: backward-compatible fix, documentation, or security update.
- Pre-1.0 breaking changes are documented explicitly in the changelog and migration notes.
- Error codes and public types follow the same stability expectations.

### 10.3 Release blockers

- Failing tests, type check, lint, format, build, or audit.
- Known high/critical vulnerability in shipped code.
- Unknown runtime dependency or unreviewed install script.
- Privacy/security regression or unverified claim in documentation.
- Incomplete changelog/migration notes for user-visible changes.
- Missing maintainer approval.

---

## 11. Reporting Bugs and Proposing Features

### Bug reports

Include:

- Recomet version/commit and runtime (Node.js/browser version).
- Minimal reproduction with synthetic data.
- Expected vs actual behaviour.
- Relevant error code (not raw production data).
- Security/privacy impact, if any.

Do not include real end-user data, credentials, or private content.

### Feature proposals

Include:

- Problem and use case.
- Which approved phase/capability it belongs to.
- Proposed API/contract changes.
- Privacy/security implications.
- Alternatives.
- Evaluation and test plan.

Proposals outside the approved roadmap may be recorded for later consideration but are not
automatically accepted.

---

## 12. Code of Conduct and Communication

- Be respectful, constructive, and specific.
- Critique ideas and code, not people.
- Assume good faith while requiring evidence for claims.
- Do not pressure maintainers for timelines or unreviewed features.
- Avoid sharing sensitive data in any channel.
- Harassment, discrimination, or disclosure of private information is not acceptable.

A formal Code of Conduct document is an open governance item; until adopted, these
expectations apply to all project spaces.

---

## 13. Contributor Checklist

Before requesting review:

- [ ] Change is in the approved phase and scope.
- [ ] Problem, approach, and alternatives are described.
- [ ] Tests cover success, edge cases, failures, and regressions.
- [ ] Security/privacy impact is assessed; no forbidden capabilities added.
- [ ] No real user data, secrets, or unlicensed content included.
- [ ] Documentation updated; no unimplemented feature presented as complete.
- [ ] No new dependency without justification and review.
- [ ] Type check, lint, format, tests, build, and audit run and results reported.
- [ ] Public API/compatibility impact documented.
- [ ] PR is focused and free of unrelated rewrites.
- [ ] License/provenance requirements satisfied.

---

## 14. Related Documents

- [SPECIFICATION.md](./SPECIFICATION.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [SECURITY.md](./SECURITY.md)
- [PRIVACY.md](./PRIVACY.md)
- [ROADMAP.md](./ROADMAP.md)
- [LICENSE](./LICENSE)
