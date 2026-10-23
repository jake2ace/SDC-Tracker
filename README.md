# Milestone2Cash Proof-to-Cash

[English](README.md) | [简体中文](README.zh-CN.md)

> Help Malaysian service micro-businesses invoice completed work, follow up on overdue balances and check payment claims against bank records before recording payment.

**The frontend now connects all seventeen backend contract operations, including reviewed payment allocation, partial balances, payment promises and 30-day forecasts.** Local integration results are recorded in the [STEP-7 report](docs/evaluation/STEP7-INTEGRATION.md). The manual timing comparison and independent member review were skipped at the project owner's request; no such results are claimed. Deployment and submission are the current step.

This README follows the section order of the [SDC submission template](https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template/blob/main/README.md). Template alignment does not mean submission requirements are complete.

## Team Information

| Field | Details |
| --- | --- |
| Team Name | Lets go |
| Team Domain | Domain 2 — Orbyte Smart SME Challenge |
| SDG Track (1–17) | SDG 8 — Decent Work and Economic Growth; targets 8.2 / 8.3 proposed |
| Team Leader | Jiazhong Yang |
| Universities | Monash University Malaysia; Universiti Malaya |
| Number of Members | 4 — registered roster confirmed |

## Links

| Resource | Link / status |
| --- | --- |
| GitHub Repository | [jake2ace/SDC-Tracker](https://github.com/jake2ace/SDC-Tracker) |
| Shared Contract | [Contract guide](docs/CONTRACT.md) · [types, rules and fixtures](contracts/) |
| Backend API | [Startup, configuration and implemented endpoints](docs/BACKEND.md) |
| Local Integration | [Browser, API and model validation](docs/evaluation/STEP7-INTEGRATION.md) |
| Deployment Guide | [Single-port build, hosting and persistence](docs/DEPLOYMENT.md) |
| Submission Preparation | [Documents and remaining requirements](submission/README.md) |
| Synthetic Data | [Demo seed](data/seed/README.md) · [evaluation inputs and separate gold](data/eval/README.md) |
| Replit Project | Pending |
| Live Demo | Pending |
| RunPod Endpoint | Not used for this rebuild |
| Slide Deck | Prepared separately; [local slide requirements](submission/SLIDE_REQUIREMENTS.md) |
| Demo Video | Pending |

## Overview

### Problem

Small service businesses must track milestone invoices and overdue balances. A customer's “I have paid” message or screenshot still needs checking against bank records, especially when payments are partial, duplicated or inconsistent.

### Solution

The application flow is: **milestone completed → invoice draft → Owner approval → overdue reminder draft → Finance confirms simulated sending → customer reply or screenshot → OCR and field extraction → bank-record matching → Finance approves payment allocation → balance, reminders, 30-day forecast and audit log update.**

The new focus is payment-proof checking: AI helps read the claim, rules explain the match, and a person approves the entry. Partial payments leave the remaining balance outstanding. The prototype uses team-created synthetic data and simulated sending and bank data, with no real payments or bank integration.

### Key Features

- **Invoices and collections:** milestone invoices and editable reminders with human approval.
- **Proof review:** extracted fields, bank-credit candidates, duplicates, mismatches and manual fallback.
- **Payment tracking:** approved partial/full allocations, remaining balances and traceable cash forecasts.

The browser UI connects invoicing, collections, receipt extraction, bank matching, Finance-approved payment allocation, remaining balances and cash forecasts through the shared API contract.

### Tech Stack

| Layer | Technology / status |
| --- | --- |
| Frontend | React + TypeScript + Vite, in `web/` |
| Backend | Node.js HTTP API; Node.js 24 LTS recommended |
| Database | SQLite; local persistence and transactions verified; hosted durable storage pending |
| AI / Compute | Bundled local Tesseract OCR; server-side DeepSeek extraction; explicit manual fallback without a key |
| Hosting / Dev | Replit use and deployment to be verified |

## Project Structure

Current implementation, data and documentation entry points:

```text
.
├── README.md / README.zh-CN.md
├── CONTRIBUTING.md
├── src/                        # HTTP API, business operations and SQLite store
├── scripts/                    # Database tools and independent evaluators
├── tests/integration/          # API, persistence and browser integration tests
├── web/                        # React UI; separate frontend unit tests in web/tests/
├── contracts/                  # v1.0.0 types, rules, fixtures and checks
├── data/seed/                  # Synthetic demo state and bank CSVs
├── data/eval/                  # Evaluation inputs and separate gold labels
├── docs/
│   ├── PRODUCT_SPEC.md / ISSUE_PLAN.md
│   ├── CONTRACT.md / BACKEND.md
│   ├── FRONTEND_HANDOFF.md / TEAM_GUIDE.md
│   ├── decisions.md
│   └── issues/                 # Eight implementation tasks
├── submission/README.md        # Planned documents and evidence checklist
└── LICENSE
```

The API in `src/` and UI in `web/` run locally. Test code stays outside production modules. See the [submission document checklist](submission/README.md) for planned materials.

### Architecture

**Browser UI → Node.js API → SQLite.** The server runs OCR, calls DeepSeek for allowed extraction tasks, and matches imported synthetic bank credits. Human approval gates ledger and forecast updates. See [the product specification](docs/PRODUCT_SPEC.md).

## How to Run

### Option 1 — Run on Replit

The repository includes a `.replit` build/start configuration and [deployment instructions](docs/DEPLOYMENT.md). The actual team project and public URL have not yet been verified. A normal Replit published filesystem is not verified durable SQLite storage; hosted persistence requires a suitable database or persistent host.

### Option 2 — Run Locally

Use Node.js 24 LTS and npm. Clone the repository and start the API:

```bash
git clone https://github.com/jake2ace/SDC-Tracker.git
cd SDC-Tracker
npm ci
npm ci --prefix web
# Keep an existing .env and its server-side key.
test -f .env || cp .env.example .env
npm run db:init
npm start
```

In a second terminal, run `npm run dev:web` from the repository root and open `http://localhost:5173`. The demo sign-in screen opens the workspace; select a demo identity to work as PM, Owner or Finance. The UI defaults to the real local API. Add `?source=mock` and reload only when you want fixed fixture scenarios.

For a single-port build, stop the development servers and run:

```bash
npm run build
npm run start:production
```

Open `http://localhost:3000`; the frontend and API share this address. [Deployment checks](docs/DEPLOYMENT.md) verified local process restart and missing-key recovery. The demo identity selector is not production authentication.

Set `DEEPSEEK_API_KEY` in the root `.env` and keep `DEEPSEEK_MODEL=deepseek-flash`; the key stays server-side and must not be placed in `web/` or any `VITE_` variable. Without a usable model, reminders use an identified template and evidence can be reviewed manually.

Check `http://localhost:3000/health`. The API provides seventeen operations; examples are in the [backend guide](docs/BACKEND.md), [bank matching guide](docs/BANK_MATCHING.md), [receipt/reply guide](docs/EXTRACTION.md) and [payment/forecast guide](docs/RECONCILIATION.md):

- `GET /api/demo-users` and `GET /api/workspace`
- `POST /api/milestones/:id/complete` and `POST /api/milestones/:id/invoice-draft`
- `POST /api/invoices/:id/decision`
- `POST /api/invoices/:id/reminders` and `POST /api/reminders/:id/send`
- `POST /api/bank-statements` and `POST /api/receipts/:id/match`
- `POST /api/invoices/:id/replies` and `POST /api/invoices/:id/receipts`
- `PATCH /api/replies/:id/extraction` and `PATCH /api/receipts/:id/evidence`
- `GET /api/receipts/:id/image`
- `POST /api/matches/:id/approve-payment` and `POST /api/replies/:id/confirm-promise`
- `GET /api/forecast?asOfDate=2026-10-23&delayDays=7`

Sending and payment recording are simulated. The local integration report distinguishes browser checks, real model calls and injected failure tests. No deployed application is claimed. The demo clock is fixed at 23 October 2026; the UI reads it from the API rather than the computer's date.

### Run Tests

From the repository root:

```bash
npm run check
npm test
npm run test:web
npm run test:e2e
npm run build
npm run test:deployment
npm run test:deployment:smoke
npm run evaluate:matcher
npm run evaluate:forecast
npm ci --prefix contracts
npm --prefix contracts run check
```

The browser suite lives in `tests/integration/browser/`; frontend unit tests live in `web/tests/`. If Chromium is not installed for Playwright, run `npx playwright install chromium` once before `test:e2e`. Backend tests cover persistence, permissions, evidence uploads, extraction fallback and manual corrections. The 30 frozen matcher cases and contract checks remain separate. [Integration evidence](docs/evaluation/STEP7-INTEGRATION.md) and [extraction evidence](docs/EXTRACTION.md) distinguish local OCR, actual model responses and injected tests; synthetic accuracy does not establish production accuracy.

## How We Use Replit

Use for this rebuild is planned, not yet evidenced. Record the actual project, development/deployment use and proof-of-use document in #24; store credentials in platform secrets. No Replit use or deployment is claimed here.

## How We Use RunPod

RunPod has not been used for this rebuild; the planned MVP has no GPU workload. Confirm whether RunPod evidence applies to this track against official requirements before submission. The template's “Required” label is not evidence of use.

## Challenges & Learnings

A receipt is a claim to verify, partial payments must preserve the remainder, and an interrupted response does not prove a write failed. Integration work adds safe retries, explicit recovery after a failed workspace refresh, identity-scoped state and source-aware cash forecasts. Manual workflow timing and independent member review were skipped at the project owner's request; staff time savings have not been measured.

## Future Improvements

- [ ] Improve extraction using measured error cases.
- [ ] Consider real integrations after access, privacy and operating requirements are reviewed.

## Team

| Name | University | Role |
| --- | --- | --- |
| Jiazhong Yang | Monash University Malaysia | Registered team leader |
| LOW LI XIN | Universiti Malaya | Team member; task ownership to be confirmed |
| Jieheng Li | Monash University Malaysia | Team member; task ownership to be confirmed |
| Lingchen Wu | Monash University Malaysia | Team member; task ownership to be confirmed |

Team members claim specific tasks through the issues below. Work is organised into project coordination, frontend design and development, backend development, testing, and documentation. All seventeen operations are connected; the next shared work is deployment, the demonstration recording and submission material.

Members can claim synthetic cases, independent calculations, test reviews, documentation, slides and demo work now. These are available tasks, not recorded assignments. Follow the [team participation guide](docs/TEAM_GUIDE.md): accept the invitation if received, update `main`, claim a scoped task in its issue, then work on a separate branch and open a PR.

### Eight-step plan

| Step | Issue | Deliverable |
| --- | --- | --- |
| 1 | [#17](https://github.com/jake2ace/SDC-Tracker/issues/17) | Complete — scope, data, API contracts and fixtures |
| 2 | [#18](https://github.com/jake2ace/SDC-Tracker/issues/18) | Complete — backend, invoicing, collections and permissions |
| 3 | [#19](https://github.com/jake2ace/SDC-Tracker/issues/19) | Frontend implemented and connected to all seventeen operations |
| 4 | [#20](https://github.com/jake2ace/SDC-Tracker/issues/20) | Complete — bank CSV and deterministic matching |
| 5 | [#21](https://github.com/jake2ace/SDC-Tracker/issues/21) | Complete — OCR, AI extraction and manual fallback |
| 6 | [#22](https://github.com/jake2ace/SDC-Tracker/issues/22) | Complete — payment approval, partial payments and forecast |
| 7 | [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | Complete — technical integration; manual timings and member review skipped by request |
| 8 | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | Deployment, presentation and submission checks |

Details: [dependencies and acceptance plan](docs/ISSUE_PLAN.md) · [frontend handoff](docs/FRONTEND_HANDOFF.md) · [decisions](docs/decisions.md).

## Submission Checklist

- [x] Confirm registered team leader, roster and universities.
- [ ] Confirm proposed SDG targets and actual contributions.
- [ ] Add the slide deck and demo video links.
- [ ] Record Replit use and proof of use.
- [ ] Resolve RunPod applicability and provide any required truthful evidence.
- [ ] Complete the Preliminary Submission and Technology Declaration PDFs.
- [ ] Name submission files using the confirmed team name and official template.
- [ ] Verify deployment, links and all “How to Run” instructions.
- [ ] Review the final repository for credentials and private data.
- [ ] Confirm measured claims and AI/tool declarations; retain the actual submission receipt.

## License

Licensed under [Apache License 2.0](LICENSE).
