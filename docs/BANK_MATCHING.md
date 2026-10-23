# Bank CSV import and matching

STEP-4 implements `POST /api/bank-statements` and `POST /api/receipts/:id/match`. Both require the Finance demo role, `X-Demo-User` and an `Idempotency-Key`. They use the existing success/error envelopes and SQLite transactions. Neither operation posts payments or changes invoice balances.

## Import a synthetic CSV

Start the backend using [BACKEND.md](BACKEND.md), then read `GET /api/workspace` for the current `company.version`.

```bash
curl -X POST http://127.0.0.1:3000/api/bank-statements \
  -H 'X-Demo-User: u_lumen_finance' \
  -H 'Idempotency-Key: bank-import-demo-001' \
  -F 'expectedVersion=1' \
  -F 'file=@data/seed/bank-lumen.csv;type=text/csv'
```

The seed CSV is already represented in a fresh database, so this example reports a duplicate and preserves the company version. New, valid rows increment the version once for the batch. Refresh workspace after success. Browser clients should let `FormData` set the multipart boundary; do not manually set its Content-Type header.

The exact header is `externalId,postedDate,amountSen,reference,payer,bank`. Files must be valid UTF-8 (optional BOM), at most 1 MiB and 1000 data records. RFC 4180 quoted fields, escaped quotes, CRLF and LF are supported. Currency is fixed to MYR; amounts are positive safe integer sen. Dates use MYT and cannot be later than the fixed demo clock's date.

Any invalid row or conflicting external ID rejects the whole file. Error details include record numbers (header is 1), field codes and reasons. Same company/external ID with identical normalized content is skipped; changed content returns `409 BANK_IMPORT_CONFLICT`. A different external ID with the same bank/date/amount/reference/payer fingerprint is also skipped, and the alternate ID is remembered across restarts. Other companies have separate identifiers and fingerprints.

Same-key retries replay the original response even after restart. Multipart boundaries and filenames do not change the request fingerprint; text fields, file MIME and file bytes do. Reusing a key with different content is rejected. Repeating with a new key requires the current company version.

Each successful import records a batch ID, actor, request ID, timestamp, source SHA-256, sanitized filename, MIME, original external IDs and per-record imported/skipped results. Provenance is stored in tenant-scoped SQLite records; no new public provenance endpoint is introduced. Existing databases gain the new table and indexes without resetting their data.

## Create a matching proposal

```http
POST /api/receipts/{receiptId}/match
X-Demo-User: u_lumen_finance
Idempotency-Key: receipt-match-001
Content-Type: application/json

{"expectedVersion":1,"expectedInvoiceVersion":1}
```

The server loads that company's receipt, invoice, customer aliases and bank records. It returns a persisted `MatchResult` with verdict, reasons, candidate IDs, eligible credit (if any), proposed amount/remainder and the versions of its evidence. It records a `pending` proposal and audit event only. There is no payment approval endpoint in this step.

The pure matcher uses exact normalized references and independently maintained payer aliases. It requires valid evidence, zero amount tolerance, an inclusive transfer-day to +2-day bank window, and no future transfer/posting date. Duplicate evidence, reused references, allocated credits and multiple candidates cannot be silently selected. Low-confidence or incomplete evidence remains reviewable. Only `confirmed` and `partial` can expose an eligible credit; that still is not approval or a claim of real bank receipt.

Receipt upload/OCR and manual correction are now implemented in [STEP-5](EXTRACTION.md). The fresh seed contains no receipt records; upload a synthetic image from `data/eval/images/` first. The isolated matching tests also retain prepared receipt entities for deterministic rule checks. Payment approval remains planned and must still be explicitly mocked in the frontend.

## Verification

```bash
npm run check
npm test
npm run evaluate:matcher
npm --prefix contracts run check
```

Verified on Node.js 25.8.1: all 18 grouped backend tests passed (8 foundation, 7 CSV/matching HTTP, 3 pure matcher). All 30 frozen synthetic matcher cases passed their separate gold verdicts, required reasons, candidate eligibility and amounts; no unsafe approval candidates appeared in these cases. Inputs remain unchanged and repeated calls produce the same decisions. [Saved results](evaluation/matcher-results.json) contain input/gold hashes and per-case outcomes.

These results measure the synthetic deterministic matcher only. They do not establish OCR accuracy, real-model reliability, production accuracy, real bank access or payment posting. STEP-7 will combine the later modules and measured results.
