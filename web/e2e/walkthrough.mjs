// Browser walkthrough of the full demo story. Needs Playwright, which is NOT a
// project dependency:  npx playwright install chromium  (or use an existing install)
//
//   node web/e2e/walkthrough.mjs [screenshotDir]
//
// Expects a FRESH backend on 127.0.0.1:3000 (reset is done through the UI) started
// with FAKE_AI_FAIL_FIRST=1 via web/e2e/fake-ai-backend.mjs, and the web server on 5173.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PW = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(PW);
const WEB = process.env.WEB_URL || 'http://127.0.0.1:5173';
const API = process.env.API_BASE || 'http://127.0.0.1:3000';
const out = process.argv[2] || 'walkthrough-shots';
mkdirSync(out, { recursive: true });

const results = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const problems = [];
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|ERR_NAME|Failed to load resource/.test(m.text())) problems.push('console: ' + m.text()); });

const shot = name => page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
const settle = () => page.waitForFunction(() => {
  const s = window.__sdc?.store?.state;
  if (!s || s.busy.size) return false;
  const all = [s.session, s.projects, s.invoices, s.overview, s.activity, ...Object.values(s.collections), ...s.forecasts.values(), ...s.details.values()];
  return all.every(x => x.status !== 'loading');
}, null, { timeout: 15000 }).then(() => page.waitForTimeout(150));
const text = () => page.locator('#app').innerText();
const click = async (name, opts = {}) => { await page.getByRole('button', { name, exact: opts.exact ?? false }).first().click(); await settle(); };

async function step(id, title, fn) {
  try {
    await fn();
    results.push({ id, title, ok: true });
  } catch (err) {
    results.push({ id, title, ok: false, err: String(err.message).split('\n')[0] });
    await shot(`FAIL-${id}`).catch(() => {});
  }
}
async function expectText(...needles) {
  const t = await text();
  for (const n of needles) if (!t.includes(n)) throw new Error(`missing text: ${n}`);
}
async function forecastSummary(params) {
  return page.evaluate(async ({ API, params }) => {
    const q = new URLSearchParams(params).toString();
    const r = await fetch(`${API}/api/forecast?${q}`, { headers: { 'X-Demo-User': window.__sdc.store.state.userId } });
    const j = await r.json();
    return { opening: j.openingBalance, end: j.summary.endBalance, breach: j.summary.firstBreachDate, gap: j.summary.maxGapToSafety };
  }, { API, params });
}

await page.goto(WEB + '/');
await step('A0', 'Landing page first, not a dashboard', async () => {
  await page.getByRole('button', { name: 'Walk through the demo' }).waitFor();
  await shot('00-landing');
});

await step('A1', 'Enter the app on step 1 and reset demo data', async () => {
  await page.getByRole('button', { name: 'Walk through the demo' }).click();
  await settle();
  await page.locator('#reset').click();
  await page.locator('#confirm-ok').click();
  await settle();
  await page.selectOption('#user', 'u_lumen_pm');
  await settle();
  await expectText('Projects & invoicing', 'M2 Design sign-off', 'In progress');
  await shot('01-invoicing-start');
});

await step('B1', 'PM completes M2, draft RM18,000 built from the payment terms', async () => {
  await page.getByRole('row', { name: /M2 Design sign-off/ }).getByRole('button', { name: 'Mark done' }).click();
  await settle();
  await expectText('Draft invoice created.', 'RM18,000', 'Awaiting approval', '30% on design sign-off, due 14 days after invoice date', '5 Nov 2026');
  await shot('02-draft-created');
});

await step('B2', 'Repeating completion returns the same draft', async () => {
  await click('Repeat check: mark the milestone done again');
  await expectText('Same draft returned.');
  const n = await page.evaluate(() => window.__sdc.store.state.invoices.data.invoices.length);
  if (n !== 1) throw new Error(`expected 1 Lumen invoice, got ${n}`);
});

await step('C1', 'PM cannot approve: backend 403 shown, nothing changes', async () => {
  await click('Approve', { exact: true });
  await expectText('Blocked by the backend.', 'Awaiting approval');
  await shot('03-pm-blocked');
});

await step('C2', 'Switch to owner from the error and approve', async () => {
  await click('Switch to Daniel Tan');
  await expectText('Daniel Tan');
  await click('Approve', { exact: true });
  await expectText('Approved.', 'Approved, not issued');
  await shot('04-approved');
});

