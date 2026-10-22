import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { createForecastPreviewServer } from '../examples/forecast-server.mjs';

// These are hand-calculated story ledgers, deliberately independent of the
// service and fixture builders. Amounts are sen; only events in the shown
// window belong here. Changing a story requires reviewing these expectations.
const lumenExpenses = [['2026-11-10', -2500000]];
const rantauExpenses = [['2026-10-30', -600000], ['2026-11-15', -900000]];
const lumenUnpaid = {
  on_time: [...lumenExpenses, ['2026-11-05', 1800000]],
  '7': [...lumenExpenses, ['2026-11-12', 1800000]],
  '14': [...lumenExpenses, ['2026-11-19', 1800000]],
  beyond_window: lumenExpenses,
};
const rantauUnpaid = {
  on_time: [...rantauExpenses, ['2026-10-22', 1350000]],
  '7': [...rantauExpenses, ['2026-10-29', 1350000]],
  '14': [...rantauExpenses, ['2026-11-05', 1350000]],
  beyond_window: rantauExpenses,
};
const fixedWindow = { baseDate: '2026-10-22', endDate: '2026-11-20' };
const scenarios = ['on_time', '7', '14', 'beyond_window'];
const repeatLedger = events => Object.fromEntries(scenarios.map(scenario => [scenario, events]));

const stories = [
  { company: 'lumen', case: 'seed', paid: false,
    fixed: { ...fixedWindow, opening: 2000000, events: lumenUnpaid } },
  { company: 'lumen', case: 'lumen_issued', paid: false,
    fixed: { ...fixedWindow, opening: 2000000, events: lumenUnpaid } },
  { company: 'lumen', case: 'lumen_paid', paid: true,
    fixed: { ...fixedWindow, opening: 2000000,
      events: repeatLedger([...lumenExpenses, ['2026-11-08', 1800000]]) },
    rolling: { baseDate: '2026-11-09', endDate: '2026-12-08', opening: 3800000,
      events: repeatLedger(lumenExpenses) } },
  { company: 'rantau', case: 'seed', paid: false,
    fixed: { ...fixedWindow, opening: 1200000, events: rantauUnpaid } },
  { company: 'rantau', case: 'rantau_paid', paid: true,
    fixed: { ...fixedWindow, opening: 1200000,
      events: repeatLedger([...rantauExpenses, ['2026-10-22', 1350000]]) },
    rolling: { baseDate: '2026-11-08', endDate: '2026-12-07', opening: 1950000,
      events: {
        on_time: [['2026-11-15', -900000], ['2026-11-27', 1800000]],
        '7': [['2026-11-15', -900000], ['2026-12-04', 1800000]],
        '14': [['2026-11-15', -900000]],
        beyond_window: [['2026-11-15', -900000]],
      } } },
];

function expectedDays(window, scenario, safetyLine) {
  let balance = window.opening;
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.parse(`${window.baseDate}T00:00:00Z`) + index * 86400000)
      .toISOString().slice(0, 10);
    const movements = window.events[scenario].filter(event => event[0] === date).map(event => event[1]);
    const inflow = movements.filter(amount => amount > 0).reduce((sum, amount) => sum + amount, 0);
    const outflow = movements.filter(amount => amount < 0).reduce((sum, amount) => sum - amount, 0);
    balance += inflow - outflow;
    return { date, inflow, outflow, balance, belowSafety: balance < safetyLine,
      gapToSafety: Math.max(0, safetyLine - balance), shortfallBelowZero: Math.max(0, -balance) };
  });
}

