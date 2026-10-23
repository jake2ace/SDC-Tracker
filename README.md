# Milestone2Cash Proof-to-Cash

SDC Hackathon 2026 · Team Lets go · Domain 2

Help Malaysian service micro-businesses invoice completed milestones, follow up on overdue invoices, and check a customer's payment claim against imported bank credits before recording payment.

## Current status

**Planning and clean rebuild. This branch does not yet contain a runnable application.** The previous prototype and local validation evidence were backed up before its implementation was removed. Old test results are not evidence that this rebuild works.

The repository identity, collaborators, Apache 2.0 licence and Git history are retained. The final product direction is **Proof-to-Cash**, not OrderLah.

## One connected journey

Milestone completed → invoice draft → Owner approval → overdue reminder draft → Finance confirmation → customer reply or synthetic receipt → local OCR and structured extraction → deterministic bank-credit matching → Finance approval of the matched amount → remaining balance, reminders, 30-day forecast and audit log updated.

A partial payment reduces the outstanding balance. Only full settlement stops all remaining collection reminders. A screenshot or AI answer alone never proves that money arrived.

## Work plan and responsibilities

- [Eight-step plan](docs/ISSUE_PLAN.md): dependencies, owners and acceptance evidence.
- [Product specification](docs/PRODUCT_SPEC.md): scope, safeguards and decisions still to freeze.
- [Claude frontend handoff](docs/CLAUDE_HANDOFF.md): frontend boundaries and first action.
- [Decisions](docs/decisions.md): reset authority and implementation assumptions.

Codex coordinates the scope, API contracts, backend, integration and verification. Claude implements the frontend in `web/` after the shared contract is frozen. Team members retain product decisions, review, truthful evidence and final submission responsibility.

Proposed implementation layout: `src/` (Node.js backend), `web/` (frontend), `contracts/`, `data/seed/`, `data/eval/`, `tests/`, `eval/` and `scripts/`. Directories and run commands will be added by the corresponding implementation tasks; there are no working run/test commands yet.

## Prototype boundaries

Use team-created synthetic messages, receipts, companies and bank statements. WhatsApp sending, bank data, roles and Orbyte integration are simulated. No real payments, bank/WhatsApp API, statutory invoice filing, financial recommendations or image-forgery detection. AI reads language and assists drafting; rules control amounts, matching, approvals and forecasts. Missing AI credentials must lead to explicit manual fallback, not fabricated model success.

## Delivery

After implementation and verification: deploy an accessible demo, retain evidence of Replit use, complete the official PRD and tools declaration, prepare slides and a 5–7 minute video, and verify all submission links. Public visibility, additional account invitations and final submission are separate user-controlled release actions.

All measured results, licences and AI assistance must be declared accurately. Product UI and submission-facing material should use English; internal coordination may use Chinese.

Licensed under [Apache 2.0](LICENSE).