await step('D1', 'Finance issue fails once (mock accounting), shown as failure', async () => {
  await page.getByRole('button', { name: /Switch to Priya Nair/ }).first().click();
  await settle();
  await page.locator('#fail-accounting').check();
  await settle();
  await click('Issue invoice (simulated)');
  await expectText('The invoice was not issued.');
  const t = await text();
  if (t.includes('Issued (simulated).')) throw new Error('failure shown as success');
  await shot('05-issue-failed');
});

await step('D2', 'Retry issues exactly one invoice SL-2026-0001', async () => {
  await click('Retry issuing (simulated)');
  await expectText('Issued (simulated).', 'SL-2026-0001', 'due 5 Nov');
  await click('Repeat check: issue again');
  await expectText('Same invoice returned.');
  const issued = await page.evaluate(() => window.__sdc.store.state.invoices.data.invoices.filter(i => i.invoiceNo).length);
  if (issued !== 1) throw new Error('expected exactly one issued invoice');
  await shot('06-issued');
});

await step('CF1', 'Lumen fixed case: on time / 7 / 14 days / after window match the forecast table', async () => {
  await page.goto(WEB + '/#/cashflow');
  await settle();
  await click('Paid on time');
  await expectText('RM20,000', 'RM13,000', 'None', 'Stays above the safety line');
  await shot('06b-cashflow-on-time');
  await click('7 days late');
  await expectText('RM13,000', '10 Nov', '2 days under RM10,000');
  await click('14 days late');
  await expectText('RM13,000', '9 days under RM10,000');
  await click('Paid after the window');
  await expectText('RM\u22125,000', '10 Nov', 'RM15,000', 'RM5,000 under zero');
  await shot('06c-cashflow-after-window');
  await page.goto(WEB + '/#/invoicing');
  await settle();
});

await step('E1', 'Move demo date to 8 Nov, invoice shows 3 days overdue', async () => {
  await click('Set demo date to 8 Nov');
  await page.getByRole('button', { name: 'Open AI collections' }).click().catch(() => page.goto(WEB + '/#/collections'));
  await settle();
  await expectText('SL-2026-0001', '3 days late');
});

await step('E2', 'AI unavailable is reported, no fake draft', async () => {
  await click('Draft reminder 1');
  await expectText('No reminder draft was created.');
  await shot('07-ai-unavailable');
});

await step('E3', 'Retry builds a draft that quotes the real facts, nothing sent', async () => {
  await click('Draft reminder 1');
  await expectText('Draft ready.', 'Facts used: SL-2026-0001, RM18,000, due 5 Nov 2026, 3 days late, 0 earlier reminders');
  const body = await page.locator('textarea').inputValue();
  if (!body.includes('RM 18,000.00') && !body.includes('RM18,000')) throw new Error('draft does not quote the amount');
  const sent = await page.evaluate(() => window.__sdc.store.state.collections.overdue.data.items[0].reminders.filter(r => r.status === 'sent').length);
  if (sent !== 0) throw new Error('draft was sent automatically');
  await shot('08-draft-ready');
});

await step('E4', 'Edit the text, save, and confirm dialog appears before sending', async () => {
  const ta = page.locator('textarea');
  await ta.fill((await ta.inputValue()) + '\n\nP.S. Happy to resend the invoice if needed.');
  const sendDisabled = await page.getByRole('button', { name: 'Confirm and send (simulated)' }).isDisabled();
  if (!sendDisabled) throw new Error('send should wait for saved edits');
  await click('Save edits');
  await expectText('Edits saved.');
  await page.locator('#fail-outbox').check();
  await settle();
  await page.getByRole('button', { name: 'Confirm and send (simulated)' }).click();
  await page.locator('#confirm').waitFor({ state: 'visible' });
  await page.getByText('accounts@kopitiga.example').waitFor();
  await shot('09-confirm-dialog');
});

await step('E5', 'Mock outbox failure is visible; retry sends once', async () => {
  await page.locator('#confirm-ok').click();
  await settle();
  await expectText('Nothing was sent.');
  await page.getByRole('button', { name: 'Confirm and send (simulated)' }).click();
  await page.locator('#confirm-ok').click();
  await settle();
  await expectText('Simulated send succeeded.');
  await shot('10-sent');
  await click('Repeat check: send reminder 1 again');
  await expectText('Already sent.');
  const sent = await page.evaluate(() => window.__sdc.store.state.collections.overdue.data.items[0].reminders.filter(r => r.status === 'sent').length);
  if (sent !== 1) throw new Error(`expected 1 sent reminder, got ${sent}`);
});

