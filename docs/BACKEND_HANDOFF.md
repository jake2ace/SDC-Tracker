# Backend handoff

This is a local Issue #2 backend handoff for the frontend teammate and the owners of Issues #3–#5. It does not replace the existing [domain types](../contracts/domain.ts), [API types](../contracts/api.ts), [seed](../data/demo.json), or [acceptance examples](../data/expected-results.json).

## Ownership and scope

The frontend remains the frontend teammate's responsibility. This backend provides persistence, request identity, company isolation, invoice decision guards, and audit storage. It does not include HTML pages or a frontend build. `/` returns a JSON `404`.

The local backend work must be reviewed before publication. Do not push, create a pull request, merge, or close Issue #2 without the repository owner's instruction and the required teammate review.

## Connect the frontend

1. Start the backend with explicit demo mode. If the frontend is on another origin, allow that exact origin:

   ```sh
   DEMO_MODE=true CORS_ORIGINS=http://localhost:5173 npm start
   ```

2. Point the frontend API base URL at `http://127.0.0.1:3000`. Configure the frontend's own development environment; the backend does not serve it.
3. Send `X-Demo-User` on **every** `/api/*` request, including the first session request. Start with an actual seed ID such as `u_lumen_pm`.
4. Read `GET /api/demo/session` as a full `Session`, with no `data` wrapper. Use its `user`, `company`, `users`, and `companies` for the synthetic role/company selector.
5. When switching company, send `companyId` and a matching `userId` together to `PUT /api/demo/settings`. Then change the header on subsequent requests. A settings update alone never changes the caller's permissions.
6. On `POST /api/demo/reset`, discard cached business objects and reload the session, projects, invoices, and activity. The reset restores the exact shared seed.

Example API request for checking the connection:

```sh
curl -H 'X-Demo-User: u_lumen_pm' \
  http://127.0.0.1:3000/api/projects
```

Successful project reads return `{ "projects": [...] }`. For non-success responses, display `error.message` and retain `error.details.requestId` for support. For JSON writes, add `Content-Type: application/json`. Do not send an arbitrary `companyId` to select business data; the backend derives it from the header-selected user. For the same reason, never substitute global saved settings for the request header.

## Available now

- Health metadata and explicit demo session/configuration/reset controls.
- Projects with their related client, milestones, and invoices.
- Invoice list/status filtering, invoice detail, and its activity logs.
- Owner-only invoice approval and rejection with validated state transitions.
- Company-scoped activity queries, persistent state, and correlated error logs.

See [the endpoint list and examples](BACKEND.md#implemented-endpoint-subset) for exact paths and response shapes. All business UI messages added by the integration should be in English.

The two synthetic companies are `co_lumen` and `co_rantau`. Their roles are `pm`, `owner`, and `finance`. Existing IDs and amounts must come from `data/demo.json`; use the shared contracts rather than duplicating them in a new type definition.

## Approval integration

Only an `owner` may approve or reject an invoice. Disabling a frontend button is useful feedback, but the server enforces the permission and state checks. A rejected or unapproved invoice must not reach a later issue/send action.

- Approval: `POST /api/invoices/{id}/approve`, with no JSON body required by the contract.
- Rejection: `POST /api/invoices/{id}/reject`, with `{ "reason": "A specific explanation" }`.
- A reason is trimmed and must contain 1–500 characters.
- Repeating an existing decision is idempotent, but role checks still apply.
- An invoice from another company returns `404` rather than exposing its contents.

The fresh seed has no pending draft. A blank pending-approval list is therefore expected until Issue #3 creates a draft. Use backend tests to check the foundation's transitions while that creation route is still being implemented.

## Extend the backend for Issues #3–#5

The shared API describes the whole product, not the currently implemented subset. Routes for milestone completion, invoice issue/payment, collections/reminders, overview, and forecast currently return `404`.

Use the exported guards in `src/guards.mjs` when implementing later business operations:

- `findInvoice`: find an invoice within the actor's company.
- `requireRole`: enforce the permitted role before processing or returning an idempotent success.
- `requireApprovedInvoice`: block downstream actions unless the invoice has the required approval state.

Read each function's actual signature in the implementation before calling it. Keep company derivation and the existing response/error contract consistent.

Use the store transaction helper to commit a business result and its audit record together. A successful invoice update without its activity evidence is not a complete write. Reuse `ActivityLog` as defined; keep the request ID in the message rather than adding fields to the shared contract.

For Issue #3, preserve milestone-to-draft idempotency, owner approval, correct integer-sen amounts, accounting-failure recovery, and payment/reminder consequences from the shared agreement. A mock accounting call must visibly report simulation.

For Issue #4, preserve editable reminders, explicit human confirmation, failure handling, and cancellation after payment. Persisted `failNext.outbox` is a test control, not evidence that sending is already implemented. Disclose the actual runtime AI approach when one is connected.

For Issue #5, calculate against the same invoice/payment/expense data and shared demo date. Match the agreed fixed/rolling windows, on-time/late scenarios, and expected numerical results. Do not invent a second fixture to make a chart look correct.

## Acceptance and remaining work

The latest main branch already includes the Issue #3 invoicing and Issue #4 collections services and route adapters. They remain unchanged by this foundation and are not mounted in `src/server.mjs` yet. Use the modules' integration documentation when connecting them; pass the trusted actor ID, preserve the adapter's status/body, and explicitly configure the collections generator.

Local automated results and scope checks are recorded in [BACKEND_VERIFICATION.md](BACKEND_VERIFICATION.md).

Run `npm test` and inspect the actual result. Then ask another team member to verify:

- State survives a frontend refresh and backend restart.
- A missing or unknown header returns `401`.
- A project manager or finance user cannot approve or reject, including an idempotent retry.
- One company's header cannot read or change another company's invoice.
- A successful decision and an API failure can be found in the correct activity trail.
- Unauthenticated errors do not leak into company activity responses.
- Invalid settings leave the complete previous configuration unchanged.
- Reset reproduces the entire seed without adding a business reset event.

Capture actual test output and demonstration evidence for Issue #2. The core product workflows, frontend, real authentication, real AI, Replit deployment, and live Orbyte integration are separate work; this handoff does not claim they are complete.
