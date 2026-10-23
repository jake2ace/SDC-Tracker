# Receipt and reply extraction evaluation

The STEP-5 evaluation uses synthetic inputs only. A real DeepSeek call and a real local OCR pass are separate from deterministic HTTP test substitutes. A payment claim or successfully extracted receipt is never itself an approved payment.

## Reproduce

```sh
npm ci
node --experimental-strip-types scripts/generate-receipts.ts
DEEPSEEK_MODEL=deepseek-flash node --experimental-strip-types --env-file=.env scripts/evaluate-extraction.ts --provider=deepseek
```

Set `DEEPSEEK_API_KEY` in the local `.env` or environment. The evaluator refuses to label an unconfigured provider as a real run. It writes `docs/evaluation/extraction-deepseek-results.json` and prints only a compact summary. `--provider=unavailable` is a deliberately unavailable provider audit and writes a separate report; its results are never included in the real-model accuracy figures.

## Recorded result

The [saved per-case report](extraction-deepseek-results.json) ran on 23 October 2026, 15:58:31–15:59:13 UTC, using Node 25.8.1, local Tesseract.js 7.0.0 and DeepSeek `deepseek-flash`. No input or source file changed during the run. All 40 images completed local OCR. There were 79 real model calls with validated outputs; one reply was blocked as an instruction attempt before any model call.

| Measurement | Result |
| --- | --- |
| Receipt amount exact | 40/40 (100%) |
| Receipt reference exact | 35/40 (87.5%) |
| Receipt transfer time exact | 40/40 (100%) |
| Reply intent exact | 39/40 (97.5%) |
| Reply amount / promised date exact | 39/40 each (97.5%) |
| Required reply review preserved | 40/40 |
| Separate injected confidence guards | 6/6 |

Five references (`receipt_eval_013`, `014`, `015`, `019`, `020`) retained OCR confusions between `O` and `0`. They count as failures; no label-based repair was applied. `reply_eval_035` was safely blocked as `UNTRUSTED_INSTRUCTION`, but remains an extraction miss in all accuracy denominators. Six future-dated receipts require review despite correct extracted fields. Overall, 34 receipts and 21 replies were ready; the other 6 receipts and 19 replies required review or manual handling.

## Inputs and scoring

- The original `data/eval/receipts.manifest.json` remains the frozen plan for 40 images. `data/eval/receipts.generated.json` records the actual generated image paths, hashes, dimensions and renderer version. All images visibly state **SYNTHETIC DEMO**.
- Four layouts each contain ten images: transfer slip, mobile confirmation, web receipt and compact history. Normal, cropped, noisy and dark variants retain all required fields. Four representative rendered images were visually inspected across these layouts, including cropped, noisy and dark variants.
- The offline generator reads frozen receipt gold to draw invented evidence. Production OCR and extraction receive image bytes and extracted text, never the gold labels. The scorer compares its outputs to gold only after extraction.
- All 40 receipt images and all 40 frozen multilingual replies stay in the accuracy denominators, including failed, rejected and incomplete outputs. UTC timestamps are compared as exact instants, so equivalent `.000Z` serialization is accepted.
- The frozen reference time stays `2026-10-23T04:00:00Z`. Six planned receipt timestamps occur later than this clock. Correctly retaining those fields while requiring human review is expected; extraction accuracy and readiness are reported separately.
- Six injected confidence probes test routing at and around the `0.85` threshold, including invalid confidence. These are substitute tests, separate from the 80 real-input results.

The report retains each synthetic input's OCR text, extraction output, provenance, expected fields and comparison result. It records input/source SHA-256 values at the start, source changes during execution, requested and returned model information, and actual local OCR engine versions. No raw images, customer records or bank statements are sent to the model.

## Scope

The images are controlled generated examples, not photographs from real banking applications. Results do not establish production accuracy or calibrated confidence. Low confidence, missing fields, future dates and provider/OCR failures remain recoverable review states. Independent integration tests use explicitly named substitutes to check HTTP access, persistence, corrections, idempotency and unchanged ledger state without spending model requests.
