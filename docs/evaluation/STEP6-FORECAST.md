# STEP-6 forecast evaluation

`calculateForecast` produces two deterministic 30-day scenarios from the current company ledger: on time and delayed expected receipts. It is a cash scenario calculator, not a probability model.

## Accounting rules

- Opening cash already includes earlier confirmed payments. Only payments effective on the current MYT date are added as actual receipts, once per scenario.
- Issued and partially paid invoices contribute their current outstanding amount. A valid active confirmed promise supplies the expected date; otherwise the invoice due date applies.
- Overdue expected dates move to today before the selected delay is applied. Actual payments and expense dates do not move.
- Receipts beyond day 30 are listed in `deferredInvoiceIds`. Old expenses are not charged a second time.
- Every entry has a stable scenario/source ID, and each day lists the IDs used in its balance. A safety alert requires a balance strictly below the threshold.
- Invalid dates, future actual payments, inconsistent balances, duplicate payment allocations and unsafe integer calculations return a validation error. Records from another company are excluded before calculation or validation.

## Reproduce

```sh
node --experimental-strip-types scripts/evaluate-forecast.ts
node --experimental-strip-types --test tests/integration/forecast.test.ts
```

The [saved result](forecast-results.json) records the actual runtime, evaluation time and SHA-256 hashes of the implementation and unchanged input/gold files. All four frozen cases match their ten hand-calculated daily balances and expected receipt schedule exactly: 40 checked days in total. Both scenarios emit all 30 days, including receipts after the ten-day gold window.

Separate integration-test cases cover partial/full receipts, historic payments, expense timing, zero/thirty-day delays, deferred invoices, promise fallback, MYT/year/leap-day boundaries, tenant isolation and invalid/overflowing input. No real money was moved and these synthetic results do not establish production forecasting accuracy.
