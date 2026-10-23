# Payment approval and cash-flow forecast

STEP-6 connects reviewed evidence to the synthetic ledger. All seventeen contract operations are now implemented; frontend integration and deployment remain separate work. No route moves real money or connects to a bank.

## Approve a payment

Finance first uploads/reviews a receipt and calls `POST /api/receipts/:id/match`. A match remains `pending` until Finance explicitly approves it. Only `confirmed` and `partial` proposals are eligible.

```bash
curl -X POST http://127.0.0.1:3000/api/matches/MATCH_ID/approve-payment \
  -H 'X-Demo-User: u_lumen_finance' \
  -H 'Idempotency-Key: payment:approve:001' \
  -H 'Content-Type: application/json' \
  -d '{"expectedVersion":1}'
```

Use the current ID/version returned by the API. Amount, invoice and bank credit cannot be supplied by the client. The server checks the captured invoice, receipt, company ledger and credit versions, reruns matching against current evidence, and rejects a stale or conflicting proposal.

Payment creation, credit allocation, invoice balance/status, match status, company version and audit are committed together with the idempotency response. A failed transaction leaves no partial allocation. SQLite additionally prevents multiple payments for one credit, receipt or match. Successful retries with the same key replay the original result.

| Approved amount | Invoice and collections |
| --- | --- |
| Less than the current outstanding balance | `partially_paid`; only the approved amount is deducted and collections remain `active`. |
| Equal to the current outstanding balance | `paid`; outstanding becomes zero and collections become `stopped`. Active promises are fulfilled. |
| More than the outstanding balance | Review required; no splitting or automatic overpayment allocation. |

Existing reminder drafts are not silently rewritten or sent. A payment changes the invoice version, so an older draft must be regenerated and reviewed. New reminders use the remaining balance; paid invoices cannot be reminded. Closing a match review without approval leaves it pending and does not change money.

## Confirm a payment promise

```bash
curl -X POST http://127.0.0.1:3000/api/replies/REPLY_ID/confirm-promise \
  -H 'X-Demo-User: u_lumen_finance' \
  -H 'Idempotency-Key: promise:confirm:001' \
  -H 'Content-Type: application/json' \
  -d '{"expectedVersion":1,"expectedInvoiceVersion":2,"promisedDate":"2026-10-28","amountSen":900000}'
```

The reply must have a ready, validated `promise` extraction or a completed manual correction. The date and amount must agree with reviewed evidence, and the amount must equal the entire current outstanding balance. Resolve ambiguous dates or missing amounts through reply correction first. A partial-payment reply can retain a possible remainder date, but it is not itself a confirmed promise.

A new confirmation supersedes the previous active promise and updates the invoice/reply references and versions. It does not change the original due date, record a payment or stop overdue collections. A later partial payment leaves only the current remainder in the forecast.

## Read the 30-day forecast

```bash
curl 'http://127.0.0.1:3000/api/forecast?asOfDate=2026-10-23&delayDays=7' \
  -H 'X-Demo-User: u_lumen_finance'
```

All demo roles can read their company's forecast. Both query parameters are required exactly once; unknown parameters are rejected. `asOfDate` must equal the fixed demo clock's MYT date, and `delayDays` must be an integer from 0 to 30. The current seed uses **23 October 2026**, regardless of the computer's current date.

The response contains `on_time` and `delayed` scenarios, each with thirty daily rows and traceable entries:

- Opening balance already includes historical confirmed payments. Only payments confirmed by the demo clock with today's effective date become today's actual receipts.
- Expected receipts use only current invoice outstanding amounts. Use the confirmed active promise date when available, otherwise the original due date; clamp overdue expected receipts to today before adding scenario delay.
- Actual receipts and expenses do not move with the delay. Expenses before today are already reflected in opening balance. Expected receipts beyond day 30 are listed in `deferredInvoiceIds` rather than counted in the window.
- Each day closes at opening + actual + expected − expenses. The next day's opening is that closing; a balance strictly below the safety threshold is flagged.

For a RM18,000 invoice with RM9,000 approved today, actual receipts contain RM9,000 and expected receipts contain only the remaining RM9,000. A second full-settlement payment removes the expected remainder. Neither an unapproved match nor an unconfirmed customer claim is actual cash.

## Verification

Business logic is separate from tests under `tests/integration/`. Run `npm run check`, `npm test`, `npm run evaluate:forecast` and `npm --prefix contracts run check`. The forecast evaluator compares the frozen independent hand calculations without changing their inputs or labels; results are saved in [the forecast report](evaluation/forecast-results.json).

The tests exercise partial/full settlement, stale evidence, roles and company boundaries, duplicate/concurrent requests, rollback, restart, promises and forecast traceability. These checks describe a synthetic local prototype; they do not establish production authentication, real-bank settlement, frontend completion or deployment readiness.
