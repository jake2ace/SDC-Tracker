# Browser integration tests

From the repository root, install root and frontend dependencies, then run:

```sh
npm ci
npm --prefix web ci
npm run test:e2e
```

The suite uses local Google Chrome on macOS when available. Otherwise install
the matching test browser with `npx playwright install chromium` first.

Each scenario creates its own temporary SQLite database and real HTTP backend,
then serves the frontend in API mode through a local Vite proxy. No running
development server, saved demo state, or credentials are needed. The test
process removes inherited `DEEPSEEK_*` variables. OCR and model providers are
deliberately unavailable so the browser can exercise audited manual recovery;
this suite does not claim to evaluate real OCR or DeepSeek accuracy.

Scenarios cover the invoice roles, human-confirmed reminder, original receipt
preview, partial payment, promise, 30-day forecast, final settlement, a lost
response with an idempotent retry, failed post-save refresh, and tenant switching
on a mobile viewport. Assertions stay in this test folder, outside product code.

Results, synthetic screenshots, and failure traces are written beneath
`.local/browser-results/` and are ignored by Git. Live extraction evaluation is
a separate `npm run evaluate:extraction` workflow.
