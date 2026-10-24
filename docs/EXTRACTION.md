# Reply and receipt extraction

STEP-5 adds five API operations: save a customer reply, review reply extraction, upload a receipt, retrieve its original image and review receipt evidence. Finance users perform writes; Owner, Finance and PM users can retrieve images belonging to their company. See [the contract](../contracts/api.ts) for complete DTOs and [the frontend guide](FRONTEND_HANDOFF.md) for integration.

## Local setup

Run `npm ci` and start the API with `npm start`. Image decoding uses pinned `sharp` 0.35.5. OCR uses pinned `tesseract.js` 7.0.0 with the `eng` and `chi_sim` 1.0.0 language-data packages. Their models are installed by npm; OCR needs no runtime download, external OCR service or API key.

Each OCR call runs in a separate local process, with a 30-second timeout that also stops initialization. Temporary files contain links to installed language models only; receipt bytes remain in memory during processing. Original image bytes, OCR text, engine/version and safe failure codes are saved in the application SQLite database. English and Simplified Chinese models are loaded together; Malay text uses the Latin-character model. This does not establish accuracy for arbitrary real-world bank layouts.

For real structured extraction, set these server-only values in `.env`:

```dotenv
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_TIMEOUT_MS=10000
```

The adapter only permits HTTPS requests to `api.deepseek.com` at `/chat/completions` or `/v1/chat/completions`. Never put the key in frontend code. Missing configuration, failed requests and rejected model output retain the evidence for manual review. They are not recorded as successful model extraction.

## Create and review a reply

Use a current invoice ID and version from `GET /api/workspace`. Replace all example IDs and versions below with returned values. `receivedAt` is a valid UTC timestamp no later than the demo clock; `language` is `en`, `ms` or `zh`. Reply text is limited to 4,000 characters.

```bash
curl -X POST http://127.0.0.1:3000/api/invoices/INVOICE_ID/replies \
  -H 'X-Demo-User: u_lumen_finance' \
  -H 'Idempotency-Key: reply:create:001' \
  -H 'Content-Type: application/json' \
  -d '{"expectedVersion":1,"text":"I will pay RM 200 tomorrow.","receivedAt":"2026-10-22T04:00:00Z","language":"en"}'

curl -X PATCH http://127.0.0.1:3000/api/replies/REPLY_ID/extraction \
  -H 'X-Demo-User: u_lumen_finance' \
  -H 'Idempotency-Key: reply:review:001' \
  -H 'Content-Type: application/json' \
  -d '{"expectedVersion":1,"intent":"promise","promisedDate":"2026-10-23","amountSen":20000,"reason":"Confirmed against the customer message."}'
```

Reply creation returns `201` with `{ reply, fallbackReason }`. Review returns the updated reply. Supported intents are `paid`, `promise`, `partial`, `dispute` and `other`. A reviewed promise requires an explicit date; a partial-payment reply may also retain a date for the promised remainder. Other intents must have `promisedDate: null`. Amounts use integer MYR sen. A customer saying “paid” remains a claim; extraction never records a payment. Relative or ambiguous promise dates require review.

## Upload and review a receipt

```bash
curl -X POST http://127.0.0.1:3000/api/invoices/INVOICE_ID/receipts \
  -H 'X-Demo-User: u_lumen_finance' \
  -H 'Idempotency-Key: receipt:upload:001' \
  -F 'expectedVersion=1' \
  -F 'file=@data/eval/images/receipt_eval_001.png'

curl http://127.0.0.1:3000/api/receipts/RECEIPT_ID/image \
  -H 'X-Demo-User: u_lumen_finance' \
  --output receipt-original.png

curl -X PATCH http://127.0.0.1:3000/api/receipts/RECEIPT_ID/evidence \
  -H 'X-Demo-User: u_lumen_finance' \
  -H 'Idempotency-Key: receipt:review:001' \
  -H 'Content-Type: application/json' \
  -d '{"expectedVersion":1,"bank":"DEMO SENDER BANK A","amountSen":20000,"reference":"DEMO-REF-001","transferredAt":"2026-10-22T04:00:00Z","payer":"DEMO CUSTOMER","reason":"Checked all fields against the original image."}'
```

For attachment to a reply, supply both multipart fields `replyId` and `expectedReplyVersion`. The reply must belong to the same invoice and company. Upload returns `200` with `{ receipt, existing, fallbackReason }`. The image endpoint returns authenticated image bytes, not a public URL, with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; frontend image previews should fetch it with the demo-user header and create a local object URL.

Upload limits and behavior:

