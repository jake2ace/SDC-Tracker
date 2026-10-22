// Runs the real backend (same routes, SQLite store, guards) with ONE thing swapped:
// the DeepSeek HTTP transport is replaced by a local stand-in, the same way
// tests/integration.test.mjs does it. Use it for walkthroughs and screenshots on
// machines without a key. It never reads .env and never calls a model provider.
//
//   DB_PATH=/tmp/sdc-walk.sqlite CORS_ORIGINS=http://127.0.0.1:5173 node web/e2e/fake-ai-backend.mjs
import { createApplication } from '../../src/server.mjs';
import { createDeepSeekGenerator } from '../../src/collections/deepseek.mjs';

const OPENING = { gentle: 'gentle_check', firm: 'firm_request', final: 'final_followup' };
let failNextAi = process.env.FAKE_AI_FAIL_FIRST === '1';

const reminderGenerator = createDeepSeekGenerator({
  apiKey: 'fake-ai-walkthrough-only',
  fetchImpl: async (_url, request) => {
    if (failNextAi) {
      failNextAi = false;
      return new Response('{"error":"simulated outage"}', { status: 503, headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(request.body);
    const tone = JSON.parse(body.messages[1].content).tone;
    const pick = { opening: OPENING[tone], request: 'payment_status', closing: 'thanks' };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(pick) } }] }),
      { headers: { 'content-type': 'application/json' } });
  },
});

const app = createApplication({
  demoMode: true,
  databasePath: process.env.DB_PATH || '/tmp/sdc-tracker-walkthrough.sqlite',
  reminderGenerator,
});
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
app.server.listen(port, host, () => console.log(`Backend with FAKE AI transport on http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
