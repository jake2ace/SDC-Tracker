// Frontend checks that run in plain Node, no browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ringgit, ringgitShort, shortDate, longDate, addDaysIso, daysBetween } from '../web/js/format.js';
import { createApi, ApiFailure, forecastQuery } from '../web/js/api.js';
import { createStore, forecastKey, comparableForecasts } from '../web/js/state.js';
import { createWebServer, parseApiBase } from '../web/server.mjs';
import { createApplication } from '../src/server.mjs';

const webDir = new URL('../web/', import.meta.url);
const seed = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));

test('ringgit formats integer sen without floating point', () => {
  assert.equal(ringgit(1800000), 'RM18,000');
  assert.equal(ringgit(-500000), 'RM−5,000');
  assert.equal(ringgit(1350050), 'RM13,500.50');
  assert.equal(ringgit(0), 'RM0');
  assert.equal(ringgit(1800000, { signed: true }), '+RM18,000');
  assert.equal(ringgit(-2500000, { signed: true }), '−RM25,000');
  assert.equal(ringgit(1.5), 'n/a');
  assert.equal(ringgitShort(-1000000), 'RM−10k');
  assert.equal(ringgitShort(2500000), 'RM25k');
});

test('dates are read as calendar dates, not shifted by timezone', () => {
  assert.equal(shortDate('2026-11-05'), '5 Nov');
  assert.equal(shortDate('2026-11-05', 'zh'), '11月5日');
  assert.equal(longDate('2026-10-22'), '22 Oct 2026');
  assert.equal(addDaysIso('2026-11-05', 3), '2026-11-08');
  assert.equal(daysBetween('2026-11-05', '2026-11-08'), 3);
});

test('forecast query only sends delayDays for the late scenario', () => {
  assert.deepEqual(forecastQuery({ mode: 'fixed', scenario: 'on_time', delayDays: 7 }), { mode: 'fixed', scenario: 'on_time' });
  assert.deepEqual(forecastQuery({ mode: 'rolling', scenario: 'late', delayDays: 'beyond_window' }),
    { mode: 'rolling', scenario: 'late', delayDays: 'beyond_window' });
});

function fakeResponse(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('api client sends X-Demo-User on every call and JSON only when there is a body', async () => {
  const calls = [];
  const api = createApi({
    baseUrl: 'http://127.0.0.1:3000',
    getUser: () => 'u_lumen_fin',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return fakeResponse(200, { ok: true }); },
  });
  await api.issue('inv 1/x');
  await api.recordPayment('inv_7', '2026-11-08');
  await api.forecast({ mode: 'fixed', scenario: 'late', delayDays: 14 });
  assert.equal(calls[0].url, 'http://127.0.0.1:3000/api/invoices/inv%201%2Fx/issue');
  assert.equal(calls[0].init.headers['X-Demo-User'], 'u_lumen_fin');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers['Content-Type'], undefined);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[1].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].init.body), { receivedAt: '2026-11-08' });
  assert.equal(calls[2].url, 'http://127.0.0.1:3000/api/forecast?mode=fixed&scenario=late&delayDays=14');
});

