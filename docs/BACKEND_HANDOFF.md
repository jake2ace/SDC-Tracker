# Backend and frontend handoff

## Product outcome

Help a small business see **what it should collect, whom it should remind, and whether late receipts create a cash gap in the next 30 days**.

The integrated backend connects Issue #2 persistence, identity, decisions and audit logs to Issues #3–#5. The complete workflow is:

**Complete a milestone → review its invoice draft → owner approves → finance issues it → review an overdue reminder → finance confirms simulated sending → record payment → refresh the forecast.**

Claude owns the frontend implementation and visual design. `examples/forecast-ui` is an optional read-only calculation reference, not the final frontend or the integrated API. Keep the [shared domain](../contracts/domain.ts), [API contract](../contracts/api.ts), [seed](../data/demo.json) and [expected results](../data/expected-results.json) as the data source of truth.

## Start and connect

Use Node.js **22.13+**. The backend uses built-in HTTP and SQLite modules, with no runtime packages to install. Use the existing uncommitted `.env`; only create it from `.env.example` if it is missing. Never overwrite an existing key or copy it into a browser environment variable.

```sh
DEMO_MODE=true CORS_ORIGINS=http://localhost:5173 node --env-file=.env src/server.mjs
```

- API base URL: `http://127.0.0.1:3000`; `GET /health` checks availability. `/` returns JSON `404` because the backend serves no frontend.
- `CORS_ORIGINS` accepts exact, comma-separated origins. `http://localhost:5173` and `http://127.0.0.1:5173` are different; list both only if both are used. CORS does not authenticate users.
- Local `127.0.0.1`, `localhost` and `[::1]` hosts with the bound port are allowed. For deployment, add the exact request host (including a non-default port if present) to `ALLOWED_HOSTS`; other hosts are rejected to guard against DNS rebinding. This is separate from the frontend origin allowlist.
- Send `X-Demo-User` on **every** `/api/*` request. Add `Content-Type: application/json` for JSON bodies.
- SQLite defaults to `.local/sdc-tracker.sqlite`; refreshes and restarts preserve state. `DB_PATH`, `HOST` and `PORT` can override the defaults.
- Demo mode is explicit. These selectable synthetic identities are **not production authentication**; keep this service a controlled demo until real authentication and deployment controls exist.

```sh
curl -H 'X-Demo-User: u_lumen_pm' \
  http://127.0.0.1:3000/api/demo/session
```

Read the returned `Session` directly: `settings`, `user`, `company`, `users`, `companies`. There is no `data` wrapper.

## Roles and company boundaries

| Company | Project manager | Owner | Finance |
|---|---|---|---|
| Studio Lumen | `u_lumen_pm` | `u_lumen_owner` | `u_lumen_fin` |
| Rantau Events | `u_rantau_pm` | `u_rantau_owner` | `u_rantau_fin` |

| Action | Permitted roles |
|---|---|
| Read projects, invoices, overview, forecast and activity | Project manager, owner, finance |
| Complete a milestone | Project manager |
| Approve or reject an invoice | Owner |
| Read the collections list | Owner, finance |
| Issue an invoice; generate, edit or send a reminder; record payment | Finance |

The backend derives business scope from the header-selected user. A query or body cannot select another company's business data. Foreign invoices are treated as not found. The server checks roles even on repeated requests; disabling buttons is only UI feedback.

To change company, select a matching user, then send both `companyId` and `userId` to `PUT /api/demo/settings`. Update `X-Demo-User` on subsequent requests and discard the previous company's cached data. Persisted settings are never an authentication fallback. The demo clock and failure switches are global, so simultaneous demo operators share them.

## Integrated endpoints

Successful results match `contracts/api.ts` directly. Empty-body operations need no extra fields.

| Method and path | Body or query | Result |
|---|---|---|
| `GET /api/demo/session` | None | `Session` |
| `PUT /api/demo/settings` | `Partial<DemoSettings>` | `{ settings }` |
| `POST /api/demo/reset` | Empty | `{ settings }` |
| `GET /api/projects` | None | `{ projects }`, with clients, milestones and invoices |
| `POST /api/milestones/{id}/complete` | Empty | `{ milestone, invoice, created }` |
| `GET /api/invoices` | Optional `status` | `{ invoices }` |
| `GET /api/invoices/{id}` | None | `{ invoice, logs }` |
| `POST /api/invoices/{id}/approve` | Empty | `{ invoice }` |
| `POST /api/invoices/{id}/reject` | `{ reason }`, 1–500 trimmed characters | `{ invoice }` |
| `POST /api/invoices/{id}/issue` | Empty | `{ invoice, receipt }` |
| `GET /api/collections` | Optional `filter=overdue\|unpaid\|paid` | `{ items }` |
| `POST /api/invoices/{id}/reminders` | Optional `{ regenerate: true }` | `{ reminder }` |
| `PATCH /api/reminders/{id}` | `{ subject, body }` | `{ reminder }` |
| `POST /api/reminders/{id}/send` | Empty | `{ reminder, outbox }` |
| `POST /api/invoices/{id}/payments` | `{ receivedAt: "YYYY-MM-DD" }` | `{ invoice, payment, cancelledReminders }` |
| `GET /api/overview` | None | `Overview` |
| `GET /api/forecast` | See below | `ForecastResult` |
| `GET /api/activity` | Optional `limit`, 1–200; default 50 | `{ logs }` |

