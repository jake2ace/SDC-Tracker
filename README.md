# SDC Tracker

**Project delivery → automated invoicing → AI-assisted collections → a 30-day cash-flow forecast.**

SDC Hackathon 2026 · Domain 2 · Team Lets go

The shared story, data, API types, and acceptance examples from Issue #1 are the source of truth. Issue #2 adds a local backend foundation: SQLite persistence, explicit demo identities, company isolation, invoice approval guards, and activity logs. The frontend is owned by another teammate and is not included in this backend implementation.

## Preliminary-round product goals

| Feature | Intended result |
|---|---|
| Automated invoicing | Generate a correct invoice draft when a project milestone is completed; simulate issuing it only after human approval and retain the result. |
| AI-assisted collections | Identify overdue balances, generate an editable reminder, simulate sending it after human confirmation, and stop reminders after payment. |
| Cash-flow forecast | Show the next 30 days of expected balances, compare on-time and delayed receipts, and identify dates and amounts below the safety line. |

These features must share data and support one complete demonstration. Use team-created synthetic data and simulated external integrations while implementing the actual business rules. These are the full product goals; the current backend foundation does not implement all three features.

## Documentation and shared contracts

- [Acceptance criteria](docs/ACCEPTANCE.md)
- [Issue #1 story, data, and API agreement](docs/DATA_CONTRACT.md)
- [Story and acceptance PDF, originally named Milestone2Cash](docs/Milestone2Cash_初赛故事与完成标准.pdf)
- [GitHub project workflow](docs/WORKFLOW.md)
- [Backend setup and implemented endpoints](docs/BACKEND.md)
- [Frontend and business-feature handoff](docs/BACKEND_HANDOFF.md)
- [Shared domain types](contracts/domain.ts) and [API types](contracts/api.ts)
- [Synthetic seed](data/demo.json) and [expected results](data/expected-results.json)

The existing Issue #1 documents and contracts retain their original content. New backend documentation and API messages are in English.

## Run the backend

Requirements: **Node.js 22.13 or later**. No third-party runtime packages or dependency installation are required. SQLite uses Node's built-in `node:sqlite` module; supported Node versions may print an experimental-feature warning.

```sh
npm start
```

The service listens on `http://127.0.0.1:3000` by default. `GET /health` exposes service metadata. Demo APIs are disabled by default, and `/` does not serve a webpage.

For local integration with the synthetic demo:

```sh
DEMO_MODE=true npm start
```

Then use an explicit synthetic identity:

```sh
curl -H 'X-Demo-User: u_lumen_pm' \
  http://127.0.0.1:3000/api/demo/session
```

Data is persisted in `.local/sdc-tracker.sqlite`, which is not committed. Environment files are not loaded automatically. See [backend setup](docs/BACKEND.md) for environment variables, CORS, reset behavior, and API examples.

## Business modules available for integration

The invoicing service and route adapter from Issue #3, and the DeepSeek collections service and route adapter from Issue #4, are present in this repository. Their HTTP routes are not mounted by this backend foundation yet; the endpoint coverage in [BACKEND.md](docs/BACKEND.md) remains the current server contract.

- [Invoicing setup and integration](docs/INVOICING.md)
- [Collections setup and integration](docs/COLLECTIONS.md)
- [Standalone invoicing example](examples/invoicing-demo.mjs)
- [Standalone collections example](examples/collections-demo.mjs)

The standalone collections example needs a locally configured `DEEPSEEK_API_KEY` and may call the model. Automated tests use model substitutes. Do not commit `.env` or a real API key. The shared HTTP server, frontend, and business services still require integration before the full product can be demonstrated.

## Validate

```sh
npm test
```

The test suite includes the shared-contract checks and backend checks. Passing these checks does not establish that the remaining business features, real AI, a frontend, or a deployed application are complete.

## Development order

1. Agree on the demonstration story, fields, and API contract.
2. Integrate the independently developed frontend with the backend persistence, permissions, approvals, and logs.
3. Mount the existing invoicing and collections route adapters, then connect the cash-flow forecast against the shared contracts.
4. Verify the acceptance criteria and repeat the checks against the deployed environment.
5. Prepare submission materials and check every link and reproduction instruction.

Track tasks in Issues and the project board. Review local changes before publishing them. **Ask the repository owner before pushing commits or creating a pull request.** Issue #2 requires another team member's review before it is closed.

## Delivery and disclosure

Prepare the working prototype, public GitHub repository and README, official PRD, pitch deck, Technical & Tools Declaration, and 5–7-minute pitch/demo video. Verify the current official format and deadline before submission. Keep the development repository private until the team is ready to publish the submission version under the rules.

Record actual use of AI development tools, runtime models, third-party code, and services. Collect Replit evidence and RunPod evidence where applicable. This backend does not claim real AI integration, Replit deployment, or a connection to a live Orbyte system.

References: [Official Domain 2 brief](https://drive.google.com/file/d/11wqbeO-HYep-DJPQ-LPZnrZfQvCgr5BU/view) · [Participant Handbook](https://drive.google.com/file/d/1fGBS-jevDj_FrF8wsbYNPzyU5TTrfk1V/view)

Code is licensed under Apache-2.0. Third-party material retains its own license and attribution.
