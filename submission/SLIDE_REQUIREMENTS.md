# Pitch slide requirements

Prepare an editable English presentation for the **5–7 minute YouTube video, including a product demonstration**. The working script targets 6:20. Seven slides are suggested; no mandatory official slide template or slide-count cap was found. The handbook expects the problem, solution, technical approach and expected impact to be covered consistently with the video.

## Sources

- [Product narrative](PRODUCT_NARRATIVE.md): official PRD section mapping, exact metrics, SDG rationale and unconfirmed fields.
- [Timed pitch and demonstration script](PITCH_SCRIPT.md): proposed narration and screen actions.
- [Recorded metrics](../docs/evaluation/STEP7-METRICS.md): measured values, retained errors and limitations.
- [Integration evidence](../docs/evaluation/STEP7-INTEGRATION.md) and [deployment checks](../docs/DEPLOYMENT.md): actual verification scope.
- [Recording assets](../data/demo/README.md): two synthetic receipts and the final-payment CSV. These are separate from the frozen evaluation data.

The recording asset report now includes a separate real-pipeline check: both receipts passed local OCR and DeepSeek with no manual correction, then matched and received explicit approval. The first left RM9,000 outstanding; the final credit settled the full RM18,000 and stopped collection. The final forecast contained two actual receipt entries and no remaining expected receipt for that invoice. These two checks do not change the frozen 40-image accuracy denominator and are not a recording of the browser demonstration.

## Suggested seven-slide structure

| Slide | Content | Visual or demonstration |
| --- | --- | --- |
| 1 | Milestone2Cash Proof-to-Cash; team name and Domain 2 | Simple title, then enter the application |
| 2 | RM18,000 invoice; first RM9,000 receipt; RM9,000 remaining | Editable amount comparison and the synthetic partial receipt |
| 3 | Inspect original, check bank evidence, Finance approves | Live partial-payment workflow; show the remaining balance |
| 4 | Confirmed promise changes expected timing; actual cash stays separate | Live on-time versus seven-day delay; optionally show final settlement |
| 5 | React interface, Node API, SQLite; local OCR and restricted DeepSeek text tasks; matching rules and human approval | Editable architecture diagram with the approval gate visible |
| 6 | Amount 40/40, reference 35/40, transfer time 40/40, reply intent 39/40; matcher 30/30; forecast 40/40 daily comparisons | Editable table; keep the synthetic evaluation label visible |
| 7 | Intended benefit, proposed SDG 8.2/8.3 alignment, next validation and registered team | Verified links only; preserve unresolved deployment/video status |

Current regression results are **50 backend tests, 16 frontend tests and three browser scenarios passed**. The original STEP-7 report records 46 backend tests; four later deployment tests account for the current total. Keep these counts separate from OCR accuracy and forecast comparisons.

## Screenshot context

- `docs/evaluation/images/step7-partial-payment.png` records the local RM9,000 partial-payment flow. The browser scenario deliberately tested manual correction when the extraction provider was unavailable. Do not label this screenshot as proof of uncorrected AI extraction.
- `docs/evaluation/images/step7-live-cash.png` records a **separate live-provider run with an RM18,000 promise**. It is suitable for explaining the forecast interface, but its plotted totals do not represent the RM9,000 partial-payment scenario. Prefer a new recording of the current application for that sequence.
- `docs/evaluation/images/step7-mobile-cash.png` shows the second company's mobile forecast. Preserve its synthetic-data label and company context.

Use screenshots at readable sizes and preserve their proportions. Keep tables and the architecture diagram editable. Put detailed source links in speaker notes. Do not replace real interface evidence with an invented screen.

## Confirmed roster

| Registered name | University | Registration role |
| --- | --- | --- |
| Jiazhong Yang | Monash University Malaysia | Team leader |
| LOW LI XIN | Universiti Malaya | Member |
| Jieheng Li | Monash University Malaysia | Member |
| Lingchen Wu | Monash University Malaysia | Member |

Presenter assignments and individual development contributions remain unconfirmed. Registration membership does not establish either. The confirmed registered team name is **Lets go**.

## Claims to preserve accurately

- All business, receipt and bank data shown in the demo are synthetic. Sending is simulated. The prototype does not move money or connect to live bank, WhatsApp, MyInvois or Orbyte services.
- Partial payment keeps the remainder collectible. A promise changes the expected receipt date and creates no actual payment.
- Five receipt-reference errors remain in the reported score. All eleven low-confidence replies went to review. Synthetic accuracy does not establish real-business accuracy.
- Manual timing and independent team review were not performed and were skipped by the project owner. Do not add a time-saving percentage, user endorsement or reviewer signoff.
- SDG alignment and the proposed Phase 2 accuracy target in the narrative are proposals, not demonstrated economic impact.
- A draft slide deck, local run or video export is not proof of public deployment, publication or competition submission. Add only verified links and actual final evidence.