Forecast parameters: `mode=fixed|rolling`, `scenario=on_time|late`. A late scenario requires `delayDays=7|14|beyond_window`; omit it for `on_time`. Unknown or duplicate parameters are rejected. Amounts are integer **sen**, not ringgit; divide only for display. Dates use the shared demo clock. The forecast has 30 daily closing balances, receipt/expense sources and safety-gap metrics. Actual receipts are never shifted by a late scenario or counted again as expected income.

## Frontend behavior

1. Load session, projects, invoices, overview and forecast from the integrated API. Load collections only for owner or finance.
2. Use returned IDs. A fresh seed has no pending invoice draft; completing Lumen's `ms_kt_2` creates one. Repeat completion must reuse it.
3. Separate owner approval, finance issue, reminder generation and reminder sending into explicit actions. **Generating, editing or viewing a reminder must never auto-send it.** Show its text and require a deliberate finance confirmation before calling `/send`.
4. After each successful write, reload the affected invoice, collections, overview, forecast and activity. After payment, cancelled reminders must stop offering a send action. Display returned state rather than predicting success locally.
5. On company switch or reset, cancel stale requests and clear cached records before reloading. Do not let a slow response restore the previous company's data. Reset replaces the whole demo dataset; label it clearly.
6. Render business text as plain text, never raw HTML. Keep loading, empty, failure and retry states visible. Mark accounting and outbox receipts as **simulated**.

Errors use `{ error: { code, message, details } }`. Retain `details.requestId` and the `X-Request-Id` header for debugging. Statuses are validation `400`, missing identity `401`, forbidden `403`, not found `404`, invalid state `409`, upstream failure `502`, and AI unavailable `503`. Module messages may be Chinese; the English frontend can map `error.code` to suitable UI copy while retaining the diagnostic message. A `503` must not be presented as a successfully generated AI draft.

## AI and safety boundary

The running backend uses the guarded DeepSeek adapter for new reminder drafts. It reads `DEEPSEEK_API_KEY` only on the server. A missing key or provider failure returns `AI_UNAVAILABLE`; there is no silent replacement pretending to be AI.

The model chooses three IDs from approved phrase catalogs. Business facts and customer information are assembled locally, not included in model requests. The model has no file, database, shell or sending tools. Unrecognized output is rejected; manual text edits are validated and are not fed back into the model. Finance must confirm a draft to simulate sending. Recording full payment cancels remaining draft reminders.

The backend permits up to 12 actual AI calls per minute across the process and at most 2 at once. Reusing a cached draft does not consume that quota. A quota rejection returns `503 AI_UNAVAILABLE`; demo reset does not clear the quota. Reset during an in-flight generation returns `409` instead of allowing a stale result into a new dataset. Show these failures and let the user retry deliberately.

Forecasts are deterministic scenarios computed from the same stored records, not model predictions or bank balances. Inputs, company relationships, dates and integer amounts are validated before calculation. Do not add a general chat prompt or browser-supplied customer/company payload to these endpoints.

## Multi-case acceptance

Run `npm test` for automated checks. Tests use an AI substitute; they do not prove provider availability. A live-key check is a separate API operation, and it must still return a draft without sending it.

| Case | What the integrated demonstration must prove |
|---|---|
| Lumen full workflow | Complete `ms_kt_2`, approve as owner, issue as finance, advance `demoDate` past the returned due date, generate/edit/confirm a reminder, then record payment. All screens read the resulting shared state. |
| Rantau existing overdue debt | `inv_bd_1` is already overdue in the seed. Use the Rantau finance identity; its reminders and receipts remain separate from Lumen. |
| Late cash | Compare on-time, 7-day, 14-day and beyond-window scenarios; show changed risk dates and source dates. Use the [forecast case table](FORECAST.md#多案例演示与验收) for exact fixture values. |
| Receipt and rolling window | Record payment, then move the demo date forward. The receipt becomes actual cash; expected income is removed and prior receipts appear in the rolling opening balance once. |
| Failure and retry | Set the relevant `failNext` switch, attempt the action, show the error, then retry successfully without duplicate invoices or sends. |
| Permission and isolation | Missing identity is `401`; a project manager cannot approve or send; one company cannot read/change the other's invoice. |
| Persistence | Restart the backend, then reload: invoice, payment, reminder and activity state remain. Reset deliberately returns to the shared seed. |

The original 8-case forecast page and its 40-combination checks remain useful arithmetic evidence. They use prepared read-only snapshots; they do not replace a demonstration that changes business state through this integrated API.

Remaining delivery work: connect and verify Claude's frontend, record the multi-case workflow, and validate the deployed demo. Real login, real accounting/email delivery and real bank reconciliation are outside this demo implementation.
