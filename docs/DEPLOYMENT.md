# Deployment and reproducible setup

The Node server can serve the production frontend and all 17 API routes on one port. This is a synthetic, shared demo with selectable roles, not an authenticated production finance service. The browser never receives the DeepSeek key.

**Status on 24 October 2026:** the [Replit project](https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash) is published at [the public demo URL](https://milestone-2-cash-proof-to-cash.replit.app/). The complete public API workflow passed with real DeepSeek calls. See [hosted verification](evaluation/HOSTED-VERIFICATION.md) for observed failures, retries and storage results. This is a resettable shared demo, not durable production financial storage.

Final regression on Node.js 24.19.0 passed: 50 backend tests (including four deployment scenarios), 16 frontend tests, three browser journeys and 13 contract/data validation groups. The independent production-process browser smoke passed once. Build and TypeScript checks passed. These local checks do not establish hosted persistence or availability.

## Clean local setup

Use Node.js 24 LTS; the deployment checks ran on Node.js 24.19.0. From a fresh checkout:

```bash
npm ci --include=dev
npm --prefix web ci --include=dev
cp .env.example .env
npm run build
npm run db:init
npm run start:production
```

Open `http://127.0.0.1:3000`. The page and `/api/*` use the same origin; no Vite server or separate frontend port is required. `/health` must return a JSON success envelope containing `database: "ready"`. Normal page requests use the API; `?source=mock` explicitly selects the separate fixture mode.

The default `.env.example` uses loopback for local work. A hosted service must set `HOST=0.0.0.0`. Run the service from the repository root. The first run initializes a missing database from the synthetic seed; ordinary restarts keep the existing database. `db:init` is non-destructive; `db:reset` replaces demo data and must never be part of a deployment start command.

## Runtime configuration

| Variable | Use |
| --- | --- |
| `NODE_ENV=production` | Set by `npm run start:production`; requires `web/dist/index.html` and defaults the listener to all interfaces if `HOST` is unset. |
| `HOST` | `127.0.0.1` locally; `0.0.0.0` on a host or container. |
| `PORT` | A single integer port; defaults to `3000`. |
| `DB_PATH` | SQLite file path. Defaults to `.local/proof-to-cash.db`; use an absolute path on durable storage for a hosted instance. |
| `DEEPSEEK_API_KEY` | Server-side secret, reused from the existing team configuration. Never set a `VITE_` key variable or commit `.env`. |
| `DEEPSEEK_MODEL` | Existing configured model: `deepseek-flash`. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com`. |
| `DEEPSEEK_TIMEOUT_MS` | Defaults to `10000`. |
| `FRONTEND_ORIGIN` | Leave empty for this same-origin deployment. |

Environment variables set by the host take precedence over the optional local `.env`. The demo keeps its fixed 23 October 2026 MYT ledger clock; a new machine date does not silently change the evaluation data or opening balance.

When the key is absent, reminder drafting returns a visible template draft. Reply/receipt extraction can require manual entry; Finance can correct evidence and continue deterministic matching. A screenshot or a customer claim still cannot create a payment without a matching bank credit and human approval. The production smoke test deliberately runs with an empty key and makes no model request.

## Replit configuration

The checked-in [`.replit`](../.replit) contains the build/start commands and maps local port `3000` to public port `80`. The build installs the root and frontend lockfiles, then creates `web/dist`; the run command starts only the Node process. Select a Node.js 24 environment and verify `node --version` before running the commands. For the workspace's initial run, complete both `npm ci` commands above first.

Replit documents the `.replit` build/run settings and port mapping in its [configuration reference](https://docs.replit.com/features/project-setup/configuration). Its [publishing guide](https://docs.replit.com/learn/projects-and-artifacts/replit-deployments) distinguishes a published snapshot from the editor workspace and advises against relying on the published filesystem for stored data. These sources were checked on 24 October 2026.

Set the existing DeepSeek key in the platform's secret configuration, then verify that the published process receives it. Do not copy a secret into `.replit`, a frontend environment file or the submission material. A static deployment cannot run this backend.

**SQLite hosting boundary:** the current adapter needs one running application instance and a persistent filesystem supporting SQLite locking. Replit's ordinary published filesystem is not a verified durable database location. No Replit-specific database adapter has been implemented. A Replit demo that uses ephemeral storage must be described as resettable; it does not satisfy hosted persistence acceptance. For durable hosting, mount storage and set `DB_PATH` to that mount, or implement and test a managed-database adapter before making a persistence claim.

The actual hosted check confirmed that republishing reset the ledger and removed uploaded receipts. Pause/resume failed to initialize once, so restart persistence is unverified. Republishing the same tested version recovered the service, and a fresh incognito browser confirmed the unpaid seed. Preserve test feedback outside this app and avoid pausing or republishing during a friend's test session.

## Persistent host operation

For a host with a durable directory owned by the application user, run:

```bash
HOST=0.0.0.0 PORT=3000 DB_PATH=/var/lib/proof-to-cash/demo.sqlite npm run start:production
```

Use a process manager to restart this single instance. The SQLite file also stores uploaded receipt bytes, extracted evidence, activity history and idempotency records. Preserve its directory across application releases. To make a file backup, stop the service cleanly first, then copy the database and any remaining `-wal`/`-shm` files together. Do not place that directory inside `web/dist` or serve it as public files.

The frontend handler snapshots only recognized public asset formats from `web/dist` at startup. It ignores hidden files and symbolic links, returns JSON errors for missing assets and API errors, and falls back to the page shell only for extensionless frontend routes. Rebuild and restart after changing the frontend.

## Verification and hosted acceptance

Tests remain separate from application code:

```bash
npm run check
npm run test:deployment
npm run test:deployment:smoke
```

The four deployment integration scenarios cover static/API responses, private-path and traversal rejection, manual recovery without a model key, persistent restart and missing-build rejection. The additional smoke scenario builds the actual frontend, launches `src/server.ts` as a fresh production process, opens Chromium, drafts a visible template reminder without a key, restarts the process and checks that the reminder remains. It also checks that frontend and API requests use one origin and that the page reports no uncaught JavaScript errors. Install the browser with `npx playwright install chromium` if a supported local Chrome is unavailable.

The public-host record covers health, built frontend assets, real AI reminders and extraction, partial/final settlement, forecast updates, CSV deduplication and company isolation. A model output rejected by validation returned the template fallback on the public host. Missing-key recovery was verified locally; it was not simulated by removing the live secret. Storage lifecycle checks and their limits are recorded in [hosted verification](evaluation/HOSTED-VERIFICATION.md).

For a fresh synthetic ledger, the standalone public API check can be run explicitly from the repository root:

```bash
SMOKE_BASE_URL=https://milestone-2-cash-proof-to-cash.replit.app node tests/integration/hosted-smoke.mjs
```

This modifies the shared demo ledger. Coordinate with testers first; it is not a read-only health check. Give friends the [test guide](FRIEND_TEST_GUIDE.zh-CN.md), two synthetic receipt images and the final-credit CSV, and arrange one tester at a time.
