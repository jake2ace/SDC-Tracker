# Working together on Proof-to-Cash

We use one repository: [jake2ace/SDC-Tracker](https://github.com/jake2ace/SDC-Tracker). The new baseline is on `main`; the app is not implemented yet. You can contribute before all development is complete.

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

Read [the product specification](PRODUCT_SPEC.md), [the issue plan](ISSUE_PLAN.md) and the issue you want to help with. There is no app startup command yet.

## 2. Claim a concrete task in its issue

Comment on the relevant [GitHub issue](https://github.com/jake2ace/SDC-Tracker/issues) before starting. State what you will deliver, the files you expect to change and any dependency. Check for existing work so two people do not edit the same files.

For example: “I would like to prepare five synthetic partial-payment cases for #17, including inputs and independently calculated expected balances. I will add a draft under `docs/` and confirm the final data format before creating fixtures.”

An available task is not an assignment until someone actually claims it. Work is divided into project coordination, frontend design and development, backend development, testing, and documentation. Frontend work belongs in `web/`; backend work belongs in `src/`. Coordinate shared contracts and root dependencies with the backend task owner and project coordinator before changing them.

## 3. Work on a separate branch and open a PR

Create a branch from the latest `main`, using a name that describes your actual task:

```bash
git switch -c work/issue-17-payment-cases
```

Keep the change focused. Commit only the files you intend to share, push your branch and open a pull request targeting `main`. Link the issue with `Refs #17` (replace the number as appropriate), explain what changed and include what you checked. Use `Closes #17` only when the PR completes the entire issue's acceptance criteria.

Use a focused PR with the relevant validation evidence. Keep incomplete work marked as in progress. The current STEP-1/STEP-2 delivery is authorized to merge after implementation and essential checks without an additional review gate; record actual reviews only when they happen.

## Useful work you can start now

| Contribution | Where to coordinate | A useful deliverable |
| --- | --- | --- |
| Synthetic cases and data | [#17](https://github.com/jake2ace/SDC-Tracker/issues/17) | Fictional receipts, replies and bank entries covering normal, duplicate, mismatched and partial payments; expected results kept separately |
| Independent calculations | [#17](https://github.com/jake2ace/SDC-Tracker/issues/17), [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | Hand-calculated invoice balances and cash forecasts with clear assumptions |
| Test preparation and review | [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | Test scenarios now; actual observations, timings, failures and evidence once the relevant feature runs |
| Documentation and demo preparation | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | Product explanation, submission checklist, slide outline or demo script that distinguishes planned and working features |
| Frontend design | [#19](https://github.com/jake2ace/SDC-Tracker/issues/19) | Use the frozen shared contract, build UI states, and integrate the seven working backend endpoints; keep later endpoints explicitly mocked |

You do not need to code to prepare cases, check calculations, review test evidence or help explain the product. Draft cases can begin now; machine-readable fixtures must follow the agreed contract. Record only work actually performed and results actually observed.

Use synthetic business data only. Keep credentials, local backups, databases and private evidence out of commits. Product UI and submission materials use English; team discussion can use Chinese. Record actual tool and AI assistance truthfully. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the shared working rules.
