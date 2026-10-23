# Working together on Proof-to-Cash

We use one repository: [jake2ace/SDC-Tracker](https://github.com/jake2ace/SDC-Tracker). The frontend and all seventeen API operations are connected. Local technical evidence is in the [STEP-7 integration report](evaluation/STEP7-INTEGRATION.md); ten manual workflow timings, member review, deployment and submission work remain.

## 1. Get repository access and the latest files

Accept the GitHub collaborator invitation if you have received one. If you cannot find it or cannot access the repository, tell the team lead your GitHub username. This guide does not confirm anyone's invitation or access status.

For a new local checkout:

```bash
git clone https://github.com/jake2ace/SDC-Tracker.git
cd SDC-Tracker
```

If you already have a checkout, save your local changes on your own branch first. Then update the shared baseline:

```bash
git switch main
git pull --ff-only origin main
```

Read [the product specification](PRODUCT_SPEC.md), [the issue plan](ISSUE_PLAN.md) and the issue you want to help with. Use Node.js 24 LTS and start the local API from the repository root:

```bash
npm ci
npm ci --prefix web
test -f .env || cp .env.example .env
npm run db:init
npm start
```

In a second terminal at the repository root, run `npm run dev:web` and open `http://localhost:5173`. The UI uses the real local API by default. Add `?source=mock` and reload only for fixed fixture scenarios. Preserve any existing `.env`; `DEEPSEEK_API_KEY` belongs only there, with `DEEPSEEK_MODEL=deepseek-flash`, never in frontend variables or commits.

Use `npm run test:web`, `npm run test:e2e` and `npm run build` for frontend unit tests, separate browser integration tests and the production build. Server tests run with `npm test`. For a fresh Playwright setup, install Chromium once with `npx playwright install chromium`.

## 2. Claim a concrete task in its issue

Comment on the relevant [GitHub issue](https://github.com/jake2ace/SDC-Tracker/issues) before starting. State what you will deliver, the files you expect to change and any dependency. Check for existing work so two people do not edit the same files.

For example: “I would like to perform the ten manual workflow timings for #23, record the observed steps and outcomes, and compare them with the existing automated run. I will add my observations under `docs/evaluation/`.”

An available task is not an assignment until someone actually claims it. Work is divided into project coordination, frontend design and development, backend development, testing, and documentation. Frontend work belongs in `web/`; backend work belongs in `src/`. Coordinate shared contracts and root dependencies with the backend task owner and project coordinator before changing them.

## 3. Work on a separate branch and open a PR

Create a branch from the latest `main`, using a name that describes your actual task:

```bash
git switch -c work/issue-23-manual-timings
```

Keep the change focused. Commit only the files you intend to share, push your branch and open a pull request targeting `main`. Link the issue with `Refs #23` (replace the number as appropriate), explain what changed and include what you checked. Use `Closes #23` only when the PR completes the entire issue's acceptance criteria.

Use a focused PR with relevant validation evidence. Keep incomplete work marked as in progress and record actual reviews only when they happen. Automated checks do not replace the pending member review or manual timings.

## Useful work you can start now

| Contribution | Where to coordinate | A useful deliverable |
| --- | --- | --- |
| Manual workflow measurement | [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | Ten observed timings with steps, outcomes and conditions; do not relabel automated runtime as human effort |
| Independent calculations | [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | Review the existing independent expected balances and forecast calculations; preserve frozen input/gold separation |
| Member review | [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | Personally run the workflow and record actual findings, including any failed or unclear steps |
| Documentation and demo preparation | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | Product explanation, submission checklist, slide outline or demo script that distinguishes planned and working features |
| Frontend usability review | [#19](https://github.com/jake2ace/SDC-Tracker/issues/19), [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | Check the connected workflow, narrow-screen layout and language switching; report concrete problems with reproducible steps |

You do not need to code to prepare cases, check calculations, review test evidence or help explain the product. Draft cases can begin now; machine-readable fixtures must follow the agreed contract. Record only work actually performed and results actually observed.

Use synthetic business data only. Keep credentials, local backups, databases and private evidence out of commits. Product UI and submission materials use English; team discussion can use Chinese. Record actual tool and AI assistance truthfully. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the shared working rules.
