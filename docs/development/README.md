# Development Documentation

This directory preserves Recomet development history and holds non-speculative active planning material.

## Structure

- [`phase-history/`](./phase-history/) — preserved historical records by project phase (acceptance records, audits, remediations, design/spec/criteria/risk artifacts, and implementation reviews). These documents are **historical evidence**: original filenames, findings, verdicts, dates, technical evidence, and decisions are preserved.
  - [`phase-history/phase-0/`](./phase-history/phase-0/) — reserved for Phase 0 historical records (none currently archived as separate phase-named files).
  - [`phase-history/phase-1/`](./phase-history/phase-1/) — reserved for Phase 1 historical records (none currently archived as separate phase-named files).
  - [`phase-history/phase-2/`](./phase-history/phase-2/) — Phase 2 acceptance record.
  - [`phase-history/phase-3/`](./phase-history/phase-3/) — Phase 3 acceptance, audits, and remediation records.
  - [`phase-history/phase-4/`](./phase-history/phase-4/) — Phase 4 acceptance, design/approval/spec/architecture/criteria/risk, audit, remediation, and implementation records.
- [`active/`](./active/) — placeholder for future approved planning work. **No speculative Phase 5 documents are included.**

## Current project status (summary)

- Phases 0–2: accepted per recorded evidence.
- Phase 3 (collaborative-only): **formally accepted** by the maintainer (2026-11-07, independent audit `APPROVE WITH CONDITIONS`), subject to documented limitations. See [`phase-history/phase-3/PHASE3_ACCEPTANCE.md`](./phase-history/phase-3/PHASE3_ACCEPTANCE.md).
- Phase 4 (explicit `hybrid` strategy, availability-aware fusion, implemented subset): **formally accepted** by the maintainer (2026-11-07, independent audit `APPROVE WITH CONDITIONS`; F-01/C-01 remediated with exact G1–G10 golden-vector tests), subject to documented limitations. **Hybrid personalization (`R23`) remains deferred** unless separately approved. See [`phase-history/phase-4/PHASE4_ACCEPTANCE.md`](./phase-history/phase-4/PHASE4_ACCEPTANCE.md), [`phase-history/phase-4/PHASE4_FINAL_ACCEPTANCE_AUDIT.md`](./phase-history/phase-4/PHASE4_FINAL_ACCEPTANCE_AUDIT.md), and [`phase-history/phase-4/PHASE4_ACCEPTANCE_REVIEW.md`](./phase-history/phase-4/PHASE4_ACCEPTANCE_REVIEW.md).
- Phase 5: **not started** and requires separate maintainer authorization.

Root documents ([`README.md`](../../README.md), [`SPECIFICATION.md`](../../SPECIFICATION.md), [`ARCHITECTURE.md`](../../ARCHITECTURE.md), [`SECURITY.md`](../../SECURITY.md), [`PRIVACY.md`](../../PRIVACY.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md), [`ROADMAP.md`](../../ROADMAP.md)) describe the current project, guarantees, and roadmap; historical phase details and evidence remain in `phase-history/`.
