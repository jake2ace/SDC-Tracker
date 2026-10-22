const invalid = message => ({
  status: 400,
  body: { error: { code: 'VALIDATION_ERROR', message, details: {} } },
});

/**
 * Mount after the host's verified-session middleware. Identity comes only from
 * userId, never query/body. This read-only module owns exactly two GET routes.
 * Return null for another route, and let unexpected failures reach the host.
 */
export async function routeForecastRequest(service, {
  method, pathname, query = new URLSearchParams(), body = {}, userId,
}) {
  const operation = method === 'GET' && (pathname === '/api/forecast'
    ? 'getForecast' : pathname === '/api/overview' ? 'getOverview' : null);
  if (!operation) return null;
  if (!(query instanceof URLSearchParams)) return invalid('查询参数格式无效。');
  if (body === null || typeof body !== 'object' || Array.isArray(body)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(body))
    || Reflect.ownKeys(body).length !== 0) {
    return invalid('此只读接口不接受请求正文。');
  }
  const filters = {};
  for (const [key, value] of query) {
    if (operation !== 'getForecast' || !['mode', 'scenario', 'delayDays'].includes(key)
      || Object.hasOwn(filters, key)) {
      return invalid('此接口不接受未知或重复的查询参数。');
    }
    if (key === 'delayDays') {
      if (!['7', '14', 'beyond_window'].includes(value)) return invalid('延迟天数无效。');
      filters[key] = value === 'beyond_window' ? value : Number(value);
    } else filters[key] = value;
  }
  return service[operation](userId, filters);
}
