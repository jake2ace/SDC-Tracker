const invalid = message => ({
  status: 400,
  body: { error: { code: 'VALIDATION_ERROR', message, details: {} } },
});

/**
 * Mount after Issue #2's session middleware and JSON parser.
 * userId is the trusted session identity, never a body/query field.
 * Serialize { status, body } unchanged. null delegates to the host router;
 * unexpected service/store exceptions reach the host error handler.
 */
export async function routeCollectionsRequest(service, {
  method, pathname, query = new URLSearchParams(), body = {}, userId,
}) {
  let operation;
  let encodedId;
  if (method === 'GET' && pathname === '/api/collections') {
    operation = 'listCollections';
  } else if (typeof pathname === 'string') {
    const generate = method === 'POST' && /^\/api\/invoices\/([^/]*)\/reminders$/.exec(pathname);
    const edit = method === 'PATCH' && /^\/api\/reminders\/([^/]*)$/.exec(pathname);
    const send = method === 'POST' && /^\/api\/reminders\/([^/]*)\/send$/.exec(pathname);
    const payment = method === 'POST' && /^\/api\/invoices\/([^/]*)\/payments$/.exec(pathname);
    const match = generate || edit || send || payment;
    if (match && match[0] === pathname) {
      operation = generate ? 'generateReminder' : edit ? 'editReminder' : send ? 'sendReminder' : 'recordPayment';
      encodedId = match[1];
    }
  }
  if (!operation) return null;

  if (!(query instanceof URLSearchParams)) return invalid('查询参数格式无效。');
  const filters = {};
  for (const [key, value] of query) {
    if (operation !== 'listCollections' || key !== 'filter' || Object.hasOwn(filters, key)) {
      return invalid('此接口不接受未知或重复的查询参数。');
    }
    filters[key] = value;
  }

  let id;
  if (encodedId !== undefined) {
    try {
      id = decodeURIComponent(encodedId);
    } catch {
      return invalid('记录 ID 的 URI 编码无效。');
    }
    if (!id || !id.trim() || /[\/\\?#\u0000-\u001f\u007f]/.test(id)) {
      return invalid('记录 ID 无效。');
    }
  }

  switch (operation) {
    case 'listCollections': return service.listCollections(userId, filters);
    case 'generateReminder': return service.generateReminder(userId, id, body);
    case 'editReminder': return service.editReminder(userId, id, body);
    case 'sendReminder': return service.sendReminder(userId, id, body);
    case 'recordPayment': return service.recordPayment(userId, id, body);
  }
}
