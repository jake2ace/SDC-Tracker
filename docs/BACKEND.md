# Backend foundation

This document details the Issue #2 foundation. Its HTTP server now also mounts Issues #3–#5 against the same SQLite store. Use the [current integration handoff](BACKEND_HANDOFF.md) for the complete endpoint list, AI budget and Host configuration. The existing [API contract](../contracts/api.ts), [domain types](../contracts/domain.ts), and [Issue #1 agreement](DATA_CONTRACT.md) remain authoritative.

## Start locally

Use Node.js **22.13 or later**. The HTTP server and SQLite storage use built-in Node modules, with no third-party runtime dependencies.

```sh
npm start
```

Default configuration:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Network interface to bind. |
| `PORT` | `3000` | HTTP port. |
| `DEMO_MODE` | `false` | Set explicitly to `true` to enable the synthetic demo APIs. |
| `CORS_ORIGINS` | Empty | Comma-separated, exact frontend origins allowed by the server. No wildcard. |

For a frontend running on a separate local origin:

```sh
DEMO_MODE=true CORS_ORIGINS=http://localhost:5173 npm start
```

`http://localhost:5173` and `http://127.0.0.1:5173` are different origins. If both are needed, list both explicitly. CORS permits a browser to read a response; it does not authenticate a caller.

The service does not load `.env` automatically. If you create an uncommitted `.env` file, load it explicitly:

```sh
node --env-file=.env src/server.mjs
```

`GET /health` returns service metadata without a demo identity. `/` is an API-only root and returns a JSON `404`; it does not host the frontend. Demo endpoints are unavailable unless demo mode is explicitly enabled. There is no production authentication system in this foundation.

## Persistence and seed

The backend stores data in `.local/sdc-tracker.sqlite`. The first initialization loads the complete [synthetic seed](../data/demo.json). Restarting the server or refreshing the frontend does not reset saved data.

`POST /api/demo/reset` restores all seed content exactly, including settings and the seed's existing activity records. Reset does not append a new business activity record. It is a destructive local demo control, so use it deliberately. The runtime database and any SQLite sidecar files must remain uncommitted.

The seed contains two synthetic companies and three roles per company:

| Company | Project manager (`pm`) | Owner (`owner`) | Finance (`finance`) |
|---|---|---|---|
| Studio Lumen (`co_lumen`) | `u_lumen_pm` | `u_lumen_owner` | `u_lumen_fin` |
| Rantau Events (`co_rantau`) | `u_rantau_pm` | `u_rantau_owner` | `u_rantau_fin` |

Amounts remain integer **sen**. Business dates use the shared `demoDate`, initially `2026-10-22`; audit timestamps record the actual operation time. Do not replace shared amounts, dates, or identifiers with a separate frontend fixture.

## Demo identity and company selection

Every `/api/*` request in demo mode must send a valid `X-Demo-User` header. Missing or unknown users return `401 UNAUTHENTICATED`. These selectable, synthetic identities demonstrate permissions; they are not real login credentials or secure user authentication.

```sh
curl -H 'X-Demo-User: u_lumen_pm' \
  http://127.0.0.1:3000/api/demo/session
```

The session response follows the full `Session` contract: `settings`, `user`, `company`, `companies`, and `users`. Its `settings.userId` and `settings.companyId` match the header-selected user. Its `demoDate` and `failNext` come from the persisted global demo settings. The company and user lists are synthetic selector metadata.

Business reads and writes derive the company from the header-selected user. A request body or query cannot override that company. An invoice belonging to another company is treated as not found.

`PUT /api/demo/settings` saves the global demo configuration, including a default selected company/user pair. Updating settings does not change the authenticated actor of that request or later requests. The frontend must send the selected user's header on each request. A company switch must include a matching `companyId` and `userId` together; validation completes before any setting is changed.

```sh
curl -X PUT http://127.0.0.1:3000/api/demo/settings \
  -H 'Content-Type: application/json' \
  -H 'X-Demo-User: u_lumen_pm' \
  --data '{"companyId":"co_rantau","userId":"u_rantau_pm"}'

curl -H 'X-Demo-User: u_rantau_pm' \
  http://127.0.0.1:3000/api/projects
```

The global settings are suitable for one shared local demonstration. Concurrent demo operators share the clock and failure switches. Persisted settings must never be used as an authentication fallback.

## Implemented endpoint subset

Successful responses match the existing contract directly, with **no extra `data` wrapper**.

