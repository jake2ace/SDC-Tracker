# STEP-8 submission requirements

Verified on **24 October 2026 (MYT, UTC+8)** against the current official sources below. This is a preparation checklist, not evidence of deployment, team approval or submission. The team has waived STEP-7 manual timing and member review; those activities were **not performed**, and no measured staff-time saving or member sign-off may be claimed.

## Deadline and submission route

- **Preliminary deadline: 25 October 2026, 07:59:59 MYT.** Participant Handbook §6.3.1 and its preliminary timeline state this exact time. The current [homepage](https://sdchack.my/) and [FAQ](https://sdchack.my/faq) now say 25 October, 7:59 AM, consistent at minute precision. The older local 22 October note reporting 23:59 must not be used as a later deadline.
- Submit through [sdchack.my/submit](https://sdchack.my/submit). Participant Handbook §10.1–10.2 requires a valid GitHub repository link through the official website. The authenticated form was read on 24 October: it asks only for a public GitHub repository URL and an API Premium sponsor-technology confirmation. It permits resubmission until 25 October, 7:59 AM MYT. No form was filled or submitted during this check.
- T&C §5.5.7 and Participant Handbook §6.3 state that changes after the deadline require organiser instructions. Preserve the submitted version and the actual receipt; a merged PR or deployed URL is not a submission receipt.

## Required deliverables

Participant Handbook §6.3.5 lists six preliminary deliverables. Keep the final README links aligned with the same code and demo version.

| Deliverable | Verified requirement | File / access preparation |
| --- | --- | --- |
| Product requirement documentation | Complete the official preliminary proposal template, within its field limits, and export one PDF. | `submission/SDC2026_Lets go_Preliminary.pdf`; registered spelling verified in the portal. |
| Pitch deck | Explain the problem, solution, technical approach and expected impact; match the recorded pitch. | Prepare a `.pptx` and link it from README. No preliminary slide-count limit was found. |
| Functional prototype | A working deployed link or accessible demo build; a video or static mock-up does not replace it. | Include tested access/run instructions and synthetic demo identities. |
| Technical and tools declaration | Declare APIs, services, AI tools/models, datasets, sponsor resources and pre-existing materials using the official template. | `submission/SDC2026_Lets go_TechDeclaration.pdf`. |
| GitHub source repository | Public during judging, organised and complete, with genuine development history and Apache-2.0 licence. | Existing repository; no new repository is required. |
| Pitch video | YouTube, **5–7 minutes**, including the prototype demonstration. Handbook §6.3.5.6 specifies a one-point deduction for each excess 30 seconds, subject to final judging rules. | Plan Public visibility per the recorded orientation instruction; do not treat an unpublished recording as a final video URL. |

The current Handbook requires a structured preliminary slide deck but names `.pptx` explicitly for the final deck (§6.6.4.6). The local orientation record also specifies `.pptx` for the preliminary deck, so PPTX is the preparation format. The Handbook confirms YouTube and duration; **Public** video visibility comes from the 19 October orientation record, not an explicit visibility sentence in the current Handbook. That recording was not replayed during this check.

## Official templates and exact fields

The [official documentation folder](https://drive.google.com/drive/folders/1KvSNvXRXrnYpJ2rGterZx6Gfchi64Nkz) currently includes editable DOCX files added on 22 October and the original PDF templates. Use their structure rather than replacing them with a free-form report.

### Preliminary proposal

[Editable DOCX](https://docs.google.com/document/d/1RUb7bQvtaI5ds8SLHQtzAFmg8OGb9WsK/edit) · [PDF template](https://drive.google.com/file/d/1jNjuMJfhMYjo3qQw_PmmeGM-INEwuleo/view)

| Section | Required content / limit |
| --- | --- |
| 1. Team & Project Overview | Team name, domain, SDG track, project name, leader name/email/phone, university affiliation(s), member count. |
| 2.1 The Problem Context | Specific problem, affected people and significance; **maximum 250 words**. |
| 2.2 The Proposed AI Solution | High-level application, useful AI role, and relevant technical/workshop elements; **maximum 300 words**. Do not invent workshop attendance. |
| 3.1 Conceptual Tech Stack | Languages, frameworks, APIs, databases; system block diagram or appendix; identify any official sponsor-provided GenAI API/cloud platform actually used. |
| 3.2 Design-Thinking & Deployment Strategy | Actual design process, usability and deployment plan; **maximum 200 words**. Do not invent interviews or user tests. |
| 4. Environmental & SDG Impact Framework | Exact SDG sub-targets, numeric problem baseline, measurable KPI and realistic percentage-based Phase-2 target. Estimated data, published research and public benchmarks are allowed when labelled and cited. Technical test accuracy is a technical proxy, not measured staff productivity. |
| 5. Eligibility & Readiness Checklist | Tick only applicable, verified statements. Includes all members completing mandatory GenAI, Database and Cloud Deployment workshops; this has not been verified. |
| 6. IP & Originality | Prior-owned/pre-event work; third-party code/datasets/models with type and licence; employment/internship/consulting IP conflicts. Distinguish earlier work during this same event from work predating the event. |
| 7. Declaration | Leader confirms accuracy and original work during the hackathon; signature and date require the leader's actual confirmation. |

The template requires every field to be completed and one `SDC2026_TeamName_Preliminary.pdf`. No additional overall page cap was found in the inspected template or preliminary Handbook section.

### Technical & Tools Declaration

[Editable DOCX](https://docs.google.com/document/d/1680e_RAmWr2hrOn9DwJeL-nwT3VXdH7l/edit) · [PDF template](https://drive.google.com/file/d/1LBXfXrFblX-dHanSP8jhUOMGfGGxY2ew/view)

| Section | Required content / limit |
| --- | --- |
| 1. Team & Project Overview | Team/project/leader details, university, live prototype URL, code URL. |
| 2.1 System Architecture Overview | **Maximum 200 words**. |
| 2.2 Languages, Frameworks & Libraries | Name/version, purpose, licence. |
| 3.1 External APIs | Every external API, provider, purpose and access tier; never keys. |
| 3.2 Cloud Platforms & Deployment | Service/provider, purpose, plan/region actually used. |
| 4.1 AI Models Used in the Solution | Model/version, source/provider, pre-trained/fine-tuned/self-trained usage, terms/licence. |
| 4.2 Datasets | Name/source, public/private/self-collected/synthetic type, licence, personal-data indicator; include evaluation data. |
| 4.3 AI-Assisted Development | Yes/No; tools/version, purpose, minor/moderate/major extent; actual review/testing/responsibility description **maximum 100 words**. This includes coding, design, text and documentation assistance. |
| 5. Sponsor Resources | Yes/No and actual sponsor/resource/use; essential versus replaceable explanation **maximum 100 words**. |
| 6.1 Data Handling & Privacy | Collection, storage, third-party transmission, protection and retention; **maximum 150 words**. |
| 6.2 Known Limitations & Risks | AI limits and implemented mitigations; **maximum 150 words**. |
| 7–8. Checklist and Declaration | Verified applicable statements only; leader signature/date. |

Complete every section. Use **No/None** only when accurate, instead of leaving non-applicable categories blank. A normal development-style README does not replace this disclosure. This template explicitly says declaring development AI does not itself reduce the score; undeclared use may.

## Replit, RunPod and repository access

- **Replit is required as part of the solution** (Participant Handbook §9). Other declared tools/frameworks/services are allowed alongside it. Before submission, include actual use evidence in the Technical & Tools Declaration (§10.6): a live Replit deployment URL, a project link giving access to project history, or evidence of exhausted Replit credit. It must show the team's own account/project. A `.replit` configuration file alone does not demonstrate actual Replit use.
- **RunPod must be used for work requiring a GPU**, including GPU training, fine-tuning and inference (Handbook §9). For teams that used it, §10.7 requires dashboard evidence showing the team's account, Pod ID (or serverless endpoint URL), GPU type and runtime.
- The [repository template](https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template) includes `SDC2026_TeamName_Replit_POU.pdf` and `SDC2026_TeamName_Runpod_POU.pdf` in `submission/`, plus required Replit/RunPod README sections. Use the verified label `Lets go` in place of `TeamName`. The template's generic RunPod checklist is broader than the Handbook's GPU-conditioned rule. Do not fabricate a use screenshot or mark an unused platform as used.
- This check did **not** find official wording explaining whether a hosted model API such as DeepSeek triggers the RunPod GPU condition. Do not claim an exemption based solely on the absence of a locally managed GPU. Resolve applicability before making the final sponsor compliance declaration.
- Handbook §10.3 explicitly requires the submitted repository to be **public** throughout judging. Earlier §6.1 allows private development and instructs teams to add designated committee accounts. The Domain-2 brief's “public or accessible to judges” wording does not remove the more specific submitted-repository rule. Obtain exact committee usernames if required; do not guess accounts.
- Keep the root README organised like the official repository template: team information; links; overview; features/stack; project structure/architecture; tested run instructions; actual Replit/RunPod use; challenges/learnings; future work; team; checklist; licence. The template's Python/RunPod code is illustrative and does not require replacing this project's Node/React stack.

## Domain-2 content boundaries

The current [Domain-2 brief](https://drive.google.com/file/d/11wqbeO-HYep-DJPQ-LPZnrZfQvCgr5BU/view) requires a clear recurring SME problem and one connected journey: trigger, relevant data, decision logic, authorised human approval and logged outcome. Explain all six must-haves in the proposal; demonstrate the most important working feature at preliminary stage. Preliminary weights are innovation 30%, problem–solution fit 25%, feasibility 25%, clarity 20%.

Use only team-created synthetic business data. Simulated login/profile/RBAC and invented interface/API assumptions are allowed; live Orbyte access is not required or provided. Show prospective Orbyte reuse across SMEs. Real payment processing, statutory filing and legal/financial advice are out of scope. The brief explicitly points to SDG 8 targets 8.2 and 8.3; optional links to 10/12 need an actual rationale. Real SME validation is an optional advantage, not a required interview quota.

STEP-7's ten-receipt manual time comparison and member-review record were project acceptance tasks, not identified official deliverables. Their waiver permits continuing STEP-8; it does not create evidence of team review, savings or official readiness.

## Verified team details

The authenticated [team portal](https://sdchack.my/portal) and the user's registration screenshot agree: **Lets go**, **Domain 2 — ALPHA RED**, **4 members**. Personal contact details, refund-bank details and vouchers are deliberately excluded from this repository record.

| Registered name | University | Confirmed registered role |
| --- | --- | --- |
| Jiazhong Yang | Monash University Malaysia | Team leader |
| LOW LI XIN | Universiti Malaya | Member |
| Jieheng Li | Monash University Malaysia | Member |
| Lingchen Wu | Monash University Malaysia | Member |

Development/presentation roles are not inferred from these registration fields.

## Final submission status — 25 October 2026

- Leader contact details and actual member contributions were supplied directly by the team. Mandatory workshops, prior-work and employment/IP answers were confirmed; both official forms contain the leader-authorised typed signature and date 25 October 2026.
- The final official PDFs, pitch deck, Replit evidence and truthful RunPod non-use statement are available through the [submission index](../submission/README.md). The public prototype and 6:19 YouTube video were checked; final artifact hashes are recorded in the [manifest](../submission/manifest.json).
- The portal already stores the repository URL and displays “API integration confirmed”. The refreshed [saved-state evidence](../submission/SUBMISSION_STATUS.md) records that existing status without inferring the original save time or reaccepting the statement. The stored checkbox is not independent sponsor-policy verification; no organiser clarification or exemption is claimed.
- The team leader explicitly chose to use the existing tested demonstration for this competition and improve data persistence later. STEP-8 is complete within that accepted scope; hosted redeployment durability remains a [follow-up engineering item](https://github.com/jake2ace/SDC-Tracker/issues/40), not a passed test.

## Sources inspected

| Source | Version / scope of this check |
| --- | --- |
| [Participant Handbook](https://drive.google.com/file/d/1fGBS-jevDj_FrF8wsbYNPzyU5TTrfk1V/view) | Drive modified 23 October 2026, 08:48:26 UTC; current text read, especially §§6.1, 6.3, 9, 10. |
| [Official Terms & Conditions](https://drive.google.com/file/d/1tZOLKK-fA7Uh3zu1otdL6Z-oC_FKMtyl/view) | Drive modified 23 October 2026, 08:48:18 UTC; project, originality, repository, AI, submission and freeze rules read. |
| [Domain 2](https://drive.google.com/file/d/11wqbeO-HYep-DJPQ-LPZnrZfQvCgr5BU/view) | Drive modified 20 October 2026, 04:53:11 UTC; all extracted brief text read. |
| Official preliminary DOCX, linked above | Drive modified 22 October 2026, 11:41:08 UTC; complete extracted text/fields read. |
| Official technical declaration DOCX, linked above | Drive modified 22 October 2026, 08:15:44 UTC; complete extracted text/fields read. |
| [Repository template](https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template) | Current README inspected 24 October; filename/layout guidance. |
| [Homepage](https://sdchack.my/) and [FAQ](https://sdchack.my/faq) | Rechecked 25 October; both state 25 October, 7:59 AM MYT. |
| [Submission form](https://sdchack.my/submit) and [team portal](https://sdchack.my/portal) | Registration fields inspected 24 October; submission page refreshed 25 October and saved repository URL/status captured. The check did not change or reaccept the stored declaration. |
| Local 19 October orientation evidence | `比赛资料/会议截图_2026-10-19/10-preliminary-submission-six-items.png`, `11-tools-and-github-rules.png`, `13-presentation-format.png` visually inspected; meeting notes provide the Public-video/preliminary-PPTX verbal clarification. Older evidence, not a new audio verification. |

The official Terms take precedence for policy; the Participant Handbook supplies operational detail. If a current organiser announcement changes these instructions, preserve and follow that specific announcement rather than silently editing the evidence.
