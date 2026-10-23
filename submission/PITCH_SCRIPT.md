# Milestone2Cash Proof-to-Cash — pitch and demo script

Draft recording target: **6 minutes 20 seconds**, including live actions and transitions, within the handbook's 5–7 minute video requirement. The final video must include a product demonstration and use the required YouTube submission format. This is a proposed script, not evidence that a presentation, recording or independent review has happened.

Use the English interface. Replace presenter placeholders with the confirmed team roster and rehearse against the actual deployment. The names below are presentation roles, not claims about each member's development contribution.

## Before recording

- Use a dedicated demo database and verify the seeded Lumen invoice shows RM18,000 outstanding. The fixed demo clock is 23 October 2026, 12:00 MYT; make this visible.
- Use `data/demo/receipts/lumen-partial.png`: a visibly synthetic RM9,000 receipt with fields that match `LMN-231026-001` and the seeded bank credit. Inspect the actual image and extracted fields. Do not use an unrelated evaluation image and present manual replacement of its fields as correct OCR.
- For full settlement, use `data/demo/receipts/lumen-final.png` and import its matching `data/demo/bank-lumen-final.csv` credit. Otherwise use the existing recorded integration evidence and label that segment clearly. Instructions and generation provenance are in [data/demo/README.md](../data/demo/README.md).
- Verify the API data source is selected. Leave the synthetic-data and simulated-send labels visible. Keep credentials, environment files and private account details out of the recording.
- Rehearse model loading and correction time. If the provider is unavailable, demonstrate the labelled manual fallback honestly; do not describe a fallback draft as an AI response.
- Add verified deployment, repository and video links only after they exist. The confirmed registered team name is **Lets go**; use the roster in [the slide requirements](SLIDE_REQUIREMENTS.md).
- Both recording receipts passed a separate real OCR/DeepSeek, bank-match and approval check with no manual correction on 24 October 2026. See [the recording asset evidence](../data/demo/README.md). This check covers these two files; it does not guarantee a future model response or add samples to the frozen accuracy evaluation.

## 0:00–0:40 — problem and product

**Screen:** Title, then the RM18,000 Lumen invoice. **Speaker:** Presenter 1.

“We are [confirmed team name]. Our product is Milestone2Cash Proof-to-Cash, for small service businesses that invoice by project milestone and receive payment evidence through customer messages.

Imagine an overdue invoice for eighteen thousand ringgit. The customer sends a screenshot for nine thousand. Finance needs to establish whether the credit is in the bank records, avoid counting it twice, and keep collecting the remaining nine thousand. A promise to pay later must also stay separate from money already received.

Our prototype connects these decisions in one reviewed workflow. Every business record you will see is synthetic.”

## 0:40–1:20 — completed work to a reviewed reminder

**Screen/action:** Briefly show a milestone and invoice approval; return to the existing overdue invoice. In Messages, select **Draft a reminder**, inspect the draft, then **Send (simulated)**. **Speaker:** Presenter 1.

“A completed milestone creates an invoice draft. The Owner must approve it. Finance can then generate and edit a reminder for the outstanding balance. Sending requires a separate confirmation, and this demo labels the send as simulated.

AI helps with the wording. It does not issue the invoice, approve a payment, or move money. Those decisions remain explicit.”

## 1:20–2:45 — inspect evidence and approve the partial receipt

**Screen/action:** Upload the prepared RM9,000 screenshot. Show the original next to extracted fields. Inspect the bank record, select **Run bank check**, read the result, tick the review confirmation and select **Record partial payment**. Show RM9,000 still due. **Speaker:** Presenter 2.

“Here is the customer's payment screenshot. OCR reads the image locally. The text extraction proposes fields for review; the original remains visible so Finance can check them.

The bank check compares reviewed fields with imported bank credits. A screenshot alone cannot record a payment. Missing evidence, conflicts or multiple candidates require review.

This matching credit covers nine thousand ringgit of the eighteen thousand outstanding. The result is partial. I check the credit and amounts, then explicitly approve the entry.

