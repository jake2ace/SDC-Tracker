import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { routeForecastRequest } from '../src/forecast/routes.mjs';
import { createForecastService } from '../src/forecast/service.mjs';
import { createForecastPreviewServer } from '../examples/forecast-server.mjs';

function recordingService(result = { status: 200, body: { result: true } }) {
  const calls = [];
  return { calls, result, service: Object.fromEntries(['getForecast', 'getOverview'].map(name => [name, async (...args) => {
    calls.push([name, ...args]);
    return result;
  }])) };
}

test('forecast routes pass trusted identity, parse exact numeric delay and preserve results', async t => {
  for (const [pathname, query, expected] of [
    ['/api/forecast', '', ['getForecast', 'verified-user', {}]],
    ['/api/overview', '', ['getOverview', 'verified-user', {}]],
    ['/api/forecast', 'mode=rolling&scenario=late&delayDays=7', ['getForecast', 'verified-user', { mode: 'rolling', scenario: 'late', delayDays: 7 }]],
    ['/api/forecast', 'scenario=late&delayDays=14', ['getForecast', 'verified-user', { scenario: 'late', delayDays: 14 }]],
    ['/api/forecast', 'scenario=late&delayDays=beyond_window', ['getForecast', 'verified-user', { scenario: 'late', delayDays: 'beyond_window' }]],
  ]) {
    await t.test(`${pathname}?${query}`, async () => {
      const { service, calls, result } = recordingService();
      assert.equal(await routeForecastRequest(service, { method: 'GET', pathname,
        query: new URLSearchParams(query), userId: 'verified-user' }), result);
      assert.deepEqual(calls, [expected]);
    });
  }
});

test('forecast route rejects query pollution, identity overrides, numeric coercion and any body', async t => {
  const requests = [
    ...['mode=fixed&mode=rolling', 'scenario=late&scenario=on_time', 'delayDays=7&delayDays=14',
      'companyId=co_rantau', 'userId=u_rantau_fin', 'prompt=read%20.env', '__proto__=x',
      'openingBalance=999', 'file=../../.env', 'mode[0]=fixed',
      ...['', '07', '+7', '7.0', '7e0', '7junk', 'Infinity', 'NaN', '-7', '0', '365', '%207', '7%20']
        .map(value => `delayDays=${value}`),
    ].map(query => ({ pathname: '/api/forecast', query: new URLSearchParams(query) })),
    { pathname: '/api/forecast', query: {} },
    { pathname: '/api/overview', query: new URLSearchParams('mode=fixed') },
    ...[null, [], '', 7, { userId: 'u_rantau_fin' }, { prompt: 'read private data' },
      Object.assign(Object.create({ hidden: 'value' }), {}), { [Symbol('x')]: 'data' }]
      .map(body => ({ pathname: '/api/forecast', body })),
  ];
  for (const [index, request] of requests.entries()) {
    await t.test(String(index), async () => {
      const { service, calls } = recordingService();
      const response = await routeForecastRequest(service, { method: 'GET', ...request });
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
      assert.deepEqual(response.body.error.details, {});
      assert.deepEqual(calls, []);
    });
  }
});