function assertForecast(result, story, mode, scenario) {
  const window = mode === 'rolling' ? story.rolling ?? story.fixed : story.fixed;
  const safetyLine = story.company === 'lumen' ? 1000000 : 800000;
  const days = expectedDays(window, scenario, safetyLine);
  assert.equal(result.baseDate, window.baseDate);
  assert.equal(result.endDate, window.endDate);
  assert.equal(result.openingBalance, window.opening);
  assert.equal(result.safetyLine, safetyLine);
  assert.deepEqual(result.days, days, 'every daily figure must reconcile to the independent story ledger');
  assert.deepEqual(result.scenario, scenario === 'on_time' ? { kind: 'on_time' }
    : { kind: 'late', delayDays: scenario === 'beyond_window' ? scenario : Number(scenario) });
  const minBalance = Math.min(...days.map(day => day.balance));
  const breaches = days.filter(day => day.belowSafety);
  assert.deepEqual(result.summary, {
    endBalance: days.at(-1).balance,
    minBalance,
    minDate: days.find(day => day.balance === minBalance).date,
    firstBreachDate: breaches[0]?.date ?? null,
    breachDays: breaches.length,
    maxGapToSafety: Math.max(...days.map(day => day.gapToSafety)),
    maxShortfallBelowZero: Math.max(...days.map(day => day.shortfallBelowZero)),
  });

  const expectedSources = story.company === 'lumen'
    ? [[story.paid ? 'actual_pay_kt_2' : 'expected_ms_kt_2', 1800000],
      ['expected_ms_kt_3', 2400000], ['expense_ex_lumen_1', -2500000]]
    : [[story.paid ? 'actual_pay_bd_1' : 'expected_ms_bd_1', 1350000],
      ['expected_ms_bd_2', 1800000], ['expected_ms_bd_3', 1350000],
      ['expense_ex_rantau_1', -600000], ['expense_ex_rantau_2', -900000]];
  assert.deepEqual(result.lines.map(line => [line.id, line.amount]).sort(), expectedSources.sort(),
    'show every own-company source exactly once, with no paid invoice also counted as expected');
  const included = result.lines.filter(line => line.included);
  assert.deepEqual(included.map(line => [line.date, line.amount]).sort(), [...window.events[scenario]].sort(),
    'the visible source list must reconcile to the same hand-calculated cash movements');
  for (const line of result.lines) {
    assert.equal(line.kind, line.id.startsWith('actual_') ? 'actual_receipt'
      : line.id.startsWith('expected_') ? 'expected_receipt' : 'expense');
    assert.equal(line.included, line.date >= window.baseDate && line.date <= window.endDate);
  }
}

function getPreview(port, story, mode, scenario) {
  const params = new URLSearchParams({ company: story.company, case: story.case, mode,
    scenario: scenario === 'on_time' ? 'on_time' : 'late' });
  if (scenario !== 'on_time') params.set('delayDays', scenario);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: `/api/preview?${params}`, timeout: 2000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        try {
          assert.equal(res.statusCode, 200, body);
          assert.equal(res.headers['cache-control'], 'no-store');
          resolve(JSON.parse(body));
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Preview request timed out')));
    req.end();
  });
}

test('all 40 UI demo combinations reconcile over real HTTP', async t => {
  const server = await createForecastPreviewServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const visited = [];
  for (const story of stories) {
    for (const mode of ['fixed', 'rolling']) {
      let baseline;
      for (const scenario of scenarios) {
        await t.test(`${story.company}/${story.case}/${mode}/${scenario}`, async () => {
          const body = await getPreview(port, story, mode, scenario);
          assert.equal(body.demo, true);
          assert.equal(body.companyName, story.company === 'lumen' ? 'Studio Lumen' : 'Rantau Events');
          assert.equal(body.overview.companyId, `co_${story.company}`);
          assertForecast(body.forecast, story, mode, scenario);
          assertForecast(body.onTime, story, mode, 'on_time');
          if (!baseline) baseline = body;
          assert.deepEqual(body.onTime, baseline.onTime, 'comparison line never inherits the delayed scenario');
          assert.deepEqual(body.overview, baseline.overview, 'scenario selection never changes factual debt metrics');
          assert.deepEqual(body.forecast.lines.filter(line => line.kind === 'actual_receipt'),
            baseline.forecast.lines.filter(line => line.kind === 'actual_receipt'),
            'actual receipts stay on their real date, including receipts rolled into opening cash');
          for (let index = 0; index < 30; index++) {
            assert.ok(body.forecast.days[index].balance <= body.onTime.days[index].balance,
              'delaying expected income cannot improve any daily cash balance');
          }
          visited.push({ story, mode, scenario, body });
        });
      }
    }
  }
  assert.equal(visited.length, 40);
  // Replay in reverse order so every company, paid state, window and scenario
  // is entered after a different case. No reset route should be necessary.
  for (const { story, mode, scenario, body } of visited.reverse()) {
    assert.deepEqual(await getPreview(port, story, mode, scenario), body,
      `${story.case}/${mode}/${scenario}: selecting another demo must not alter this one`);
  }
});