| Method and path | Successful response | Notes |
|---|---|---|
| `GET /health` | Service metadata | Does not require demo mode or an identity. |
| `GET /api/demo/session` | `Session` | Explicit demo mode and identity required. |
| `PUT /api/demo/settings` | `{ settings }` | Validates the complete update atomically. |
| `POST /api/demo/reset` | `{ settings }` | Restores the complete shared seed. |
| `GET /api/projects` | `{ projects }` | Company-scoped projects with clients, milestones, and invoices. |
| `GET /api/invoices` | `{ invoices }` | Optional `status` query uses the shared `InvoiceStatus` union. |
| `GET /api/invoices/{id}` | `{ invoice, logs }` | Company-scoped invoice and its audit trail. |
| `POST /api/invoices/{id}/approve` | `{ invoice }` | Owner only; requires the appropriate invoice state. |
| `POST /api/invoices/{id}/reject` | `{ invoice }` | Owner only; JSON body `{ "reason": "..." }`. |
| `GET /api/activity` | `{ logs }` | Company-scoped; `limit` is 1–200, default 50. |

Approval and rejection are server-side state transitions. The role check happens before an idempotent success is considered, so a project manager or finance user cannot bypass the owner-only rule by repeating an already successful request. Rejection requires a reason that is 1–500 characters after trimming. Approved and rejected decisions cannot be changed into each other by these endpoints. Repeating an approval, or repeating a rejection with the same trimmed reason, is idempotent and must not create duplicate state transitions.

Issue #3 will create pending invoice drafts through milestone completion. The original seed contains only the already-issued Rantau invoice `inv_bd_1`; it does not contain a pending draft for a fresh manual approval demonstration. Do not invent extra seed records to imply that the invoicing feature is complete.

```sh
curl -H 'X-Demo-User: u_rantau_fin' \
  http://127.0.0.1:3000/api/invoices/inv_bd_1

curl -H 'X-Demo-User: u_lumen_owner' \
  'http://127.0.0.1:3000/api/invoices?status=pending_approval'

curl -H 'X-Demo-User: u_lumen_owner' \
  'http://127.0.0.1:3000/api/activity?limit=20'
```

After Issue #3 creates a pending draft, replace `<pending-invoice-id>` below with that actual company-scoped ID:

```sh
curl -X POST \
  'http://127.0.0.1:3000/api/invoices/<pending-invoice-id>/approve' \
  -H 'X-Demo-User: u_lumen_owner'
```

To start another demonstration from the shared seed:

```sh
curl -X POST http://127.0.0.1:3000/api/demo/reset \
  -H 'X-Demo-User: u_lumen_pm'
```

## Errors and audit evidence

Errors use the shared shape:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "An English explanation of the failed operation.",
    "details": { "requestId": "a-generated-request-id" }
  }
}
```

The existing error mapping is retained: validation `400`, unauthenticated `401`, forbidden `403`, not found `404`, invalid state `409`, upstream failure `502`, and AI unavailable `503`. Unsupported or not-yet-implemented routes return `404`; they do not fabricate successful business results.

Authenticated API failures and write outcomes are recorded using the existing `ActivityLog` fields. The request ID is included in the English log message so an API error can be matched to an audit entry. Activity and invoice logs are sorted by timestamp descending, then ID descending for a stable tie-break. State changes and their successful audit entries are stored in one database transaction.

Requests without a valid identity are recorded separately in SQLite's `backend_request_errors` table. They do not appear in a company's public activity API, which prevents a caller from injecting unauthenticated errors into another company's activity trail. Neither the API nor logs should include secret values.

## Integrated business modules and remaining scope

Milestone completion, draft creation, approved simulated issuance, payment recording, collections, guarded DeepSeek draft generation/editing, simulated sending, overview and 30-day forecast are mounted in the same server. The process permits 12 actual AI calls per minute and 2 concurrently; reset is blocked during generation. Load the existing key using `node --env-file=.env src/server.mjs` with `DEMO_MODE=true`.

The shared `failNext.accounting` and `failNext.outbox` controls now drive the mounted mock adapters. Real authentication, live Orbyte integration, real financial transactions/email delivery, the final frontend, hosted deployment and Replit usage evidence remain outside this local backend verification.

## Verification

```sh
npm test
```

The tests cover the existing shared contracts and the backend foundation. Review their actual output before claiming a test result. For team acceptance, also verify persistence after restart, missing identity, cross-company access, owner-only decisions, rejected-state handling, failure logs, and exact seed reset. Another team member must review the evidence before Issue #2 is closed.