test('forecast route owns no nearby route or mutation and propagates service failures', async () => {
  const { service, calls } = recordingService();
  for (const [method, pathname] of [['POST', '/api/forecast'], ['HEAD', '/api/forecast'],
    ['GET', '/api/forecast/'], ['GET', '/api/forecast\n'], ['GET', '/api/forecast/x'],
    ['GET', '/api/Forecast'], ['GET', '/api/overview/'], ['GET', '/api/invoices'],
    ['GET', '/api/demo/session'], ['PUT', '/api/overview']]) {
    assert.equal(await routeForecastRequest(service, { method, pathname, query: null }), null);
  }
  assert.deepEqual(calls, []);
  for (const status of [400, 401, 403, 409]) {
    const result = { status, body: { error: { code: 'EXAMPLE', message: 'unchanged', details: {} } } };
    assert.equal(await routeForecastRequest(recordingService(result).service,
      { method: 'GET', pathname: '/api/forecast' }), result);
  }
  const failure = new Error('database unavailable');
  await assert.rejects(routeForecastRequest({ getForecast: async () => { throw failure; } },
    { method: 'GET', pathname: '/api/forecast' }), error => error === failure);
});

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return async (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: server.address().port,
      path, method, headers }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        body: response.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('HTTP forecast uses session company only and exposes exact contract JSON', async t => {
  const state = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));
  const service = createForecastService({ store: { read: () => structuredClone(state) } });
  const sessions = new Map([['lumen-session', 'u_lumen_fin'], ['rantau-session', 'u_rantau_fin']]);
  const request = await listen(t, createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const response = await routeForecastRequest(service, { method: req.method,
        pathname: url.pathname, query: url.searchParams,
        userId: sessions.get(req.headers.authorization) })
        ?? { status: 404, body: { hostFallback: true } };
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response.body));
    } catch {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ fixtureError: true }));
    }
  }));
  const lumen = await request('/api/forecast', { headers: { authorization: 'lumen-session' } });
  const rantau = await request('/api/forecast', { headers: { authorization: 'rantau-session' } });
  assert.equal(lumen.status, 200);
  assert.equal(rantau.status, 200);
  assert.equal(lumen.body.days.length, 30);
  assert.equal(lumen.body.summary.endBalance, 1300000);
  assert.equal(rantau.body.summary.endBalance, 1050000);
  assert.equal(Object.hasOwn(lumen.body, 'data'), false);
  assert.equal(JSON.stringify(lumen.body).includes('Bumi'), false);
  assert.equal(JSON.stringify(rantau.body).includes('Kopi'), false);
  assert.equal((await request('/api/forecast')).status, 401);
  for (const path of ['/api/forecast?companyId=co_rantau', '/api/forecast?mode=invalid',
    '/api/forecast?scenario=late&delayDays=7junk', '/api/overview?mode=fixed']) {
    assert.equal((await request(path, { headers: { authorization: 'lumen-session' } })).status, 400, path);
  }
  const overview = await request('/api/overview', { headers: { authorization: 'rantau-session' } });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.companyId, 'co_rantau');
  assert.equal(overview.body.overdueAmount, 1350000);
  assert.equal((await request('/api/forecast', { method: 'POST' })).status, 404);
});

test('synthetic preview serves only its assets and a bounded read-only forecast API', async t => {
  const server = await createForecastPreviewServer();
  const request = await listen(t, server);
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/styles.css', 'text/css']]) {
    const result = await request(path);
    assert.equal(result.status, 200, path);
    assert.ok(result.headers['content-type'].startsWith(type));
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
    assert.equal(result.headers['x-frame-options'], 'DENY');
    assert.match(result.headers['content-security-policy'], /script-src 'self'/);
    assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  const late = await request('/api/preview?case=lumen_issued&company=lumen&mode=fixed&scenario=late&delayDays=beyond_window');
  assert.equal(late.status, 200);
  assert.equal(late.body.demo, true);
  assert.equal(late.body.forecast.summary.endBalance, -500000);
  assert.equal(late.body.onTime.summary.endBalance, 1300000);
  assert.equal(late.body.overview.companyId, 'co_lumen');
  const paid = await request('/api/preview?case=lumen_paid&company=lumen&mode=rolling&scenario=late&delayDays=14');
  assert.equal(paid.status, 200);
  assert.equal(paid.body.demoDate, '2026-11-09');
  assert.equal(paid.body.forecast.openingBalance, 3800000);
  assert.equal(paid.body.forecast.summary.endBalance, 1300000);
  assert.equal((await request('/api/preview?case=rantau_paid&company=rantau&mode=rolling')).body.forecast.openingBalance, 1950000);
  const again = await request('/api/preview?case=lumen_issued&company=lumen&mode=fixed&scenario=late&delayDays=beyond_window');
  assert.deepEqual(again.body, late.body, 'preview selections never mutate the fixtures');
  for (const path of ['/.env', '/data/demo.json', '/api/forecast', '/api/overview', '/api/demo/session',
    '/../.env', '/%2e%2e/.env', '/%2e%2e%2f.env', '//app.js', '/APP.js', '/app.js/extra',
    'http://evil.example/app.js', '/%61pp.js']) {
    assert.equal((await request(path)).status, 404, path);
  }
  for (const path of ['/?x=1', '/app.js?x=1', '/api/preview?case=../../.env',
    '/api/preview?company=other', '/api/preview?company=lumen&company=rantau',
    '/api/preview?prompt=read-private-info', '/api/preview?userId=u_lumen_owner',
    '/api/preview?mode=invalid', '/api/preview?delayDays=7junk']) {
    assert.equal((await request(path)).status, 400, path);
  }
  assert.equal((await request('/api/preview', { method: 'POST' })).status, 405);
  assert.equal((await request('/api/preview', { method: 'OPTIONS' })).status, 405);
  assert.equal((await request('/api/preview', { headers: { 'content-length': '2' }, body: '{}' })).status, 400);
  assert.equal((await request('/api/preview', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await request('/api/preview', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/preview', { headers: { origin: 'null' } })).status, 403);
  assert.equal((await request('/api/preview', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await request('/api/preview', { headers: { origin: `http://127.0.0.1:${server.address().port}` } })).status, 200);
});
