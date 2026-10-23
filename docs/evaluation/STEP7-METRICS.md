# STEP-7 quantitative evaluation

The technical accuracy targets passed on the frozen synthetic evaluation set. The paired human-versus-tool timing study and independent team review have **not** been performed and were subsequently skipped at the project owner's request on 24 October 2026; neither is claimed as complete. This report covers OCR, structured extraction, deterministic matching and forecast calculations. Browser workflow evidence is recorded separately.

## Recorded run

The real OCR/DeepSeek run took place on **24 October 2026, 00:39:16–00:39:54 MYT** (23 October, 16:39:16–16:39:54 UTC). Runtime: Node **25.8.1**, local Tesseract.js **7.0.0**, requested and returned model **`deepseek-flash`**. All 40 receipt images completed local OCR. There were **79 real model calls with validated outputs**: 40 receipts and 39 replies. One malicious-instruction reply was blocked before a model call.

The [per-case extraction report](step7-extraction-deepseek-results.json) contains expected and actual fields, original synthetic reply text, OCR text, processing status, safe failure reasons, model provenance, image/source/input hashes and timings. No tracked source or input changed during the run. The earlier [STEP-5 report](STEP5.md) and its results remain unchanged.

## Accuracy and safety results

| Measurement | Result | Acceptance target | Outcome |
| --- | --- | --- | --- |
| Receipt amount exact | 40/40 (100%) | ≥90% | Pass |
| Receipt reference exact | 35/40 (87.5%) | ≥85% | Pass |
| Receipt transfer time exact | 40/40 (100%) | ≥85% | Pass |
| Reply intent exact | 39/40 (97.5%) | ≥85% | Pass |
| Reply amount exact | 39/40 (97.5%) | Reported diagnostic | — |
| Reply promised date exact | 39/40 (97.5%) | Reported diagnostic | — |
| Low-confidence replies routed to review | 11/11 | All | Pass |
| Gold-required review routing respected | 12/12 required cases | All required cases | Pass |
| Injected confidence-boundary probes | 6/6 | All | Pass |
| Deterministic matcher cases | 30/30 | All | Pass |
| Unsafe matcher approval candidates | 0/30 | Zero | Pass |
| Independent ten-day forecast comparisons | 40/40 days across 4 cases | Exact match | Pass |

All 40 receipt inputs and all 40 reply inputs stay in their respective accuracy denominators, including unavailable or rejected outputs. Exact amount means equal integer MYR sen. Exact reference means string equality, with no gold-based repair. Transfer time compares UTC instants, permitting equivalent `.000Z` serialization. Reply intent, amount and promised date are compared individually, with missing/rejected outputs counted as misses.

`ready` is not the same as a successful model call. Of the 40 receipts with validated model outputs, 34 were ready and 6 needed review because their transfer times occur after the frozen demo clock. Of 40 replies, 21 were ready and 19 needed review/manual handling. Eleven had low confidence, three needed promise-date review, one had conflicting amounts, three were unclear and one contained an instruction attempt. The six injected probes are explicitly separate from real model accuracy.

## Errors retained in the score

| Receipt ID | Expected reference | OCR-derived actual reference |
| --- | --- | --- |
| `receipt_eval_013` | `EVAL-013-OCT26` | `EVAL-013-0OCT26` |
| `receipt_eval_014` | `EVAL-014-OCT26` | `EVAL-014-0CT26` |
| `receipt_eval_015` | `EVAL-015-OCT26` | `EVAL-015-0OCT26` |
| `receipt_eval_019` | `EVAL-019-OCT26` | `EVAL-019-0CT26` |
| `receipt_eval_020` | `EVAL-020-OCT26` | `EVAL-020-0CT26` |

The five reference misses are `O`/`0` OCR confusions in the mobile-confirmation layout. They are not silently corrected against labels. `reply_eval_035` produced no extraction because the input was classified as `UNTRUSTED_INSTRUCTION`; it still counts as a miss in all three reply accuracy measures. There were no provider-unavailable or OCR-failure fallbacks in this real run. The UI and HTTP failure-path tests are separate evidence, not extra real-model successes.

## Dataset and deterministic calculations

The images are the existing generated fixtures listed in `data/eval/receipts.generated.json`: four layouts with ten receipts each. Each layout has four normal, two cropped, two noisy and two dark examples. The 40 replies comprise 14 English, 13 Chinese and 13 Malay messages. Every image visibly identifies itself as **SYNTHETIC DEMO**. The offline generator draws invented fields from frozen labels; runtime extraction receives only image/OCR content and never receives gold labels. This run reused the generated image bytes without regenerating or tuning them.

The [matcher and forecast report](step7-deterministic-results.json) records a fresh run against the same frozen inputs and gold labels. Matching passed all 30 expected verdict, reason and amount checks, produced no unsafe approval candidates, and remained deterministic without mutating input. Forecasting passed all four cases, each with ten independent hand-calculated daily rows, as well as exact expected-receipt schedules. These fixtures compare baseline and post-partial-payment balances with promise-date changes, on-time and seven-day-delayed scenarios, and actual/expected cash separation. Both scenarios still generate 30 days with traceable entries. Full settlement is covered separately by the reconciliation integration suite. These are deterministic consistency checks, not predictions validated against real businesses.

## Measured script latency and outstanding human work

The receipt timer starts immediately before image validation, after bytes are loaded and their hash is checked. It ends when OCR and validated model extraction return. Across all 40 receipts, elapsed time was **1,153.55–1,945.11 ms**, with a **1,496.44 ms median**. The full 40-receipt/40-reply evaluation took **37.789 seconds**, using two concurrent receipt tasks followed by four concurrent reply tasks. Per-case values are saved in the JSON report.

These timings exclude browser upload, human review, matching, approval and correction. They are **not** a measurement of staff time or the required ten-screenshot manual-versus-tool comparison. No speedup, cost saving or billed API amount is claimed. The adapter does not expose provider billing information, so cost remains unreported.

The following evidence was excluded from the current STEP-7 scope at the project owner's request; it remains unmeasured and cannot support benefit claims:

- Run the same ten selected synthetic screenshots through a human baseline and the tool workflow with identical start/end points, record corrections and elapsed time, and report both sets of results.
- Have another team member independently follow the recorded workflow and leave their own review conclusion.

## Reproduce

Keep the previous key only in the ignored local `.env` file. From the repository root, use the installed dependencies and run:

```sh
DEEPSEEK_MODEL=deepseek-flash node --experimental-strip-types --env-file=.env scripts/evaluate-extraction.ts --provider=deepseek --output=docs/evaluation/step7-extraction-deepseek-results.json
npm run evaluate:matcher
npm run evaluate:forecast
```

The extraction command makes real provider requests and replaces only the explicitly named STEP-7 result file. The two deterministic commands print their reports; their recorded outputs are preserved together in `step7-deterministic-results.json`. The frozen reference clock remains `2026-10-23T04:00:00Z`; it is deliberately independent of the machine date. Synthetic accuracy does not establish real-bank OCR accuracy, model confidence calibration or production readiness.
