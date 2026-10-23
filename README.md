# Milestone2Cash Proof-to-Cash

[English](README.md) | [简体中文](README.zh-CN.md)

> Help Malaysian service micro-businesses invoice completed work, follow up on overdue balances and check payment claims against bank records before recording payment.

**Contract v1.0.0 is prepared and awaiting team review in [#17](https://github.com/jake2ace/SDC-Tracker/issues/17). The application is not implemented or runnable yet.** The old implementation was backed up locally and removed from `main`; its test results do not validate this rebuild.

This README follows the section order of the [SDC submission template](https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template/blob/main/README.md). Template alignment does not mean submission requirements are complete.

## Team Information

| Field | Details |
| --- | --- |
| Team Name | Lets go |
| Team Domain | Domain 2 — Orbyte Smart SME Challenge |
| SDG Track (1–17) | SDG 8 — Decent Work and Economic Growth; targets 8.2 / 8.3 proposed |
| Team Leader | Pending team confirmation |
| University | Pending team confirmation |
| Number of Members | 4 planned — confirm registered roster |

## Links

| Resource | Link / status |
| --- | --- |
| GitHub Repository | [jake2ace/SDC-Tracker](https://github.com/jake2ace/SDC-Tracker) |
| Shared Contract | [Contract guide](docs/CONTRACT.md) · [types, rules and fixtures](contracts/) |
| Synthetic Data | [Demo seed](data/seed/README.md) · [evaluation inputs and separate gold](data/eval/README.md) |
| Replit Project | Pending |
| Live Demo | Pending |
| RunPod Endpoint | Not used for this rebuild |
| Slide Deck | Pending |
| Demo Video | Pending |

## Overview

### Problem

Small service businesses must track milestone invoices and overdue balances. A customer's “I have paid” message or screenshot still needs checking against bank records, especially when payments are partial, duplicated or inconsistent.

### Solution

The planned flow is: **milestone completed → invoice draft → Owner approval → overdue reminder draft → Finance confirms simulated sending → customer reply or screenshot → OCR and field extraction → bank-record matching → Finance approves payment allocation → balance, reminders, 30-day forecast and audit log update.**

The new focus is payment-proof checking: AI helps read the claim, rules explain the match, and a person approves the entry. Partial payments leave the remaining balance outstanding. The prototype uses team-created synthetic data and simulated sending and bank data, with no real payments or bank integration.

### Key Features

- **Invoices and collections:** milestone invoices and editable reminders with human approval.
- **Proof review:** extracted fields, bank-credit candidates, duplicates, mismatches and manual fallback.
- **Payment tracking:** approved partial/full allocations, remaining balances and traceable cash forecasts.

All features above are planned, not verified implementations.

### Tech Stack

| Layer | Planned technology |
| --- | --- |
| Frontend | React + TypeScript + Vite, in `web/` |
| Backend | Node.js 22.13+ |
| Database | SQLite |
| AI / Compute | Local OCR and server-side DeepSeek; versions and capability checks pending |
| Hosting / Dev | Replit use and deployment to be verified |

## Project Structure

Current contract, data and documentation entry points:

```text
.
├── README.md / README.zh-CN.md
├── CONTRIBUTING.md
├── contracts/                  # v1.0.0 types, rules, fixtures and checks
├── data/seed/                  # Synthetic demo state and bank CSVs
├── data/eval/                  # Evaluation inputs and separate gold labels
├── docs/
│   ├── PRODUCT_SPEC.md / ISSUE_PLAN.md
│   ├── CONTRACT.md
│   ├── FRONTEND_HANDOFF.md / TEAM_GUIDE.md
│   ├── decisions.md
│   └── issues/                 # Eight implementation tasks
├── submission/README.md        # Planned documents and evidence checklist
└── LICENSE
```

Application implementation directories `src/` and `web/`, and later implementation tests/evaluation tools, are not runnable yet. See the [submission document checklist](submission/README.md) for planned filenames; PDFs will be added only when prepared and checked.

### Architecture

Planned: **browser UI → Node.js API → SQLite**. The server runs OCR, calls DeepSeek for allowed extraction tasks, and matches imported synthetic bank credits. Human approval gates ledger and forecast updates. See [the product specification](docs/PRODUCT_SPEC.md).

## How to Run

### Option 1 — Run on Replit

Not available yet. The Replit project, configuration and verified instructions will be added during implementation and deployment checks.

### Option 2 — Run Locally

With Node.js 22.13+ and npm, clone the repository:

```bash
git clone https://github.com/jake2ace/SDC-Tracker.git
cd SDC-Tracker
```

There is no app startup command yet. You can inspect the shared contract and synthetic data, then run the checks below. App installation and configuration instructions will be added with the working implementation.

### Run Tests

From the repository root:

```bash
npm ci --prefix contracts
npm --prefix contracts run check
```

This checks TypeScript contracts and runs 13 groups of structural/data consistency checks. It does **not** test an implemented app, run OCR or DeepSeek, or demonstrate matcher/forecast accuracy. Implementation tests and measured evaluation will be added in the relevant issues.

## How We Use Replit

Use for this rebuild is planned, not yet evidenced. Record the actual project, development/deployment use and proof-of-use document in #24; store credentials in platform secrets. No Replit use or deployment is claimed here.

## How We Use RunPod

RunPod has not been used for this rebuild; the planned MVP has no GPU workload. Confirm whether RunPod evidence applies to this track against official requirements before submission. The template's “Required” label is not evidence of use.

## Challenges & Learnings

Planning findings: a receipt is a claim to verify, partial payments must preserve the remainder, and frontend/backend work needs a shared contract. Implementation challenges and measured results will be recorded when observed.

## Future Improvements

- [ ] Improve extraction using measured error cases.
- [ ] Consider real integrations after access, privacy and operating requirements are reviewed.

## Team

| Name | Role | GitHub |
| --- | --- | --- |
| Registered roster pending confirmation | Task ownership pending confirmation | Pending confirmation |

Team members claim specific tasks through the issues below. Work is organised into project coordination, frontend design and development, backend development, testing, and documentation. First review the v1.0.0 contract and data in #17. After team review confirms the shared baseline, frontend mock development and backend implementation can proceed in parallel; wireframes and review can start now.

Members can claim synthetic cases, independent calculations, test reviews, documentation, slides and demo work now. These are available tasks, not recorded assignments. Follow the [team participation guide](docs/TEAM_GUIDE.md): accept the invitation if received, update `main`, claim a scoped task in its issue, then work on a separate branch and open a PR.

### Eight-step plan

| Step | Issue | Deliverable |
| --- | --- | --- |
| 1 | [#17](https://github.com/jake2ace/SDC-Tracker/issues/17) | Scope, data, API contracts and fixtures |
| 2 | [#18](https://github.com/jake2ace/SDC-Tracker/issues/18) | Backend, invoicing, collections and permissions |
| 3 | [#19](https://github.com/jake2ace/SDC-Tracker/issues/19) | Frontend design, development and API integration |
| 4 | [#20](https://github.com/jake2ace/SDC-Tracker/issues/20) | Bank CSV and deterministic matching |
| 5 | [#21](https://github.com/jake2ace/SDC-Tracker/issues/21) | OCR, AI extraction and manual fallback |
| 6 | [#22](https://github.com/jake2ace/SDC-Tracker/issues/22) | Payment approval, partial payments and forecast |
| 7 | [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | Integration and measured evaluation |
| 8 | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | Deployment, presentation and submission checks |

Details: [dependencies and acceptance plan](docs/ISSUE_PLAN.md) · [frontend handoff](docs/FRONTEND_HANDOFF.md) · [decisions](docs/decisions.md).

## Submission Checklist

- [ ] Confirm team details, registered roster and SDG targets.
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