await step('F1', 'Payment cancels the unsent second draft and stops collection', async () => {
  await click('Draft reminder 2');
  await expectText('Reminder 2');
  await page.getByRole('button', { name: /Record full payment/ }).click();
  await page.locator('#confirm-ok').click();
  await settle();
  await expectText('Payment recorded.', '1 unsent reminder was cancelled');
  await page.getByRole('button', { name: /^Paid/ }).first().click();
  await settle();
  await expectText('Cancelled, invoice paid', 'Paid 1');
  const t = await text();
  if (t.includes('Confirm and send (simulated)')) throw new Error('cancelled reminder still offers send');
  await shot('11-paid');
});

await step('F2', 'Same payment again is not counted twice', async () => {
  await click('Repeat check: record the same payment again');
  await expectText('Same payment returned.', 'Collection has stopped for this invoice.');
});

await step('G1', 'Overview reflects payment (nothing outstanding)', async () => {
  await page.goto(WEB + '/#/overview');
  await settle();
  await expectText('Studio Lumen has no issued invoices waiting for payment.', 'Record payment');
  await shot('12-overview-after-payment');
});

await step('G2', 'Fixed forecast after payment: actual receipt not shifted (end RM13,000 even if late)', async () => {
  await page.goto(WEB + '/#/cashflow');
  await settle();
  await expectText('RM13,000', 'payment received');
  const f = await forecastSummary({ mode: 'fixed', scenario: 'late', delayDays: 'beyond_window' });
  if (f.end !== 1300000) throw new Error('fixed late end should be 1300000, got ' + f.end);
  await shot('13-cashflow-fixed-after-payment');
});

await step('G3', 'Rolling window on 9 Nov carries the receipt into opening RM38,000, end RM13,000', async () => {
  await page.fill('#demo-date', '2026-11-09');
  await page.locator('#demo-date').dispatchEvent('change');
  await settle();
  await click('Rolling from demo date');
  await expectText('RM38,000', 'RM13,000');
  await shot('14-cashflow-rolling');
});

await step('H1', 'Switch to Rantau: old company data cleared, overdue RE-2026-0001 shown', async () => {
  await page.selectOption('#company', 'co_rantau');
  await settle();
  await page.goto(WEB + '/#/collections');
  await settle();
  const t = await text();
  if (t.includes('Kopi Tiga') || t.includes('SL-2026')) throw new Error('Lumen data leaked into Rantau');
  await expectText('Siti Aminah', 'RE-2026-0001', 'Bayu Hotel Group');
  await shot('15-rantau-collections');
});

await step('H2', 'Rantau fixed forecast, paid after window: end RM−3,000, first breach 30 Oct, gap RM11,000', async () => {
  await page.goto(WEB + '/#/cashflow');
  await settle();
  await click('Fixed case');
  await click('Paid after the window');
  await expectText('RM−3,000', '30 Oct', 'RM11,000');
  await shot('16-rantau-cashflow');
});

await step('I1', 'Rantau: PM completes a milestone, owner rejects with a reason', async () => {
  await page.selectOption('#user', 'u_rantau_pm');
  await settle();
  await page.goto(WEB + '/#/invoicing');
  await settle();
  await page.getByRole('row', { name: /Venue setup confirmed/ }).getByRole('button', { name: 'Mark done' }).click();
  await settle();
  await page.selectOption('#user', 'u_rantau_owner');
  await settle();
  await click('Reject', { exact: true });
  await expectText('Write a short reason before rejecting.');
  await page.locator('input.text').first().fill('Venue deposit terms still under discussion');
  await click('Reject', { exact: true });
  await expectText('Rejected.', 'Venue deposit terms still under discussion');
  await shot('17-rejected');
});

await step('I2', 'Rejected draft cannot be issued by finance', async () => {
  const res = await page.evaluate(async API => {
    const s = window.__sdc.store.state;
    const inv = s.invoices.data.invoices.find(i => i.status === 'rejected');
    const r = await fetch(`${API}/api/invoices/${inv.id}/issue`, { method: 'POST', headers: { 'X-Demo-User': 'u_rantau_fin' } });
    return r.status;
  }, API);
  if (res !== 409) throw new Error('expected 409, got ' + res);
});

await step('J1', 'Mobile layout works (375 px)', async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(WEB + '/#/collections');
  await settle();
  await shot('18-mobile-collections');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('horizontal page scroll on mobile');
  await page.setViewportSize({ width: 1360, height: 900 });
});

console.log('\nWalkthrough results');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.title}${r.ok ? '' : `  -> ${r.err}`}`);
if (problems.length) console.log('\nBrowser problems:\n' + problems.join('\n'));
await browser.close();
process.exitCode = results.every(r => r.ok) && !problems.length ? 0 : 1;
