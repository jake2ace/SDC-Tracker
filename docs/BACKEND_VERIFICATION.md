# Integrated backend verification

Verified locally on 2026-10-22 (MYT), using Node.js and temporary SQLite databases.

## Automated result

`node --test --test-reporter=tap tests/*.test.mjs`: **431 passed, 0 failed**.

- Both Lumen and Rantau complete real HTTP → SQLite workflows: milestone → owner approval → finance issue → overdue reminder → explicit send → full payment → forecast refresh.
- Accounting and outbox failures are retried without duplicates; role and company boundaries apply before replay. Unrelated company forecasts remain unchanged.
- Payment and human edits during model generation prevent stale responses from overwriting current state. Reset during generation returns `409`.
- Model calls use the real guardrail adapter with a deterministic fake transport. Tests verify outgoing requests omit business facts and reject hostile model output. No live key call was made during this integration verification.
- AI call budgets, cross-company concurrency, PATCH CORS, exact Host allowlisting, body limits and unsafe rejection text are checked through HTTP.
- State and logs survive a database reopen; reset restores the supplied seed. Existing module, contract and 40-case forecast tests also pass.

The former foundation tests expecting implemented routes to return `404` were updated to verify real results, permission failures and unapproved issuance. Unknown routes still fail closed.

## Delivery boundary

The backend mounts all business modules against one SQLite store. It uses explicit synthetic demo identities; this is not production authentication. Accounting and outbox are simulations. The final frontend belongs to Claude and still needs browser-level acceptance against the integrated API. No deployment or live Orbyte integration is claimed.

Start and frontend contract: [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md). Keep Issues open until the team has completed the final frontend and deployed-demo acceptance.
