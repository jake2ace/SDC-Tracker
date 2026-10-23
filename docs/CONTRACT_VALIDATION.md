# STEP-1 contract validation

Date: 2026-10-23 · Contract: v1.0.0 · Status: ready for team review

## Scope

This check covers shared types, static fixtures and synthetic evaluation data. All API endpoints are planned. No application, OCR engine, external model, matcher implementation or deployment was executed.

## Reproduce

From the repository root, with Node.js 22.13 or newer:

```bash
npm ci --prefix contracts --ignore-scripts --no-audit --no-fund
npm --prefix contracts run check
```

The recorded run used Node.js 25.8.1, npm 11.11.0, TypeScript 5.9.3 and Ajv 8.20.0. Dependencies were installed from the local npm cache with `--offline`. The minimum Node.js version has not yet been exercised in deployment.

## Results

- Strict TypeScript check passed.
- All 13 contract/data validation groups passed: version and policy invariants; two-company seed graph; each company's CSV; API examples; model schemas; separate input/gold coverage for four datasets; receipt/reply boundaries; matcher label constraints; and forecast arithmetic.
- Fixtures contain 31 workspace states and 38 scenarios. All 16 JSON endpoints have examples; the seventeenth endpoint returns receipt-image bytes and awaits image assets.
- Static review checked company isolation, invoice balances, payment allocations and audit-event continuity. Future bank dates are blocked in both CSV policy and matching policy. Switching company replaces the whole workspace.
- Four forecast scenarios each contain 10 independently calculated daily rows. Partial payment is counted once and the remaining promise stays expected cash.

## Data readiness and limits

| Dataset | Prepared | Still required |
| --- | --- | --- |
| Seed | Two companies, role users, invoices and synthetic bank CSVs | Database loader and running tenant checks |
| Receipts | 40 generation plans and separate labels, four layouts | All 40 image assets; OCR execution and measured accuracy |
| Replies | 40 synthetic English/Chinese/Malay texts and separate labels | Real extraction evaluation; six confidence probes are injected cases, not model outputs |
| Matcher | 30 independent inputs and gold labels, including future bank posting | Actual matcher implementation and execution against gold |
| Forecast | Four input scenarios and 40 daily gold rows | Actual forecast service and comparison against gold |

No extraction accuracy, matcher pass rate, time saved or deployed availability is claimed. Team review of scope and examples remains pending in [#17](https://github.com/jake2ace/SDC-Tracker/issues/17); frontend and backend implementation follow that review.
