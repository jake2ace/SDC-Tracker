import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createForecastService } from '../src/forecast/service.mjs';

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const CASES = new Set(['seed', 'lumen_issued', 'lumen_paid', 'rantau_paid']);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const headers = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'cross-origin-resource-policy': 'same-origin',
};
const invalid = message => ({ status: 400,
  body: { error: { code: 'VALIDATION_ERROR', message, details: {} } } });

function fixture(seed, definitions, name, seen = new Set()) {
  if (seen.has(name) || !Object.hasOwn(definitions, name)) throw new Error('Invalid bundled fixture');
  const definition = definitions[name];
  const state = definition.extends
    ? fixture(seed, definitions, definition.extends, new Set([...seen, name]))
    : structuredClone(seed);
  Object.assign(state.settings, definition.settings ?? {});
  for (const { collection, id, set } of definition.updates ?? []) {
    Object.assign(state[collection].find(row => row.id === id), structuredClone(set));
  }
  for (const { collection, record } of definition.appends ?? []) {
    state[collection].push(structuredClone(record));
  }
  return state;
}

// Preview selectors are deliberately limited to bundled synthetic fixtures.
// There is no file selector, arbitrary state input, authentication bypass for
// the real app, AI provider, environment-file reader, or state mutation route.
async function preview(seed, definitions, query) {
  const options = {};
  for (const [key, value] of query) {
    if (!['case', 'company', 'mode', 'scenario', 'delayDays'].includes(key)
      || Object.hasOwn(options, key)) return invalid('不接受未知或重复参数。');
    options[key] = value;
  }
  const selectedCase = options.case ?? 'lumen_issued';
  const company = options.company ?? 'lumen';
  if (!CASES.has(selectedCase) || !['lumen', 'rantau'].includes(company)) {
    return invalid('只能选择内置的演示公司和案例。');
  }
  const state = fixture(seed, definitions, selectedCase);
  if (options.mode === 'rolling' && selectedCase === 'lumen_paid') {
    state.settings.demoDate = '2026-11-09';
  } else if (options.mode === 'rolling' && selectedCase === 'rantau_paid') {
    state.settings.demoDate = '2026-11-08';
  }
  const companyId = `co_${company}`;
  const userId = `u_${company}_fin`;
  const service = createForecastService({ store: { read: () => structuredClone(state) } });
  const forecastQuery = {};
  for (const key of ['mode', 'scenario', 'delayDays']) {
    if (!Object.hasOwn(options, key)) continue;
    if (key === 'delayDays') {
      if (!['7', '14', 'beyond_window'].includes(options[key])) return invalid('延迟天数无效。');
      forecastQuery[key] = options[key] === 'beyond_window' ? options[key] : Number(options[key]);
    } else forecastQuery[key] = options[key];
  }
  const result = await service.getForecast(userId, forecastQuery);
  if (result.status !== 200) return result;
  const onTime = await service.getForecast(userId, { mode: forecastQuery.mode ?? 'fixed', scenario: 'on_time' });
  if (onTime.status !== 200) return onTime;
  const overview = await service.getOverview(userId);
  if (overview.status !== 200) return overview;
  return { status: 200, body: {
    demo: true,
    demoDate: state.settings.demoDate,
    companyName: state.companies.find(row => row.id === companyId).name,
    forecast: result.body,
    onTime: onTime.body,
    overview: overview.body,
  } };
}

/** Returns an unbound, read-only HTTP preview. Call listen(..., '127.0.0.1'). */
export async function createForecastPreviewServer() {
  const [seedText, expectedText, staticEntries] = await Promise.all([
    readFile(new URL('../data/demo.json', import.meta.url), 'utf8'),
    readFile(new URL('../data/expected-results.json', import.meta.url), 'utf8'),
    Promise.all([...STATIC_FILES].map(async ([path, [file, type]]) => [path, {
      content: await readFile(new URL(`./forecast-ui/${file}`, import.meta.url)), type,
    }])),
  ]);
  const seed = JSON.parse(seedText);
  const definitions = JSON.parse(expectedText).stateFixtures;
  const assets = new Map(staticEntries);
  const server = createServer(async (request, response) => {
    const json = result => {
      response.writeHead(result.status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(result.body));
    };
    try {
      const port = server.address()?.port;
      const host = request.headers.host;
      const hostCount = request.rawHeaders.filter((_, index) => index % 2 === 0
        && request.rawHeaders[index].toLowerCase() === 'host').length;
      const originCount = request.rawHeaders.filter((_, index) => index % 2 === 0
        && request.rawHeaders[index].toLowerCase() === 'origin').length;
      if (hostCount !== 1 || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)
        || originCount > 1 || request.headers['sec-fetch-site'] === 'cross-site'
        || (request.headers.origin !== undefined && request.headers.origin !== `http://${host}`)) {
        return json({ status: 403, body: { error: { code: 'FORBIDDEN', message: '仅允许本机同源预览。', details: {} } } });
      }
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        return json({ status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: '预览只支持 GET。', details: {} } } });
      }
      if (request.headers['transfer-encoding'] !== undefined
        || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) {
        response.setHeader('connection', 'close');
        return json(invalid('预览不接受请求正文。'));
      }
      if (!request.url || request.url.length > 2048 || request.url.includes('#')) {
        return json(invalid('请求地址无效。'));
      }
      const rawPath = request.url.split('?')[0];
      if (rawPath !== '/api/preview' && !assets.has(rawPath)) {
        return json({ status: 404, body: { error: { code: 'NOT_FOUND', message: '没有此预览资源。', details: {} } } });
      }
      const url = new URL(request.url, `http://${host}`);
      if (rawPath === '/api/preview') return json(await preview(seed, definitions, url.searchParams));
      if (url.search) return json(invalid('静态资源不接受参数。'));
      const asset = assets.get(rawPath);
      response.writeHead(200, { ...headers, 'content-type': asset.type });
      response.end(asset.content);
    } catch {
      json({ status: 500, body: { error: { code: 'PREVIEW_ERROR', message: '演示数据加载失败。', details: {} } } });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const value = process.env.PORT ?? '4175';
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  const server = await createForecastPreviewServer();
  server.listen(Number(value), '127.0.0.1', () => {
    console.log(`Synthetic read-only forecast preview: http://127.0.0.1:${value}`);
  });
}
