# Milestone2Cash Proof-to-Cash

> Help Malaysian service micro-businesses turn completed work into invoices and check payment claims against bank records before recording receipts.

Milestone2Cash connects milestone invoices, customer replies, payment screenshots, bank CSV records, Finance approval and an outstanding balance. OCR and AI help read evidence. Rules check the proposed match, and a person approves the payment. A promise changes expected timing without becoming actual cash.

Verified application baseline: [`c438678`](https://github.com/jake2ace/SDC-Tracker/commit/c4386784c9b5dacf44cc97e57a0c731931da36da). Final signed forms, slides, the 6:19 pitch video and validation evidence are linked below. The forms contain the leader-authorised typed signature Jiazhong Yang, dated 25 October 2026. This submission update changes documentation and evidence; application behavior remains at the verified baseline.

## Team Information

| Field | Details |
| --- | --- |
| Team Name | Lets go |
| Team Domain | Domain 2 — Orbyte Smart SME Challenge / ALPHA RED |
| SDG Track | SDG 8 — Decent Work and Economic Growth; targets 8.2 and 8.3 |
| Team Leader | Jiazhong Yang |
| Universities | Monash University Malaysia; Universiti Malaya |
| Number of Members | 4 |

## Links

| Resource | Link / status |
| --- | --- |
| GitHub Repository | [jake2ace/SDC-Tracker](https://github.com/jake2ace/SDC-Tracker) — public repository, verified on 25 October 2026 |
| Live Demo | [Open Milestone2Cash](https://milestone-2-cash-proof-to-cash.replit.app/) |
| Workspace Overview | [Open the demo workspace](https://milestone-2-cash-proof-to-cash.replit.app/#/home) |
| Replit Project | [Team workspace URL](https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash) — owner access may be needed; use the Live Demo link for judging |
| Preliminary Proposal / PRD | [Official-template PDF](submission/SDC2026_Lets%20go_Preliminary.pdf) |
| Technical & Tools Declaration | [Official-template PDF](submission/SDC2026_Lets%20go_TechDeclaration.pdf) |
| Replit Proof of Use | [Project and hosting evidence](submission/SDC2026_Lets%20go_Replit_POU.pdf) |
| RunPod Use Statement | [Actual non-use statement](submission/SDC2026_Lets%20go_Runpod_POU.pdf) — no RunPod workload or endpoint is claimed |
| Slide Deck | [Milestone2Cash PPTX](submission/Milestone2Cash.pptx) |
| Demo Video | [Watch the pitch and prototype demonstration — 6:19](https://www.youtube.com/watch?v=pholjV_8vBM) |
| Live Workflow Validation | [F01–F06 results](submission/validation/results.json) · [Chinese test report](submission/validation/%E6%B5%8B%E8%AF%95%E7%BB%93%E6%9E%9C.txt) · [16 screenshots](submission/validation/screenshots/) |
| Submission Index | [File guide and completion requirements](submission/README.md) |

The prototype uses synthetic companies, messages, receipts and bank records. Demo roles are selectable and are not production authentication. Sending is simulated. The application does not move real money or connect to live bank, WhatsApp, MyInvois or Orbyte services.

## Overview

### Problem

Project-based service firms often receive payment claims through short messages and screenshots. Someone must connect the claim to the invoice, find the receiving bank credit, check the amount and reference, and decide what remains due. A partial payment can otherwise be mistaken for full settlement, while duplicated evidence can be counted twice.

### Solution

Milestone2Cash keeps this work in one review flow:

1. A completed milestone creates an invoice draft for Owner approval.
2. Finance reviews an editable reminder and explicitly confirms simulated sending.
3. A customer reply or uploaded screenshot becomes evidence to review.
4. Local OCR and restricted DeepSeek extraction propose structured fields. Unsupported, ambiguous, negated or conditional replies require manual review.
5. Deterministic rules check an imported bank credit, including amount, reference, date and duplicate-allocation constraints.
6. Finance approves the proposed payment. The paid amount, remaining balance, collection state, cash scenarios and audit log update together.

An RM9,000 receipt against an RM18,000 invoice leaves RM9,000 outstanding. A later promise to pay the remainder changes an expected receipt date only. Actual received cash remains separate throughout.

### Key Features

- Milestone invoicing, Owner approval and editable reminder drafts.
- Original receipt inspection, OCR fields, manual correction and explained bank-match results.
- Finance-approved partial and full payments, duplicate protection and a traceable audit record.
- Cash scenarios with confirmed receipts separated from expected payments.
- Searchable invoices, role-specific work queues, English / Chinese / Malay interfaces, light and dark themes.

### Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript and Vite |
| Backend | Node.js HTTP API; Node.js 24 LTS recommended |
| Database | SQLite with transactions, version checks and idempotency |
| OCR | Tesseract.js with bundled English and Simplified Chinese language data; runs locally on the server |
| AI | Server-side DeepSeek `deepseek-flash` for restricted receipt/reply extraction and reminder drafting |
| Hosting / Development | Replit workspace and published demo; GitHub source control |
| Evaluation | Synthetic fixtures, separate gold labels, backend/frontend tests, contract checks and browser workflow scenarios |

## Project Structure

The code repository contains:

```text
.
├── src/                  # API, business operations, OCR/AI adapters and SQLite
├── web/                  # React application and frontend unit tests
├── contracts/            # Shared types, rules, fixtures and schema checks
├── data/
│   ├── seed/             # Two synthetic companies and initial bank records
│   ├── demo/             # Partial/final receipt images and final bank CSV
│   └── eval/             # Frozen evaluation inputs and separate gold labels
├── scripts/              # Database tools and evaluation commands
├── tests/                # Backend, integration and browser tests
├── docs/                 # Architecture, API, evaluation and deployment records
├── submission/           # Proposal, declarations, proofs of use and slide deck
├── .env.example
├── .replit
├── package.json
└── LICENSE
```

### Architecture

```text
Browser (React)
    |
    v
Node.js API on Replit -----> SQLite records and audit log
    |
    +-- local Tesseract OCR
    +-- restricted text to DeepSeek, followed by validation/manual review
    +-- deterministic bank-credit matching
    +-- explicit Owner / Finance approval gates
```

Raw receipt images and full bank CSVs are not sent to the model. The model cannot approve or post a payment. Company checks, current evidence versions and duplicate-allocation protection apply to the final payment action. See the [architecture and product specification](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/docs/PRODUCT_SPEC.md), [extraction guide](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/docs/EXTRACTION.md) and [reconciliation guide](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/docs/RECONCILIATION.md).

## How to Run

### Option 1 — Use the Published Replit Demo

**Shared state recorded after validation on 25 October 2026, 01:50 MYT:** `LUMEN-DEMO-001` is fully paid, with RM18,000 received through two RM9,000 payments and RM0 outstanding. The run also created and issued a separate RM6,000 Final handover invoice, which remains unpaid. Both Lumen bank credits have already been allocated. The run did not reset or redeploy the site.

Judges can inspect the existing settled invoice and its evidence, payments and audit trail. Repeating the following sequence from the beginning requires the project owner to prepare a clean seed state, preferably in a separate demonstration environment. The shared instance must not be assumed to start at RM0 received. The [validation report](submission/validation/%E6%B5%8B%E8%AF%95%E7%BB%93%E6%9E%9C.txt) records the completed sequence and retained state.

For a clean seeded demonstration:

1. Open the [public website](https://milestone-2-cash-proof-to-cash.replit.app/) and choose **Open demo workspace**.
2. Select **Lumen finance (demo)**. Open **Invoices → LUMEN-DEMO-001**.
3. On a clean seed, confirm RM18,000 total, RM0 received and RM18,000 still due. The first RM9,000 bank credit is already present.
4. Use the [synthetic partial receipt](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/data/demo/receipts/lumen-partial.png), inspect the evidence, run the bank check and approve the eligible partial payment as Finance. The remaining balance should be RM9,000.
5. Follow the [complete repeatable demonstration guide](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/data/demo/README.md) for promise dates, final settlement and duplicate protection.

The shared demo may receive further actions from other visitors. Its clock is fixed at 23 October 2026, 12:00 MYT. The 25 October run confirmed that page refresh preserved its payments; it did not test restarting or redeploying the host. A previous redeployment reset the ledger and uploaded evidence to the seed, so this is not durable financial storage. See the [earlier hosted verification record](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/docs/evaluation/HOSTED-VERIFICATION.md).

### Option 2 — Run Locally

Use Node.js 24 LTS and npm. From a terminal:

```bash
git clone https://github.com/jake2ace/SDC-Tracker.git
cd SDC-Tracker
npm ci
npm ci --prefix web
test -f .env || cp .env.example .env
npm run db:init
npm run build
npm run start:production
```

Open `http://localhost:3000/` for the website or `http://localhost:3000/#/home` for the workspace. The frontend and API share one port. The repository is public and can be cloned without collaborator access.

For frontend development instead, use `npm start` for the API and `npm run dev:web` in a second terminal; open `http://localhost:5173/`.

Set `DEEPSEEK_API_KEY` in the root `.env` or Replit Secrets, with `DEEPSEEK_MODEL=deepseek-flash`. Keep the key on the server; never use a `VITE_` variable for it. Without a usable provider, reminders have a visibly identified template fallback and evidence remains available for manual review. Never treat fallback as a successful AI call.

To inspect configuration and endpoint examples, use the [backend guide](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/docs/BACKEND.md). The health endpoint is `http://localhost:3000/health`.

### Run Tests

The preparation check on 24 October 2026 for source revision `c438678` passed **60 backend tests, 23 frontend tests, 13 contract/data validation groups, TypeScript checks and the production build**. The three automated browser scenarios in earlier reports were not rerun in that check or in the later UI walkthrough and are not included in these counts. The public root and `/health` endpoints also responded successfully on 24 October.

A separate live workflow check ran on **25 October 2026, approximately 01:30–01:50 MYT** against the published Replit application. All **six F01–F06 cases passed** through actual browser UI actions operated by the assistant: role-controlled milestone invoicing, editable simulated reminders, partial payment and duplicate evidence, promise dates and forecast scenarios, final settlement and duplicate CSV import, and company isolation / narrow-screen navigation / languages / themes. This was an agent-operated workflow check, not an independent member study or a staff-time comparison. Its [structured results](submission/validation/results.json), [test report](submission/validation/%E6%B5%8B%E8%AF%95%E7%BB%93%E6%9E%9C.txt) and [screenshots](submission/validation/screenshots/) are included.

Both receipt extractions and the RM9,000 promise extraction completed without manual correction and displayed 95% AI confidence in this run. The reminder displayed **AI draft**, was edited and then explicitly marked sent in the simulator. These observations cover these particular inputs; model confidence is not an accuracy measurement. The six workflows are not additional samples in the frozen 40-image / 40-reply benchmark, and they do not establish an updated current-model accuracy or review rate.

```bash
npm run check
npm test
npm run test:web
npm run build
npm ci --prefix contracts
npm --prefix contracts run check
```

Optional workflow and evaluation commands:

```bash
npx playwright install chromium
npm run test:e2e
npm run evaluate:matcher
npm run evaluate:forecast
```

Real extraction evaluation can consume the configured provider's allowance. It is separate from the commands above. [Evaluation evidence](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/docs/evaluation/STEP7-METRICS.md) records 40 synthetic receipt images and 40 synthetic replies: receipt amount 40/40, reference 35/40, transfer time 40/40 and reply intent 39/40. These are historical measurements for the evaluated version. The later conservative reply-semantic review changes require a new real-provider run before claiming those scores or review rates for the current projection. Matcher and forecast checks are deterministic consistency tests, not real-business predictive accuracy.

## How We Use Replit

The team project imports this source repository, builds the React frontend and hosts the frontend/API together. API credentials remain in platform Secrets. The [25 October live UI run](submission/validation/results.json) exercised actual AI-labelled reminders, receipt/promise extraction, bank matching, explicit approval and balance updates through all six F01–F06 cases. Earlier hosted records remain separate evidence and retain their failures, retries and successful runs.

Project workspace URL: [Milestone2Cash Proof-to-Cash](https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash). Published app: [live demo](https://milestone-2-cash-proof-to-cash.replit.app/). An anonymous HTTP check of the workspace URL returned 404 on 24 October; the public live app and health endpoint were available. Judges should use the live app, and project-history access must be verified separately by the project owner.

Proof of use: [Replit evidence PDF](submission/SDC2026_Lets%20go_Replit_POU.pdf). The hosting record does not establish durable storage across redeployments, and this prototype is not a production accounting archive.

## How We Use RunPod

The team confirms that RunPod was not used and there is no RunPod endpoint for this implementation. OCR runs locally and model requests go directly to the hosted DeepSeek API. No GPU training or fine-tuning was performed by this project.

The [RunPod statement](submission/SDC2026_Lets%20go_Runpod_POU.pdf) records actual non-use. Model inference calls the DeepSeek hosted API directly; the team did not deploy a RunPod GPU workload or perform model training or fine-tuning.

## Challenges & Learnings

- A customer claim is not a bank receipt. The system retains original evidence and waits for explicit approval before changing the paid balance.
- Partial payments preserve the remaining balance and its follow-up. Promises change expected timing without inflating actual receipts.
- Negation, conditions and removed reply text can change meaning. Current source preserves supported negations and routes these semantic risks to Finance review regardless of model confidence.
- Provider failures need an honest recovery route. Manual corrections record reasons, provenance and the reviewer instead of silently inventing model success.
- Hosting recovery can reset demo data. A reproducible seed and separate recording assets make the demonstration recoverable, but do not replace durable production storage.

Manual staff-time comparisons and independent member review were not part of the recorded technical evaluation. No measured time-saving percentage or real-SME validation outcome is claimed.

## Future Improvements

- Evaluate the stricter reply projection on a held-out multilingual set, including negations, conditions and uncommon phrasing.
- Improve receipt-reference accuracy from the recorded 87.5% baseline toward a proposed ≥95% held-out target; this is a technical target, not an achieved business result.
- Measure the same evidence-checking task manually and with the tool, recording time, error rate and review burden with consenting participants.
- Add durable hosting, real authentication and operational controls before any real financial-data deployment.
- Validate reusable Orbyte module interfaces if sponsor access and requirements permit.

## Team

| Name | University | Team-confirmed contribution |
| --- | --- | --- |
| Jiazhong Yang | Monash University Malaysia | Team leader; code implementation |
| LOW LI XIN | Universiti Malaya | Proposal concept, core feature planning, product positioning, pitch deck and video production |
| Jieheng Li | Monash University Malaysia | Code implementation |
| Lingchen Wu | Monash University Malaysia | UI design, visual appearance and user experience |

The team confirmed these contributions on 24 October 2026. It also confirmed completion of the mandatory GenAI, Database and Cloud Deployment workshops, no use of self-owned code from before this competition, and no employment or internship intellectual-property restrictions. Earlier iterations during the same competition remain part of this event's development history.

OpenAI Codex (team-confirmed model: GPT-6 Astra) and Anthropic Claude (team-confirmed model: Fable 5.1) were used for major development assistance. Codex also assisted final verification and documentation. Their purposes and extent of use are disclosed in the Technical & Tools Declaration. These contribution statements do not substitute for the leader's final declaration or independent member review.

## Final submission verification

- Final official-template PRD and Technical Declaration PDFs contain the leader-authorised typed signature and the date 25 October 2026.
- The public prototype, public source repository, Replit evidence, RunPod non-use statement, pitch deck and 6:19 YouTube video are linked above.
- The registered four-person roster, actual contributions, mandatory workshop completion and prior-work/IP answers were confirmed by the team.
- [Six live browser workflows](submission/validation/results.json) passed on 25 October. The main shared invoice is settled at RM18,000 received and RM0 due; a separate RM6,000 invoice remains unpaid.
- [Independent clean production verification](docs/evaluation/STEP8-INDEPENDENT-PRODUCTION.md) passed: clean installation/configuration/build, four deployment integration tests and nine separate production-process checks. Local restart retained records and original evidence. Missing-key template/manual behavior was also checked in the browser.
- [Final STEP-8 record](docs/evaluation/STEP8-FINAL-CHECK.md) separates current live access, local restart results, historical Replit storage limitations and the portal's saved submission state.

The deck and recorded video retain the earlier 69-check baseline (50 API, 16 UI and three automated browser scenarios). Slide 11 labels that baseline. Later verification contains 60 backend tests, 23 frontend tests and 13 contract/data groups; the three earlier automated browser scenarios were not rerun. These counts describe different checks and are not added together.

The competition portal already stores the repository URL. The [saved-state evidence](submission/SUBMISSION_STATUS.md) records the status visible on 25 October 2026; the portal does not display the original submission timestamp. Keep the public app and all submission links available during judging. The shared hosted demo should be inspected in its retained settled state; the clean local setup is the reproducible route for replaying the opening balance.

On 25 October the team leader confirmed using the existing tested demonstration for this competition. STEP-8 is complete within that accepted scope. Cloud data persistence across redeployment is a [follow-up improvement](https://github.com/jake2ace/SDC-Tracker/issues/40); it is not presented as a verified capability of this demonstration.

## License

Project source is licensed under [Apache License 2.0](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/LICENSE). Third-party packages and models retain their own licences and terms, as disclosed in the Technical & Tools Declaration.