- PNG, JPEG and WebP only, at most 5 MiB and 20 megapixels. Signatures, format metadata and a complete pixel decode are checked. Filename and supplied MIME type do not determine acceptance.
- Animated images, truncated files and malformed images are rejected. The multipart envelope allows at most 64 KiB overhead beyond the image limit; unknown or duplicate multipart fields are rejected.
- SHA-256 identifies the original evidence. Reuploading the same image to the same invoice returns the existing receipt; attaching it to another invoice in the same company returns `409 DUPLICATE_EVIDENCE`.
- OCR may transform pixels temporarily for orientation/decoding, while the saved evidence and its hash remain the original bytes.
- Manual review requires all five receipt fields plus a reason, records the reviewing user and timestamp, and increments the receipt version. Existing match proposals must be regenerated after a correction.

## Grounding, review and audit

The model receives a restricted text projection. Receipt payer names and references become reversible `PAYER_1` / `REF_1` tokens; raw images are never sent. Reply text is reduced to supported financial/date language, with other spans redacted. The server validates exact output fields, finite confidence, integer amounts, dates and tokens, then checks returned amounts and dates against local evidence. Unknown identifiers and ungrounded values are rejected. The current receipt parser supports explicit labeled fields; unsupported layouts can require manual entry even when OCR succeeds.

Reply projection preserves supported Chinese negations and conditions, normalizes English negative contractions (including curly apostrophes), and marks every unsupported span as `[REDACTED]` instead of silently joining the remaining words. Negated or conditional statements, and any reply containing redacted content, require Finance review regardless of model confidence. For example, `我不承诺…` must not become `我承诺…`, and `can't` must not become `can`. The review codes are `REPLY_NEGATION_REVIEW_REQUIRED`, `REPLY_CONDITION_REVIEW_REQUIRED` and `REPLY_REDACTION_REVIEW_REQUIRED`. This conservative rule also sends harmless greetings or names outside the vocabulary to review; it does not claim to understand every language or semantic nuance.

Promise confirmation rechecks the original text of AI-sourced replies, including records saved as `ready` before this fix. Finance must use the existing audited correction flow to resolve the meaning before confirming such a promise. Already-confirmed promises are not rewritten automatically. No full unredacted message is sent to the model, and a reply or promise still creates no actual payment.

`processingStatus` communicates the next action:

| Status | Meaning |
| --- | --- |
| `ready` | Validated structured evidence or a completed manual correction; it still does not authorize payment. |
| `needs_review` | Structured output exists but needs review due to confidence, missing fields, dates, negation, conditions or removed reply text. |
| `manual_required` | OCR/provider unavailable, invalid input/output, conflicting fields, ungrounded values or embedded instructions prevented usable extraction. |

Confidence below `0.85` requires review. `fallbackReason` identifies the reason without exposing provider error bodies. SQLite stores extraction provenance, model-call/validation flags, input/output hashes, original evidence, manual changes and audit events. Model output has source `ai`; manual edits have source `manual`, a null confidence and server-generated review stamps. Provider failure has no invented extraction.

Every write requires an `Idempotency-Key` and the current entity version. Replaying a successful request returns its prior result without repeating OCR/model calls; a reused key with a different request is rejected. Company isolation also applies to images and extraction records.

Matching is available through STEP-4 after evidence is ready. Payment approval, promise confirmation and forecast calculation are implemented separately in [STEP-6](RECONCILIATION.md); none of the five STEP-5 routes changes the outstanding invoice amount, records payment or confirms a promise.

## Verification

Run `npm test` for integration and regression cases, or `npm run test:integration` for the separate STEP-5 tests only. Image tests live in `tests/integration/receipt-image.test.ts` and cover real PNG/JPEG/WebP decoding, invalid files and limits, actual local OCR and timeout handling. Synthetic receipt/reply evaluation results are separate evidence: mocked provider tests establish behavior under controlled failures, not real model accuracy. See [the evaluation guide](evaluation/STEP5.md) for reproducible commands and actual run records.

The reply-semantic regression tests use controlled provider outputs to verify projection, privacy, review routing, legacy-record rejection and audited manual recovery. Earlier real-provider evaluation scores describe the version that produced them; review rates and accuracy must be measured again before claiming those numbers for this stricter projection.

Implementation references: [sharp input validation options](https://sharp.pixelplumbing.com/api-constructor/), [Tesseract.js worker API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [bundled language data](https://github.com/naptha/tessdata), [DeepSeek JSON mode](https://api-docs.deepseek.com/guides/json_mode/), and [DeepSeek chat completion API](https://api-docs.deepseek.com/api/create-chat-completion/).
