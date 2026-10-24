# STEP 8 independent production verification

Checked on **25 October 2026, approximately 03:30 MYT** against source commit **`c4386784c9b5dacf44cc97e57a0c731931da36da`**, using **Node.js 24.19.0**.

The application was copied from the tracked source into a new isolated directory. Dependencies were installed independently; no existing `node_modules`, private `.env`, shared local database or hosted ledger was reused. All application writes used synthetic data in the isolated SQLite database. `DEEPSEEK_API_KEY` was explicitly empty, and no paid model request or live-service write was performed.

## Clean setup

The following commands completed successfully in the new copy:

```bash
npm ci
npm ci --prefix web
npm ci --prefix contracts
cp .env.example .env
npm run db:init
npm run build
npm run test:deployment
```

All three dependency installations exited successfully. npm reported zero known vulnerabilities at installation time, which is a point-in-time package-audit result, not a security guarantee. It also warned about unapproved optional install scripts for the Tesseract package's OpenCollective postinstall and macOS `fsevents`; those warnings did not prevent installation or the production build.

The real production server was launched using the Node command behind `start:production`, with `NODE_ENV=production`, a loopback host, an unused port, an absolute SQLite path, and an explicitly empty model key:

```bash
NODE_ENV=production node --experimental-strip-types \
  --env-file-if-exists=.env src/server.ts
```

## Full regression and type checks

The same independently installed source copy was checked again on **25 October 2026, approximately 03:38 MYT**, with the model key still empty. The subprocess `PATH` selected Node.js **24.19.0**. These commands all exited with code zero:

| Command | Observed result |
| --- | --- |
| `npm test` | **60 backend tests passed, 0 failed**. |
| `npm run test:web` | **23 frontend tests passed across 5 test files**. |
| `npm run check` | Backend TypeScript check passed. |
| `npm --prefix web run check` | Frontend TypeScript check passed. |
| `npm --prefix contracts run check` | Contract TypeScript check and **13 contract/data validation groups passed**. |

The four deployment integration scenarios below are part of the 60-test backend suite; they must not be added again when reporting a unique automated-test total. The nine independent process checks are additional scripted assertions. Contract groups and type checks are reported separately. Playwright/E2E scenarios and real-provider evaluation were not rerun in this regression pass.

## Results

**Thirteen checks passed: four existing deployment integration scenarios and nine independent checks of a real production process.** These are separate scopes, not a model-accuracy score or a replacement for the full application test suite.

| # | Scope | Check and observed result |
| --- | --- | --- |
| 1 | Deployment integration | One listener served frontend routes, JavaScript and JSON API responses with the correct content types. |
| 2 | Deployment integration | Missing assets, private paths, traversal attempts and API failures returned errors rather than a successful frontend shell. |
| 3 | Deployment integration | A persistent database survived application restart while a missing model key retained an audited manual-recovery path. |
| 4 | Deployment integration | Production configuration rejected a missing frontend build before opening a database. |
| 5 | Real production process | The actual Vite build, its JavaScript asset, `/health` and the workspace API loaded from one origin. SQLite was ready and the initial invoice had RM0 paid and RM18,000 outstanding. |
| 6 | Real production process | Four authenticated missing/private routes returned JSON `404 NOT_FOUND`; an unauthenticated workspace request returned `401`. No error was disguised as the frontend shell. |
| 7 | Real production process | Generating a reminder without a model key returned a usable draft with `generationMode: fallback_template`. It was not counted as a successful AI generation. |
| 8 | Real production process | Reply extraction returned `manual_required` with `MODEL_NOT_CONFIGURED`. Correcting the synthetic reply produced a ready extraction with `source: manual`. |
| 9 | Real production process | The bundled partial-payment image returned `manual_required`. Audited field correction and deterministic bank matching produced a pending partial match. Paid cash remained RM0 until explicit approval. |
| 10 | Real production process | A Project Manager payment-approval attempt returned `403 FORBIDDEN`; a stale Finance request returned `409 VERSION_CONFLICT`. Neither request created a payment. |
| 11 | Real production process | Finance approval recorded RM9,000 and retained RM9,000 outstanding. Replaying the same idempotency key returned the same payment, leaving exactly one payment record. |
| 12 | Real production process | After graceful shutdown, `db:init` was run again and a new production process was started. The complete workspace response matched exactly, including the payment, manual correction and reminder. The retained uploaded image had the same SHA-256 before and after restart. |
| 13 | Real production process | A missing frontend build and an invalid `PORT` each caused an explicit non-zero startup exit. The build directory was restored after the isolated negative check. |

The preserved partial-receipt SHA-256 was:

```text
98e0a0e218e4a8abcb99692342305abdf221c3ed12a1eb13224cc9b4b54142ef
```

An initial assertion in the independent harness incorrectly expected `404` for an unauthenticated unknown API request. It was corrected to supply an identity for the missing-route check and to test the expected unauthenticated `401` separately. No application code was changed to make this check pass.

## Separate browser-visible no-key check

A CUA browser pass against the same retained local production process verified an English RM9,000 reminder visibly labelled **Template**. A new reply promising RM9,000 on 28 October showed **MODEL_NOT_CONFIGURED** and the manual-entry path. Finance entered the promise intent, RM9,000 amount and 28 October date, and the saved correction showed a manual-review stamp. The invoice remained **RM9,000 paid / RM9,000 outstanding**. No reminder was sent and no promise was confirmed in this browser pass.

Browser evidence: [no-key manual-entry screenshot](../../submission/validation/step8/no-key-manual-ui.png). This observation supplements the API checks; it does not claim that every screen or the complete friend-test journey was repeated in the no-key environment.

## Evidence boundaries

- The restart result proves persistence across local production-process shutdown/start and repeated database initialisation using the same SQLite file. It does **not** prove Replit filesystem durability across redeployment, replacement, pause/resume or infrastructure failure. The earlier hosted reset remains a documented limitation.
- The nine independent process checks observed HTTP responses and persisted records. The separate browser pass above covers the specified visible template/manual-entry path; API evidence alone is not a visual acceptance result for other screens.
- The missing-key run demonstrates explicit fallback and manual-plus-rules functionality. It does not measure live DeepSeek or OCR accuracy, latency, or success rate.
- Authentication remained the project's synthetic demo-identity mechanism. The checks do not establish production authentication or authorisation for real financial records.
- No shared checkout was edited, no hosted application was reset or deployed, and no real financial or customer data was used.

Existing test sources: [`tests/integration/deployment.test.ts`](../../tests/integration/deployment.test.ts). Earlier hosted limitations: [`HOSTED-VERIFICATION.md`](HOSTED-VERIFICATION.md).