test('api client turns backend errors into ApiFailure with the request id', async () => {
  const api = createApi({
    baseUrl: 'http://127.0.0.1:3000', getUser: () => 'u_lumen_pm',
    fetchImpl: async () => fakeResponse(403, { error: { code: 'FORBIDDEN', message: 'nope', details: { requestId: 'req-1' } } }),
  });
  await assert.rejects(api.approve('inv_1'), err => err instanceof ApiFailure && err.code === 'FORBIDDEN' && err.status === 403 && err.requestId === 'req-1');

  const down = createApi({ baseUrl: 'http://127.0.0.1:3000', getUser: () => 'u', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(down.session(), err => err.code === 'NETWORK' && err.network === true);

  const odd = createApi({ baseUrl: 'http://127.0.0.1:3000', getUser: () => 'u', fetchImpl: async () => fakeResponse(502, '<html>bad gateway</html>', { 'x-request-id': 'r9' }) });
  await assert.rejects(odd.session(), err => err.code === 'HTTP_502' && err.requestId === 'r9');

  const nobody = createApi({ baseUrl: 'http://127.0.0.1:3000', getUser: () => null, fetchImpl: async () => fakeResponse(200, {}) });
  await assert.rejects(nobody.session(), err => err.code === 'UNAUTHENTICATED');
});

// A fake backend where each call can be held and released by the test.
function controllableApi() {
  const pending = [];
  const respond = (name, args, opts) => new Promise((resolve, reject) => {
    const entry = { name, args, resolve, reject, user: opts?.as };
    opts?.signal?.addEventListener('abort', () => reject(new ApiFailure({ code: 'ABORTED', aborted: true })));
    pending.push(entry);
  });
  const names = ['session', 'updateSettings', 'reset', 'projects', 'invoices', 'invoice', 'completeMilestone', 'approve', 'reject',
    'issue', 'collections', 'generateReminder', 'editReminder', 'sendReminder', 'recordPayment', 'overview', 'forecast', 'activity'];
  const api = {};
  for (const name of names) api[name] = (...args) => respond(name, args, args.at(-1));
  return { api, pending };
}

const lumenSession = { settings: { demoDate: '2026-10-22', failNext: { accounting: false, outbox: false } }, user: { id: 'u_lumen_fin', role: 'finance', companyId: 'co_lumen' },
  company: { id: 'co_lumen' }, companies: [{ id: 'co_lumen' }, { id: 'co_rantau' }],
  users: [{ id: 'u_lumen_fin', role: 'finance', companyId: 'co_lumen' }, { id: 'u_rantau_fin', role: 'finance', companyId: 'co_rantau' }] };

test('a slow answer for the old company is dropped after a company switch', async () => {
  const { api, pending } = controllableApi();
  const store = createStore({ api, storage: { getItem: () => 'u_lumen_fin', setItem() {} } });
  const booting = store.boot();
  pending.shift().resolve(lumenSession);
  await new Promise(r => setTimeout(r, 0));
  const slowProjects = pending.find(p => p.name === 'projects');
  assert.ok(slowProjects, 'projects requested after boot');

  const switching = store.switchUser('u_rantau_fin');
  const put = pending.find(p => p.name === 'updateSettings');
  assert.deepEqual(put.args[0], { companyId: 'co_rantau', userId: 'u_rantau_fin' });
  assert.equal(put.user, 'u_lumen_fin', 'settings change is sent as the current user');
  put.resolve({ settings: {} });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(store.state.userId, 'u_rantau_fin');
  assert.equal(store.state.projects.data, null, 'old company data cleared at once');

  // The Lumen response arrives late. It must not appear.
  slowProjects.resolve({ projects: [{ id: 'pr_kopitiga_store' }] });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(store.state.projects.data, null);

  // Answer every Rantau request until the switch completes.
  const rantauSession = { ...lumenSession, user: { id: 'u_rantau_fin', role: 'finance', companyId: 'co_rantau' }, company: { id: 'co_rantau' } };
  let finished = false;
  switching.then(() => { finished = true; });
  while (!finished) {
    for (const p of pending.splice(0)) {
      if (p === slowProjects) continue;
      p.resolve(p.name === 'session' ? rantauSession : p.name === 'projects' ? { projects: [{ id: 'pr_bayu_dinner' }] } : {});
    }
    await new Promise(r => setTimeout(r, 0));
  }
  await booting;
  assert.equal(store.state.projects.data.projects[0].id, 'pr_bayu_dinner');
});

test('overlapping refreshes of one slice keep only the newest answer', async () => {
  const { api, pending } = controllableApi();
  const store = createStore({ api, storage: null });
  const boot = store.boot();
  pending.shift().resolve({ ...lumenSession, user: { ...lumenSession.user } });
  await new Promise(r => setTimeout(r, 0));
  const firstOverview = pending.find(p => p.name === 'overview');
  store.refreshAll();
  const secondOverview = pending.filter(p => p.name === 'overview').at(-1);
  assert.notEqual(firstOverview, secondOverview);
  secondOverview.resolve({ unpaidAmount: 2 });
  await new Promise(r => setTimeout(r, 0));
  firstOverview.resolve({ unpaidAmount: 1 });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(store.state.overview.data.unpaidAmount, 2);
  for (const p of pending) p.resolve({});
  await boot;
});

test('an action keeps its button busy until the refresh is done, and failures never look like success', async () => {
  const { api, pending } = controllableApi();
  const store = createStore({ api, storage: null });
  const boot = store.boot();
  pending.shift().resolve(lumenSession);
  await new Promise(r => setTimeout(r, 0));
  for (const p of pending.splice(0)) p.resolve({});
  await boot;

  const run = store.actions.issue('inv_101');
  const again = store.actions.issue('inv_101');
  assert.equal(await again, null, 'second click while busy does nothing');
  assert.equal(pending.filter(p => p.name === 'issue').length, 1, 'only one issue request goes out');
  pending.find(p => p.name === 'issue').reject(new ApiFailure({ status: 502, code: 'UPSTREAM_FAILED', message: 'mock failed' }));
  await new Promise(r => setTimeout(r, 0));
  assert.ok(store.state.busy.has('issue:inv_101'), 'still busy while refreshing');
  for (const p of pending.splice(0)) p.resolve({});
  await run;
  assert.ok(!store.state.busy.has('issue:inv_101'));
  const flash = store.state.flash.get('inv:inv_101');
  assert.equal(flash.kind, 'bad');
  assert.equal(flash.error.code, 'UPSTREAM_FAILED');
});

test('forecast keys separate mode, scenario and delay', () => {
  assert.equal(forecastKey('fixed', 'on_time', '7'), 'fixed|on_time');
  assert.equal(forecastKey('rolling', 'late', 'beyond_window'), 'rolling|late|beyond_window');
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

function forecastResult(baseDate = '2026-10-22', revision = 1) {
  return { baseDate, endDate: addDaysIso(baseDate, 29), openingBalance: 2000000, safetyLine: 500000, revision,
    lines: [], days: Array.from({ length: 30 }, (_, i) => ({ date: addDaysIso(baseDate, i), balance: 2000000 })) };
}

async function readyStore() {
  let store;
  const users = [...lumenSession.users, { id: 'u_lumen_pm', role: 'pm', companyId: 'co_lumen' }];
  const api = {
    session: async () => {
      const user = users.find(person => person.id === store.state.userId);
      return { ...lumenSession, users, user, company: { id: user.companyId } };
    },
    updateSettings: async () => ({}),
    projects: async () => ({}), invoices: async () => ({}), overview: async () => ({}),
    activity: async () => ({}), collections: async () => ({}),
    forecast: async ({ mode }) => forecastResult(mode === 'rolling' ? '2026-10-29' : '2026-10-22'),
  };
  store = createStore({ api, storage: { getItem: () => 'u_lumen_fin', setItem() {} } });
  await store.boot();
  return { store, api };
}

test('switching identities releases old actions without a late response clearing a newer action', async t => {
  for (const target of ['u_lumen_pm', 'u_rantau_fin']) {
    for (const outcome of ['resolve', 'abort']) {
      await t.test(`${target}: old request ${outcome}`, async () => {
        const { store, api } = await readyStore();
        const requests = [];
        // Simulate a transport that settles only later, even after cancellation.
        api.issue = (id, options) => {
          const request = { ...deferred(), id, options };
          requests.push(request);
          return request.promise;
        };
        const oldRun = store.actions.issue('inv_101');
        assert.ok(store.state.busy.has('issue:inv_101'));
        await store.switchUser(target);
        assert.ok(requests[0].options.signal.aborted);
        assert.equal(store.state.busy.has('issue:inv_101'), false, 'switch releases the old busy flag immediately');
        await store.switchUser('u_lumen_fin');
        const newRun = store.actions.issue('inv_101');
        assert.equal(requests.length, 2, 'returning to the original identity allows a fresh request');
        if (outcome === 'resolve') requests[0].resolve({ invoice: { id: 'old' } });
        else requests[0].reject(new ApiFailure({ code: 'ABORTED', aborted: true }));
        assert.equal(await oldRun, null);
        assert.ok(store.state.busy.has('issue:inv_101'), 'late old cleanup does not unlock the new request');
        assert.equal(store.state.flash.has('inv:inv_101'), false, 'old outcome cannot appear as current success');
        requests[1].resolve({ invoice: { id: 'current' } });
        await newRun;
        assert.equal(store.state.busy.has('issue:inv_101'), false);
        assert.equal(store.state.flash.get('inv:inv_101').data.invoice.id, 'current');
      });
    }
  }
});

test('an aborted action in the current identity always releases its busy flag', async () => {
  const { store, api } = await readyStore();
  const request = deferred();
  api.issue = () => request.promise;
  const run = store.actions.issue('inv_101');
  request.reject(new ApiFailure({ code: 'ABORTED', aborted: true }));
  assert.equal(await run, null);
  assert.equal(store.state.busy.has('issue:inv_101'), false);
  assert.equal(store.state.flash.has('inv:inv_101'), false);
});

test('a partial forecast refresh or failure never publishes half of a new comparison', async () => {
  const { store, api } = await readyStore();
  store.state.ui.cf.mode = 'rolling';
  await store.ensureForecasts();
  const onTime = store.forecastSlice(forecastKey('rolling', 'on_time'));
  const late = store.forecastSlice(forecastKey('rolling', 'late', 'beyond_window'));
  const oldA = onTime.data, oldB = late.data, oldSnapshot = onTime.snapshot;
  assert.equal(comparableForecasts(onTime, late), true);
  const requests = [];
  api.forecast = params => {
    const request = { ...deferred(), params };
    requests.push(request);
    return request.promise;
  };
  const observed = [];
  store.subscribe(() => observed.push([onTime.data, late.data, onTime.snapshot, late.snapshot]));
  const refreshing = store.refreshAll();
  const fast = requests.find(({ params }) => params.mode === 'rolling' && params.scenario === 'on_time');
  fast.resolve(forecastResult('2026-11-08', 2));
  await nextTurn();
  assert.equal(onTime.data, oldA, 'a fast curve is held until its comparison finishes');
  assert.equal(late.data, oldB);
  const failure = new ApiFailure({ code: 'NETWORK', message: 'offline', network: true });
  for (const request of requests.splice(0)) {
    if (request.params.mode === 'rolling' && request.params.scenario === 'late') request.reject(failure);
    else request.resolve(forecastResult('2026-10-22', 2));
  }
  await refreshing;
  assert.equal(onTime.data, oldA);
  assert.equal(late.data, oldB);
  assert.equal(onTime.status, 'error');
  assert.equal(late.error, failure);
  assert.equal(comparableForecasts(onTime, late), true, 'the complete old comparison remains usable with the stale warning');
  assert.equal(onTime.snapshot, oldSnapshot);

  const retry = store.refreshAll();
  for (const request of requests.splice(0)) request.resolve(forecastResult(request.params.mode === 'rolling' ? '2026-11-08' : '2026-10-22', 3));
  await retry;
  assert.equal(onTime.status, 'ready');
  assert.equal(late.status, 'ready');
  assert.equal(onTime.data.baseDate, '2026-11-08');
  assert.equal(late.data.baseDate, '2026-11-08');
  assert.notEqual(onTime.snapshot, oldSnapshot);
  assert.equal(comparableForecasts(onTime, late), true);
  assert.ok(observed.every(([a, b, av, bv]) => a.revision === b.revision && av === bv), 'no subscriber sees a mixed comparison');
});

test('newer forecast refresh wins and same-date results still publish together', async () => {
  const { store, api } = await readyStore();
  const onTime = store.forecastSlice(forecastKey('fixed', 'on_time'));
  const late = store.forecastSlice(forecastKey('fixed', 'late', 'beyond_window'));
  const requests = [];
  api.forecast = params => {
    const request = { ...deferred(), params };
    requests.push(request);
    return request.promise;
  };
  const older = store.refreshAll();
  const first = requests.splice(0);
  const newer = store.refreshAll();
  const second = requests.splice(0);
  second[0].resolve(forecastResult('2026-10-22', 3));
  await nextTurn();
  assert.equal(onTime.data.revision, 1);
  assert.equal(late.data.revision, 1);
  for (const request of second) request.resolve(forecastResult('2026-10-22', 3));
  await newer;
  for (const request of first) request.resolve(forecastResult('2026-10-22', 2));
  await older;
  assert.equal(onTime.data.revision, 3);
  assert.equal(late.data.revision, 3);
  assert.equal(comparableForecasts(onTime, late), true);
});

test('forecast comparison rejects unequal versions, windows, day alignment and starting facts', () => {
  const a = { snapshot: 1, data: forecastResult() };
  assert.equal(comparableForecasts(a, { snapshot: 1, data: forecastResult() }), true);
  assert.equal(comparableForecasts(a, { snapshot: 2, data: forecastResult() }), false);
  assert.equal(comparableForecasts(a, { data: forecastResult() }), false);
  assert.equal(comparableForecasts(a, { snapshot: 1, data: forecastResult('2026-11-08') }), false);
  for (const change of [data => { data.days[3].date = '2026-11-08'; }, data => { data.days.pop(); },
    data => { data.openingBalance += 1; }, data => { data.safetyLine += 1; },
    data => { data.lines.push({ id: 'new_payment', kind: 'actual_receipt', originalDate: '2026-10-22', amount: 100, ref: {} }); }]) {
    const data = forecastResult();
    change(data);
    assert.equal(comparableForecasts(a, { snapshot: 1, data }), false);
  }
});

test('changing forecast scenario refreshes both curves rather than reusing one from another batch', async () => {
  const { store, api } = await readyStore();
  const onTime = store.forecastSlice(forecastKey('fixed', 'on_time'));
  const previous = onTime.data;
  store.state.ui.cf.delay = '7';
  const requests = [];
  api.forecast = params => {
    const request = { ...deferred(), params };
    requests.push(request);
    return request.promise;
  };
  const refreshing = store.ensureForecasts();
  const late = store.forecastSlice(forecastKey('fixed', 'late', '7'));
  assert.ok(requests.some(({ params }) => params.scenario === 'on_time'), 'the comparison baseline is refreshed too');
  const fast = requests.find(({ params }) => params.delayDays === 7);
  fast.resolve(forecastResult('2026-10-22', 2));
  await nextTurn();
  assert.equal(onTime.data, previous);
  assert.equal(late.data, null, 'new scenario is not published alongside an old baseline');
  for (const request of requests) request.resolve(forecastResult('2026-10-22', 2));
  await refreshing;
  assert.equal(comparableForecasts(onTime, late), true);
  assert.equal(onTime.data.revision, 2);
  assert.equal(late.data.revision, 2);
});

test('frontend code never renders HTML strings and holds no secrets', async () => {
  const files = [];
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(m?js|html)$/.test(entry.name)) files.push(full);
    }
  };
  await walk(webDir);
  assert.ok(files.length > 8);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, file.pathname);
    // The e2e helpers run in Node, not in the browser, so only the shipped page code is checked for keys.
    if (!file.pathname.includes('/e2e/')) assert.doesNotMatch(text, /DEEPSEEK|api[_-]?key|\.env['"]/i, file.pathname);
  }
});

test('static server serves the app with a strict CSP and refuses everything else', async t => {
  assert.throws(() => parseApiBase('http://127.0.0.1:3000/api?x=1'));
  assert.equal(parseApiBase('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  const server = createWebServer({ apiBase: 'http://127.0.0.1:3999' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  const csp = home.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src http:\/\/127\.0\.0\.1:3999/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  const config = await (await fetch(base + '/config.js')).text();
  assert.match(config, /"apiBase":"http:\/\/127\.0\.0\.1:3999"/);
  assert.match(config, /"devChinese":false/);
  for (const path of ['/.env', '/../.env', '/%2e%2e/.env', '/server.mjs', '/e2e/walkthrough.mjs', '/data/demo.json', '/js/../../package.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base + '/js/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
});

test('the real backend accepts this frontend origin through CORS and the client reads its contract', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sdc-web-'));
  const origin = 'http://127.0.0.1:5173';
  const app = createApplication({ databasePath: join(directory, 'web.sqlite'), seed: structuredClone(seed), demoMode: true,
    allowedOrigins: [origin], reminderGenerator: async () => { throw new Error('not used'); } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const preflight = await fetch(base + '/api/projects', { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-demo-user' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-Demo-User/);
  const foreign = await fetch(base + '/api/projects', { headers: { Origin: 'http://evil.example', 'X-Demo-User': 'u_lumen_pm' } });
  assert.equal(foreign.status, 403);

  let user = 'u_lumen_pm';
  const api = createApi({ baseUrl: base, getUser: () => user,
    fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: origin } }) });
  const session = await api.session();
  assert.equal(session.company.name, 'Studio Lumen');
  const done = await api.completeMilestone('ms_kt_2');
  assert.equal(done.created, true);
  assert.equal(done.invoice.amount, 1800000);
  await assert.rejects(api.approve(done.invoice.id), err => err.code === 'FORBIDDEN' && typeof err.requestId === 'string');
  user = 'u_lumen_owner';
  assert.equal((await api.approve(done.invoice.id)).invoice.status, 'approved');
  user = 'u_rantau_fin';
  await assert.rejects(api.issue(done.invoice.id), err => err.code === 'NOT_FOUND');
  const fixed = await api.forecast({ mode: 'fixed', scenario: 'late', delayDays: 'beyond_window' });
  assert.equal(fixed.summary.endBalance, -300000);
  const onTime = await api.forecast({ mode: 'fixed', scenario: 'on_time' });
  assert.equal(comparableForecasts({ snapshot: 1, data: onTime }, { snapshot: 1, data: fixed }), true,
    'real backend scenarios have matching source facts despite different expected payment dates');
});
