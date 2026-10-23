# Hosted verification — 24 October 2026

## Environment

- Replit project: https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash
- Node.js: 24.22.1 in the Replit workspace.
- Runtime: one Node server serving the built frontend and API, SQLite, server-side DeepSeek credentials.
- Release basis: `c5106f0`, with Node 24 configuration, an explicit promise-amount extraction instruction and a default reminder model of `deepseek-flash`.
- All records and uploaded files used below are synthetic. Sending reminders is simulated.

## Workspace checks

`tests/integration/hosted-smoke.mjs` ran against an isolated production-mode process on port 3001 with a fresh SQLite database. It is an explicitly invoked integration test, separate from application code; it changes the target demo ledger.

| Check | Observed result |
| --- | --- |
| Health, initial ledger and frontend asset | Passed; RM18,000 due, RM0 paid |
| Reminder | Real AI draft; simulated send; no external message |
| First screenshot | Local OCR + real AI; no manual correction; partial bank match |
| First human-approved receipt | RM9,000 paid, RM9,000 due |
| Future-payment reply | Real AI; RM9,000, 28 October 2026 |
| Forecast | Expected receipt on 28 October, or 4 November with seven days' delay; actual payment stays on 23 October |
| Final bank CSV | One inserted credit; import alone creates no payment |
| Final screenshot and approval | Real AI; no manual correction; RM18,000 paid, RM0 due |
| Settlement and duplicate import | Exactly two payments; collections stopped; duplicate CSV inserts zero credits |
| Company isolation | Other company's workspace and forecast exclude Lumen; receipt image returns 404 |
| Reload | Settlement remains visible |

The final run passed with four real AI outputs and zero manual corrections. Earlier attempts are not counted as passes: one reply omitted an explicit future amount, which led to the prompt clarification; an isolated process without `DEEPSEEK_MODEL` used a template reminder, which led to a consistent application default. Both corrections retain server validation and human approval.

Local TypeScript checking and all 50 backend tests passed after the corrections. Previously recorded frontend/browser and missing-key checks are documented separately in [DEPLOYMENT.md](../DEPLOYMENT.md); they are not represented as public-host checks.

## Storage and spending boundaries

SQLite stores ledger entities, receipt image bytes, evidence, audit history and idempotency records on the server. Browser refresh does not reset this database. The workspace's initial test ledger was backed up with SQLite `VACUUM INTO` outside the project and reset to the synthetic seed before publishing.

Replit's published filesystem is not verified durable storage across redeployments or instance replacement. This is a resettable shared demo, not a production financial archive. A managed-database adapter or a durable mounted filesystem is still required for that claim.

The selected Reserved VM is shared 0.5 vCPU / 2 GiB in Asia, displayed at US$15/month (US$0.0208/hour). The account showed US$20 remaining before publishing. Auto-reload was disabled and the Billing page visibly showed **Auto-reload: Off**. No top-up or subscription upgrade was purchased. Disabling auto-reload is not evidence of a hard spending cap: the usage screen says a negative balance may represent usage beyond credits.

## Public release

Live URL: https://milestone-2-cash-proof-to-cash.replit.app/

The public `/health`, workspace API, frontend HTML and JavaScript asset responded successfully without a Replit login. The complete integration script passed against this public URL: four real AI outputs, zero manual corrections, two approved payments totalling RM18,000, no outstanding balance, duplicate protection and company isolation.

The first public run stopped at reminder generation because the model output failed the token/safety check (`unsafe_model_output`). The application returned a visible template draft and did not send a message. A second run passed; this is recorded as a successful retry, not as a zero-failure AI claim. No validation rule was relaxed.

Before the pause/resume storage check, the settled workspace SHA-256 was `6e2e1708421711b83cdc547aea5e7c4168977a06d268ed1725ad23dee0b073b7`, with two payment records. The uploaded partial and final image hashes were `98e0a0e218e4a8abcb99692342305abdf221c3ed12a1eb13224cc9b4b54142ef` and `65e7b1975c7ab94cf4a0520a5d03e0435ea82df06d5afba16de083454c4d5b90` respectively. The hosting UI then showed Paused and `/health` stopped serving the application.

Resume did not complete successfully: Replit reported that the deployment failed to initialize, and its runtime Logs tab returned no logs. The public URL returned the platform's 404 page. There is insufficient evidence to attribute that failure to application code or the platform. Hosted restart persistence therefore did **not** pass and is not claimed. The same tested source was republished to recover the friend-testing environment; the recovery result is recorded separately.

Recovery succeeded. The publishing UI returned to **Live** and the public health/workspace endpoints returned HTTP 200. The ledger had reverted to its seed: RM0 paid, RM18,000 outstanding, zero payments, zero uploaded receipts and zero reminders. An image URL from the earlier run returned the application's `NOT_FOUND` response. Thus the republish actually reset runtime data; it is not merely an untested possibility.

A fresh Chrome incognito window opened the public landing page without a Replit login, entered the demo through **Sign in**, and displayed the initial invoice totals and **No payment recorded yet**. The recovered instance is ready for the sequential friend test guide. It was not run through another settlement cycle after this reset, so friends start with the required unpaid ledger.
