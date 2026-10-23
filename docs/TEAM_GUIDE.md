# Working together on Proof-to-Cash

We use one repository: [jake2ace/SDC-Tracker](https://github.com/jake2ace/SDC-Tracker). The frontend and all seventeen API operations are connected. Local technical evidence is in the [STEP-7 integration report](evaluation/STEP7-INTEGRATION.md); the manual timing comparison and independent member review were skipped at the project owner's request. Deployment and submission preparation are the current work.

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

For example: “I would like to record the English product demonstration for #24. I will rehearse the script in `submission/PITCH_SCRIPT.md`, use the synthetic demonstration assets and add the final public video link after the team confirms the recording.”

An available task is not an assignment until someone actually claims it. Work is divided into project coordination, frontend design and development, backend development, testing, and documentation. Frontend work belongs in `web/`; backend work belongs in `src/`. Coordinate shared contracts and root dependencies with the backend task owner and project coordinator before changing them.

## 3. Work on a separate branch and open a PR

Create a branch from the latest `main`, using a name that describes your actual task:

```bash
git switch -c work/issue-24-demo-recording
```

Keep the change focused. Commit only the files you intend to share, push your branch and open a pull request targeting `main`. Link the issue with `Refs #24` (replace the number as appropriate), explain what changed and include what you checked. Use `Closes #24` only when the PR completes the entire issue's acceptance criteria.

Use a focused PR with relevant validation evidence. Keep incomplete work marked as in progress and record actual reviews only when they happen. The manual timing study and independent member review in #23 were explicitly skipped; do not report them as completed experiments.

## Useful work you can start now

| Contribution | Where to coordinate | A useful deliverable |
| --- | --- | --- |
| Deployment and access | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | Run the application in the team's Replit project, confirm persistence and record the actual project and deployment links |
| Team and declaration details | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | Confirm registered names, real contributions, workshop completion and third-party tool use; captain reviews and signs the final declaration |
| English demo recording | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | Record a 5–7 minute product demonstration with synthetic data and verify the final Public YouTube link |
| Documentation and demo preparation | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | Product explanation, submission checklist, slide outline or demo script that distinguishes planned and working features |
| Frontend usability review | [#19](https://github.com/jake2ace/SDC-Tracker/issues/19), [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | Check the connected workflow, narrow-screen layout and language switching; report concrete problems with reproducible steps |

You do not need to code to prepare cases, check calculations, review test evidence or help explain the product. Draft cases can begin now; machine-readable fixtures must follow the agreed contract. Record only work actually performed and results actually observed.

Use synthetic business data only. Keep credentials, local backups, databases and private evidence out of commits. Product UI and submission materials use English; team discussion can use Chinese. Record actual tool and AI assistance truthfully. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the shared working rules.
