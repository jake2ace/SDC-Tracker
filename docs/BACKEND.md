# Backend foundation

The STEP-2 backend implements seven contract endpoints: demo users, workspace, milestone completion, invoice drafting, invoice approval/rejection, reminder drafting and confirmed simulated sending. It also exposes `GET /health`. Frontend pages, reply extraction, receipts, bank import, reconciliation and forecast execution are later steps.

## Run locally

Requires Node.js 22.13+ and npm. From the repository root:

```bash
npm ci
cp .env.example .env
npm run db:init
npm start
```

Open `http://127.0.0.1:3000/health` for JSON health status. This is an API service, not a website. `npm run dev` restarts on file changes. The service uses the fixed contract clock `2026-10-23T04:00:00Z` to make overdue and due-date behavior reproducible.

`DB_PATH` defaults to `.local/proof-to-cash.db`. Startup and `db:init` seed only an empty database; they preserve existing edits. To deliberately discard this local demo's changes and restore synthetic data, stop the server and run `npm run db:reset`.

`HOST` defaults to loopback. Deployment can set `HOST=0.0.0.0` and its assigned `PORT`. `FRONTEND_ORIGIN` optionally allows one exact frontend development origin; unset means no cross-origin access. This is a synthetic demo with selectable identities, not production authentication.

## Try the API

```bash
curl http://127.0.0.1:3000/api/demo-users
curl -H 'X-Demo-User: u_lumen_finance' http://127.0.0.1:3000/api/workspace
curl -X POST http://127.0.0.1:3000/api/invoices/inv_lumen_001/reminders \
  -H 'Content-Type: application/json' \
  -H 'X-Demo-User: u_lumen_finance' \
  -H 'Idempotency-Key: demo-reminder-001' \
  -d '{"expectedVersion":1,"language":"en"}'
```

The returned reminder is only a draft. Review its text, then use its ID/version and the current invoice version with `POST /api/reminders/:id/send`. This writes a simulated-send result and audit event; it never contacts the customer. Changing request content requires a new idempotency key.

PM completes milestones and creates invoice drafts. Owner approves or rejects drafts. Finance prepares and confirms overdue reminders. Roles do not inherit each other's write permissions. An issued invoice must be overdue and have an outstanding balance before reminders can be drafted or sent. If its version or balance changes after drafting, generate a fresh reminder.

## Persistence and failures

SQLite stores tenant-scoped entities, audit events, internal reminder snapshots and successful idempotency responses. The API appends audit events and provides no edit or delete operation. Each business mutation and its success audit/idempotency response commits in one transaction. Duplicate invoice creation is also constrained in SQL. Rejected authenticated write attempts produce a separate audit entry without changing the business entities. Other companies' resources return a generic 404.

Same-key retries return the original result, including after restart. Changed content under that key returns 409. Concurrent in-flight requests receive a retryable 409. External text generation occurs outside the transaction; versions are checked again before saving its result.

## Reminder generation

Without a model key, reminders use editable English, Chinese or Malay templates with `generationMode=fallback_template`. Optional server-only settings are `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` and `DEEPSEEK_TIMEOUT_MS`. The model receives only fixed task text, language, outstanding amount and timezone; customer records, invoice identity and bank evidence are not sent. Failed or invalid model output falls back to a template. Model output never approves or sends a reminder.

Real external-model calls and deployment are not claimed by STEP-2's local tests.

## Validation

```bash
npm run check
npm test
npm ci --prefix contracts
npm --prefix contracts run check
```

The backend tests exercise actual local HTTP requests and SQLite files, including restart behavior. The separate contract command checks types and static data; it does not execute the future matcher or OCR workflow.

Verified on 2026-10-23 with Node.js 25.8.1 and npm 11.11.0: strict type checking, all 8 grouped backend tests, and all 13 contract/data groups passed. The backend tests cover role/tenant rejection, strict requests, a connected invoice-to-reminder workflow, stale versions, duplicate/replayed writes, collection eligibility, fallback generation, restart persistence and transaction rollback. Injected provider responses test both success and fallback without calling a real model.

The documented `db:init` and `start` commands were also exercised with an isolated local database on port 3187; `/health` returned HTTP 200 with `status=ok`, `database=ready` and `mode=demo`. The temporary listener was stopped after verification. Node.js 22.13 remains the supported minimum; this run used the installed Node.js 25 runtime.
