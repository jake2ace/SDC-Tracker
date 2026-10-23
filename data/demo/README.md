# Recording assets

These invented receipts support the seeded Lumen demonstration. Every image visibly says **SYNTHETIC DEMO**. They are separate from the frozen 40-image evaluation and must not be added to its accuracy totals.

| File | Use |
| --- | --- |
| `receipts/lumen-partial.png` | RM9,000 against seeded `LUMEN-DEMO-001` (RM18,000 outstanding); matches the existing `LUMEN-CREDIT-001` bank credit |
| `receipts/lumen-final.png` | A separate final RM9,000 transfer, reference `LMN-231026-002` |
| `bank-lumen-final.csv` | Import this new credit before checking the final receipt |
| `receipts.generated.json` | Expected visible fields, hashes and generation provenance; not runtime model input |

The sender shown on the screenshot uses **DEMO SENDER BANK A**. The receiving-side CSV uses **DEMO RECEIVING BANK**, as the seed does. Matching uses the reference, amount, payer and allowed date window, not equality between sending and receiving bank names.

## Rebuild

From the repository root, with the existing dependencies installed:

```sh
node --experimental-strip-types scripts/generate-demo-receipts.ts
```

The generator reads only `data/seed/demo-state.json` and writes only `data/demo/`. It never reads gold labels or modifies evaluation inputs. The same seed, generator, Sharp version and installed fonts produce the same image bytes; the manifest records those inputs. Generation alone does not establish OCR or model accuracy.

## Demonstration order

1. Use a dedicated clean demo database, Lumen's Finance identity and invoice `LUMEN-DEMO-001`. The first bank credit is already in the seed; importing `data/seed/bank-lumen.csv` again should not duplicate it.
2. Upload `lumen-partial.png`, inspect the original and extracted fields, run the bank check and explicitly approve the partial payment. The remaining balance is RM9,000.
3. Review and confirm the remaining RM9,000 promise for 28 October 2026. Compare the on-time forecast with seven days late. The approved first receipt stays actual cash.
4. To demonstrate full settlement, import `bank-lumen-final.csv`, upload `lumen-final.png`, inspect and approve the eligible match. The invoice becomes fully paid, collections stop and the remaining expected receipt disappears.
5. To demonstrate duplicate protection, retry the same previously recorded image or credit and show the result. Do not fabricate a second customer transfer from the same receipt.

The transfer times are 23 October 2026, 10:30 and 11:00 MYT, before the fixed 12:00 MYT demo clock. If OCR/model extraction requires a correction, show the correction and its reason openly. These assets do not prove any real transfer or bank connection.

Local Tesseract.js 7.0.0 inspection on 24 October 2026 read both displayed amounts, banks, payers, references and timestamps exactly. This is an OCR-only check, not a DeepSeek call, ledger approval, model-accuracy evaluation or recorded demonstration.

## Isolated real pipeline check — 24 October 2026

Both images subsequently passed the actual local OCR → DeepSeek `deepseek-flash` → bank match → explicit synthetic approval flow in a fresh temporary database. Exactly **2 receipt model calls** were made, with **0 manual corrections**. Both extractions were `ready`, reported confidence `0.95` and had no fallback reason; the bank, amount, payer, reference and transfer time matched the displayed fields.

| Asset / action | Observed result |
| --- | --- |
| Partial receipt | `partial` match against `bank_lumen_001`; approved RM9,000, RM9,000 outstanding; collections remained active |
| Final CSV | 1 new bank credit imported |
| Final receipt | `confirmed` match; approved another RM9,000; total received RM18,000, outstanding RM0; collections stopped |
| Forecast after settlement | Both scenarios contained the two RM9,000 actual-payment entries and no remaining expected receipt for this invoice |

This verifies these two recording assets, not an accuracy rate or a recording of the UI demonstration. The existing demo database and frozen evaluation data were unchanged; no real bank or customer was contacted. Model confidence is a routing signal, not measured accuracy.
