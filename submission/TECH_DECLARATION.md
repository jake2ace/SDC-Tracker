# Technical & Tools Declaration — preparation draft

**Project:** Milestone2Cash Proof-to-Cash

**Team:** Lets go

**Round:** SDC Hackathon 2026, Phase 1

**Submission deadline:** 25 October 2026, 07:59:59 MYT

This draft follows the [official Technical & Tools Declaration template](https://docs.google.com/document/d/1680e_RAmWr2hrOn9DwJeL-nwT3VXdH7l/edit). It is not signed or submitted. Transfer the verified content into that template, resolve the pending fields, and export `SDC2026_Lets go_TechDeclaration.pdf`. The official form's declarations must be confirmed by the team leader. Contact details belong in the controlled final copy, not this public repository draft.

## 1. Team & Project Overview

| Field | Value |
| --- | --- |
| Team name | Lets go |
| Project / solution name | Milestone2Cash Proof-to-Cash |
| Leader | Jiazhong Yang |
| Leader email & phone | Add privately in the final official form; phone still requires confirmation. |
| University affiliations | Monash University Malaysia; Universiti Malaya |
| Team size | 4 |
| Live prototype URL | Pending final deployment and judge-access verification. |
| Code repository URL | https://github.com/jake2ace/SDC-Tracker — verify public access before submission. |

Registered members are Jiazhong Yang (leader), LOW LI XIN, Jieheng Li and Lingchen Wu. Registration does not establish each person's implementation or presentation role; confirm actual contributions separately.

## 2. Architecture & Technology Stack

### 2.1 System Architecture Overview

The React and TypeScript interface connects to a Node.js HTTP API and SQLite store. Synthetic milestone invoices, replies, receipt images and imported bank credits belong to separate demo companies. Tesseract.js performs OCR locally. The backend sends restricted, redacted text to DeepSeek for structured extraction and reminder drafts; it never sends original receipt images. Schema and evidence checks reject unsupported output. Deterministic rules propose receipt-to-credit matches. A Finance-role user approves a current proposal before an atomic transaction records payment, allocates the credit and updates the outstanding balance. Partial payments retain the remainder for collections. A deterministic 30-day calculation separates actual receipts, expected receipts and expenses. Audit events, versions and idempotency protect consequential writes. Identity selection is simulated for the synthetic demo; it is not production authentication.

### 2.2 Languages, Frameworks & Libraries

Versions below come from the checked-in package manifests and installed package metadata on 24 October 2026. Lockfiles retain exact transitive dependencies. Preserve dependency notices when distributing built artifacts.

| Name & version | Purpose | Licence / terms |
| --- | --- | --- |
| Node.js, minimum 22.13; recommended and current deployment-check runtime 24.19.0; earlier extraction evaluation 25.8.1 | HTTP server, built-in SQLite, test runner and TypeScript stripping | Node.js licence and bundled dependency notices |
| TypeScript 5.9.3 | Shared backend/frontend types and build checks | Apache-2.0 |
| React / React DOM 19.3.1 | Interactive web interface | MIT |
| Vite 8.3.5; React plugin 6.1.2 | Frontend development and production build | MIT |
| Tesseract.js 7.0.0 | Local OCR integration | Apache-2.0 |
| `@tesseract.js-data/eng` and `chi_sim` 1.0.0 | Bundled English and Simplified Chinese OCR data | Package metadata: MIT; preserve accompanying model notices |
| sharp 0.35.5 | Image validation/decoding and synthetic-image generation | Apache-2.0; bundled libvips has separate LGPL-3.0-or-later notices |
| Playwright Test 1.64.1 | Browser integration scenarios | Apache-2.0 |
| Vitest 5.0.5 | Frontend tests | MIT |
| Ajv 8.20.0 | Contract/fixture schema checks | MIT |
| `@types/node` 22.20.5; `@types/react` 19.3.0; `@types/react-dom` 19.3.0 | Development type definitions | MIT |
| SQLite through `node:sqlite` | Local persistent entities, allocations, audit and idempotency | SQLite public-domain core; Node.js wrapper notices also apply |

The repository uses Apache-2.0 for its project code. This does not relicense third-party components. External SDKs for a bank, WhatsApp, tax filing or Orbyte are not integrated in the current prototype.

## 3. APIs & Cloud Services

### 3.1 External APIs

| API & provider | Purpose | Access tier |
| --- | --- | --- |
| DeepSeek chat-completions API, `https://api.deepseek.com` | Validated structured receipt/reply extraction from restricted text; reminder draft generation | Existing team-provided API account/key. Billing tier requires team confirmation; not claimed as sponsor-provided. |

The DeepSeek key remains server-side and is omitted from this document, browser code and source control. The app does not call live bank, payment, WhatsApp, tax or Orbyte APIs. Recording a sent reminder or approved payment changes synthetic demo records only.

### 3.2 Cloud Platforms & Deployment

| Service & provider | Purpose | Plan / region and status |
| --- | --- | --- |
| GitHub | Source history, issues, pull requests and repository distribution | Existing repository; account plan and final public access require confirmation. |
| DeepSeek hosted API | Application inference | Provider-managed service; account plan, processing location and retention terms require confirmation. |
| Replit | Required sponsor platform; project workspace and shared demonstration hosting | [Project](https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash) and [public demo](https://milestone-2-cash-proof-to-cash.replit.app/); Node.js 24, Reserved VM 0.5 vCPU / 2 GiB in Asia. Actual checks and storage limitations are recorded in [hosted verification](../docs/evaluation/HOSTED-VERIFICATION.md). Formal proof PDF remains pending. |
| RunPod | No verified application workload or endpoint in the current code/evidence | No use claimed. Applicability of the GPU rule to hosted API inference still needs official clarification. |

Local development and tests are verified separately from cloud deployment. Do not mark a cloud host as deployed until its real URL and execution/persistence checks are recorded.

## 4. AI Tools, Models & Datasets

### 4.1 AI Models Used in the Solution

| Model & version | Source / provider | Usage | Licence / terms |
| --- | --- | --- | --- |
| `deepseek-flash` | DeepSeek hosted API | Pre-trained hosted model; no team training or fine-tuning. Requested and returned model name recorded in the STEP-7 evaluation. | Hosted API provider terms; final account-specific terms to be checked. Do not claim a separate open-weight licence. |
| Tesseract English and Simplified Chinese trained data, npm packages 1.0.0 | `@tesseract.js-data/eng`, `@tesseract.js-data/chi_sim` | Pre-trained OCR data, run locally through Tesseract.js; no team training/fine-tuning | Bundled package/model notices; package metadata reports MIT. |

The deterministic matcher and cash-flow forecast are not trained AI models. Future payment dates are scenario inputs, not learned predictions.

### 4.2 Datasets

| Dataset | Source | Type | Licence / use | Personal data? |
| --- | --- | --- | --- | --- |
| Demo companies, users, customers, projects, invoices and bank CSVs | `data/seed/` in this repository | Synthetic | Project-created fixtures under repository licence | No real personal/business records |
| 40 receipt labels, four-layout image plan and generated images | `data/eval/receipts.*.json`, `data/eval/images/`; generator in `scripts/` | Synthetic evaluation | Project-created fixtures; each image labelled synthetic demo | No |
| 40 English/Chinese/Malay reply inputs and separate gold labels | `data/eval/replies.inputs.json`, `replies.gold.json` | Synthetic evaluation | Project-created fixtures | No |
| 30 deterministic match cases and labels | `data/eval/matcher.inputs.json`, `matcher.gold.json` | Synthetic evaluation | Project-created fixtures | No |
| 4 forecast cases with independent expected daily rows | `data/eval/forecast.inputs.json`, `forecast.gold.json` | Synthetic evaluation | Project-created fixtures | No |
| Partial/final payment demonstration receipts and CSV | `data/demo/` | Synthetic demonstration | Project-created fixtures | No |

Runtime extraction does not receive evaluation gold labels. OCR pre-training data is supplied with the pretrained OCR models, not collected by the team. No model was trained or fine-tuned on these fixtures. No real customer bank statements, personal messages or company records are included.

### 4.3 AI-Assisted Development Tools

**Generative AI used in development: Yes.**

| Tool & version | Used for | Extent of use |
| --- | --- | --- |
| OpenAI Codex; exact app/model versions require confirmation from development records | Backend implementation support, integration fixes, test/evaluation scripts, repository planning and documentation preparation | Major assistance reflected in the development workflow; team to confirm final declaration |
| Anthropic Claude; exact app/model versions require confirmation from the frontend developer's records | Frontend development support and interface implementation | Major frontend assistance reported in the project workflow; team to confirm final declaration |

Other assistants or tools used by any member must be added before signing. Do not invent a precise model version when the record contains only a product name.

**Review/testing/responsibility text (maximum 100 words):**

The development workflow included type checks, separate backend and frontend tests, browser integration scenarios, deterministic matching/forecast comparisons, and real OCR/DeepSeek evaluation on frozen synthetic inputs. Failures and unsupported model outputs have explicit manual-review paths. These automated checks establish recorded technical behavior, not independent human authorship review. The requested member-review exercise was skipped at the project owner's direction. Before signing, the registered members must confirm their actual review, understanding and responsibility for the submitted code and materials; this draft does not claim that confirmation has occurred.

## 5. Sponsor-Provided Resources

**Did the project use official sponsor-provided resources? Pending verified project-use evidence.** The portal's account/resource availability is not evidence that a resource was used in this project.

| Sponsor | Resource | Actual use / outstanding evidence |
| --- | --- | --- |
| Replit | Replit Core resource offered through the event | The existing project was imported, built, tested and publicly hosted in the team account. Account redemption is reported in the portal for some members. Formal ownership details and proof-of-use PDF still require team review. |
| RunPod | Event compute-credit resource | No verified project GPU workload or endpoint; do not claim usage. |
| Alpha Red Solutions / Orbyte | Domain-2 challenge brief and platform approach | Used as the product-design context; no live Orbyte API, account integration, customer data or production access. |

**Essential/replacement text (maximum 100 words):**

The current application uses portable Node.js, SQLite and a React build, with actual Replit workspace and public-host tests recorded. The formal Replit proof-of-use PDF remains pending. No GPU endpoint is used. Hosted extraction uses the team's existing DeepSeek account; deterministic matching, manual evidence review and forecasts do not depend on a sponsor model. Orbyte supplies the ecosystem design context, and the current interface assumptions are simulated. RunPod applicability and the submission form's API Premium sponsor statement must be resolved before declaring full compliance.

## 6. Security, Privacy & Responsible Use

### 6.1 Data Handling & Privacy

The prototype is restricted to synthetic demonstration data. It stores invoice/reply records, uploaded original receipt bytes, OCR text, evidence corrections, audit events and idempotency results in a local SQLite database. The backend sends only a restricted text projection to DeepSeek; receipt names and references are tokenised, unrelated reply spans are redacted, and original images/full bank CSVs are not sent. Keys stay server-side. Company-scoped checks restrict reads and writes, including receipt images. Demo identity selection is simulated, not real authentication. Data remains until an explicit database reset or deletion; no automatic retention schedule is implemented. External-provider retention and deployment access controls need confirmation before any real use. Real personal or financial records must not be uploaded to this demo.

### 6.2 Known Limitations & Risks

OCR can confuse reference characters, including O/0; synthetic evaluation does not establish real-bank accuracy. DeepSeek may return incorrect, ungrounded or low-confidence output, or fail due to provider limits. Schema checks, evidence checks, confidence thresholds and manual review handle these cases. A screenshot alone never proves settlement: rules match it against imported synthetic bank credits, then Finance approves a current proposal. Version checks, transactions and idempotency prevent stale or duplicate posting. Bank and messaging integrations are simulated, identity selection is not production authentication, and forecast dates are assumptions. The manual efficiency comparison and independent member review were skipped, so no measured staff-time saving or completed team review is claimed. Deployed availability and persistence require separate verification.

## 7. Compliance & Readiness Checklist

These boxes remain unselected until the final document and actual evidence support them.

- [ ] All APIs, cloud services, AI tools, models and datasets used by every member are declared.
- [ ] The team has checked applicable licences and required notices for third-party components.
- [ ] The final repository, prototype and exported files contain no credentials.
- [ ] Development AI use has been disclosed and the registered team confirms its actual review.
- [ ] Actual sponsor use, evidence and applicability questions are resolved in Section 5.
- [ ] The final prototype and repository links work for judges.
- [ ] All official template fields are complete and within their word limits.

## 8. Declaration

**Leader:** Jiazhong Yang

**Signature:** Pending actual leader confirmation/signature.

**Date:** Pending signing date.

Do not reproduce the official confirmation as already accepted, fabricate a signature, or describe this unsigned preparation file as a completed submission.

## Evidence for completing the final template

- [Current official requirements and source versions](../docs/SUBMISSION_REQUIREMENTS.md).
- [STEP-7 measured model/matcher/forecast results](../docs/evaluation/STEP7-METRICS.md) and [integration results](../docs/evaluation/STEP7-INTEGRATION.md).
- [Extraction and data-boundary implementation](../docs/EXTRACTION.md), [reconciliation](../docs/RECONCILIATION.md), and [shared contract](../docs/CONTRACT.md).
- Version/metadata sources: root, `web/` and `contracts/` package manifests and lockfiles. Exact assistant model versions, member contributions, provider account terms and final cloud use still need human confirmation.
