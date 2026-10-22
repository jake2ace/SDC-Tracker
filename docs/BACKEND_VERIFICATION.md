# Backend foundation verification

Verified locally on 2026-10-22 (MYT), using Node.js v26.9.0 and temporary SQLite databases.

## Automated result

Command: `npm test`

- Tests: **265**
- Passed: **265**
- Failed: **0**
- Includes the Issue #1 contract/golden checks, 13 backend tests, and the invoicing/collections checks from the current main branch.

The initial backend-only snapshot passed 50 tests. After preserving the newly merged Issue #3 and Issue #4 modules and resolving README/environment-example conflicts, the combined suite passed all 265 tests. Business-module HTTP routes remain unmounted in this foundation; no live model call or deployment was performed by this verification.

Backend coverage includes explicit demo opt-in, known-header identity, company-scoped reads, atomic settings validation, owner-only decisions, authorized idempotent replays, terminal rejection, concurrent approve/reject, activity ordering and limits, request/body/CORS validation, restart persistence, complete seed reset, and reusable approval guards.

Unsupported business routes return `404`; they do not produce placeholder invoices, receipts, messages or forecasts. Approval tests use the existing `lumen_draft` golden arrangement in isolated databases. Normal startup and reset still use the exact `data/demo.json` seed.

## Scope checks

- No frontend files or `public/` directory are present in this implementation.
- Issue #1 contracts, seed data, expected results and existing tests are unchanged.
- Newly added backend source, tests and configuration comments are in English.
- Updated README and new backend documentation are presented in English.
- Runtime SQLite data is ignored by Git.
- This local verification was recorded before publication of the backend branch was approved.

## Next review

Use [BACKEND.md](BACKEND.md) to run the service and [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md) to connect the frontend and later business modules. Another team member should review the changes before Issue #2 is closed. Publication requires the user's explicit approval.