The invoice now has nine thousand paid and nine thousand still due. Collection continues for that remainder. The system records the payment, credit allocation, balance change and activity log together. A retry cannot allocate this bank credit a second time.”

If a correction is needed, say: “This field needs correction. I am reviewing it against the original and saving the reason before rerunning the bank check.” Do not conceal the correction with an edit.

## 2:45–3:40 — a promise changes timing, not cash received

**Screen/action:** Add or inspect the customer reply: “I will pay the remaining RM9,000 on 28 October 2026.” Review the interpretation and confirm the promise. Open Cash, compare on-time with a seven-day delay. **Speaker:** Presenter 2.

“The customer now promises the remaining nine thousand on the twenty-eighth of October. The extracted date and amount require review before the promise is confirmed.

The forecast places the outstanding amount on that expected date. The receipt already approved stays actual cash; it is not counted again as expected income. Selecting a seven-day delay moves this expected receipt to the fourth of November.

Each scenario covers thirty days and keeps its contributing records traceable. This is a scenario calculation, not a guarantee that the customer will pay.”

## 3:40–4:20 — settlement and reusable controls

**Screen/action:** Show the prepared final-payment flow, or visibly labelled recorded integration evidence. Show full settlement and stopped collection. Then briefly switch to the second demo company and show its own workspace. **Speaker:** Presenter 2.

“When a second eligible credit covers the remainder, Finance approves that entry too. The invoice becomes fully paid, collection stops, and the forecast no longer expects the same remainder.

The second company has its own records and cash view. Server checks enforce company boundaries and approval roles. Identity switching here is a demo control; we do not present it as production login.”

## 4:20–5:30 — architecture and measured results

**Screen:** One architecture diagram, then the results table from the product narrative. **Speaker:** Presenter 3.

“The React interface connects to a Node API and SQLite. Tesseract performs local OCR, and DeepSeek assists with permitted text tasks. Rules perform matching and cash calculations. Human approval gates the ledger transaction.

We evaluated forty synthetic screenshots across four layouts, and forty replies in English, Chinese and Malay. Receipt amounts and transfer times were exact in all forty cases. References were exact in thirty-five. Reply intent was correct in thirty-nine of forty.

The five reference mistakes were letter O versus zero confusions, and we kept them in the score. All eleven low-confidence replies went to review. The matcher passed thirty frozen cases, and forty independent daily forecast comparisons matched exactly.

Separately, fifty backend tests, sixteen frontend tests and three browser scenarios passed. These results show performance on our synthetic set; they do not establish real-bank accuracy.”

## 5:30–6:20 — value, scope and close

**Screen:** Remaining balance and its source records, then a final card with verified links. **Speaker:** Presenter 1 or confirmed closing speaker.

“Our intended benefit is clearer control over the journey from a customer's payment claim to recorded cash. Finance can see what has been received, what remains due and why each entry was approved.

We propose alignment with SDG Eight through more efficient small-business operations. We have not measured staff time savings or gathered an independent team review, so we do not claim either.

The current prototype uses synthetic bank data and simulated sending, with no live bank or Orbyte integration. The next validation is a permissioned business pilot and a measured workflow comparison.

Milestone2Cash Proof-to-Cash turns scattered payment evidence into a reviewed record, while keeping the outstanding balance and expected cash visible. Thank you.”

## Recording checks

- Keep the final cut within the official duration after measuring the exported video, not only this script.
- Record live responses and corrections honestly. Label prerecorded evidence, mock data and fallback behavior where used.
- Never describe a payment promise, screenshot or successful import as confirmed cash.
- Do not claim manual timing, independent review, deployment or submission completion without its corresponding evidence.
- Cross-check all displayed metrics against [STEP7-METRICS.md](../docs/evaluation/STEP7-METRICS.md). Keep raw evidence linked from the repository; show the concise table in the pitch.
- Preserve the actual public video URL and final exported version after publication. This draft does not authorize or confirm publication.
