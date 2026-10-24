# Milestone2Cash submission files

Team: **Lets go** · Domain 2 · SDC Hackathon 2026 preliminary round.

These documents accompany source revision [`c438678`](https://github.com/jake2ace/SDC-Tracker/commit/c4386784c9b5dacf44cc97e57a0c731931da36da). The final [pitch and prototype video](https://www.youtube.com/watch?v=pholjV_8vBM) is 6:19. These files document the implementation and recorded validation. Competition submission is a separate step.

## Files for judges

| File | Purpose |
| --- | --- |
| [SDC2026_Lets go_Preliminary.pdf](SDC2026_Lets%20go_Preliminary.pdf) | Project requirements, problem, AI solution, architecture, design/deployment plan, SDG measures, readiness and originality declaration using the official template. |
| [SDC2026_Lets go_TechDeclaration.pdf](SDC2026_Lets%20go_TechDeclaration.pdf) | Actual languages, libraries, APIs, AI models, synthetic datasets, AI-assisted development, sponsor resources, privacy, limitations and declarations. |
| [SDC2026_Lets go_Replit_POU.pdf](SDC2026_Lets%20go_Replit_POU.pdf) | Actual team project and hosting evidence, with the demo's persistence limitations. |
| [SDC2026_Lets go_Runpod_POU.pdf](SDC2026_Lets%20go_Runpod_POU.pdf) | Actual RunPod non-use statement; inference calls the DeepSeek hosted API directly. |
| [Milestone2Cash.pptx](Milestone2Cash.pptx) | The team's 14-slide pitch deck, with historical validation scope labelled and clickable demo/code/video links. |
| [Live UI validation](validation/results.json) · [test report](validation/%E6%B5%8B%E8%AF%95%E7%BB%93%E6%9E%9C.txt) · [16 screenshots](validation/screenshots/) | Actual agent-operated F01–F06 browser workflow results from 25 October 2026, approximately 01:30–01:50 MYT. |

Live prototype: [milestone-2-cash-proof-to-cash.replit.app](https://milestone-2-cash-proof-to-cash.replit.app/).

The live website and health endpoint responded successfully in the preparation check on 24 October 2026. Use this published app for judging; the team workspace URL was not anonymously accessible in the same check.

## Latest live workflow evidence

All six F01–F06 cases passed through actual browser UI actions on 25 October 2026, approximately 01:30–01:50 MYT. The assistant operated the interface using the supplied synthetic test package. The cases covered invoice permissions, AI-labelled editable reminders and simulated sending, partial payment and duplicate evidence, promise dates and cash scenarios, final settlement and duplicate CSV imports, and company isolation / narrow-screen layout / languages / themes.

The two receipt extractions and the RM9,000 promise extraction needed no manual correction and displayed 95% confidence. This is a result for those inputs, not an accuracy rate, a rerun of the frozen 40-image / 40-reply evaluation, or an independent team-member study. The three earlier automated browser scenarios remain historical and were not rerun. No staff-time saving was measured.

The shared ledger was left with `LUMEN-DEMO-001` fully paid (RM18,000 received, RM0 due, two payments) and a separate newly issued RM6,000 invoice still unpaid. The run did not reset or redeploy the site. A judge can inspect the existing results; replaying from the opening balance requires the project owner to prepare a clean seed state. Page-refresh persistence passed in this run, but host restart / redeployment persistence was not retested.

Source repository: [jake2ace/SDC-Tracker](https://github.com/jake2ace/SDC-Tracker).

Video: [Milestone2Cash Pitch Video — 6:19](https://www.youtube.com/watch?v=pholjV_8vBM). Browser playback and an unauthenticated YouTube oEmbed request were verified on 25 October 2026.

## Final form and submission status

The team has confirmed member contributions, completion of mandatory workshops, no self-owned code from before the competition, no employment/internship IP restrictions, and major Codex / Claude assistance. Actual model names were supplied by the team. Both official forms contain the leader-authorised typed signature Jiazhong Yang and the date 25 October 2026. RunPod was not used; inference calls the DeepSeek hosted API directly.

The GitHub repository is public. The [submission status record](SUBMISSION_STATUS.md) contains evidence of the repository URL already saved in the official portal. The official deadline shown on the portal and FAQ is **25 October 2026, 07:59 AM MYT**.

Use the retained settled live demonstration for inspection, or the documented clean local setup for replay. The final verification does not claim hosted redeployment durability or independent SME validation. The recorded video's earlier regression counts are labelled historical in slide 11; current verification scope is recorded in the [STEP-8 report](../docs/evaluation/STEP8-FINAL-CHECK.md).

The team leader confirmed this demonstration scope on 25 October 2026: use the existing tested website for the competition and improve data persistence later. STEP-8 is complete under that decision. [Issue 40](https://github.com/jake2ace/SDC-Tracker/issues/40) tracks the later storage improvement; the existing hosted demonstration is retained.

## Materials and evidence

- [Official document templates](https://drive.google.com/drive/folders/1KvSNvXRXrnYpJ2rGterZx6Gfchi64Nkz).
- [Official repository structure](https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template).
- [Participant Handbook](https://drive.google.com/file/d/1fGBS-jevDj_FrF8wsbYNPzyU5TTrfk1V/view).
- [Domain 2 brief](https://drive.google.com/file/d/11wqbeO-HYep-DJPQ-LPZnrZfQvCgr5BU/view).
- [Source evaluation record](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/docs/evaluation/STEP7-METRICS.md).
- [Hosted verification and data reset evidence](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/docs/evaluation/HOSTED-VERIFICATION.md).
- [Synthetic demonstration assets and repeatable sequence](https://github.com/jake2ace/SDC-Tracker/blob/c4386784c9b5dacf44cc97e57a0c731931da36da/data/demo/README.md).

The source evaluation reports the model version and inputs that produced its measurements. Later reply-semantic changes are not covered by those historical accuracy or review-rate figures. Synthetic evidence does not establish real-bank accuracy, production readiness or measured staff-time savings.
