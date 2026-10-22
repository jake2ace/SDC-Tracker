const invalid = message => ({
  status: 400,
  body: { error: { code: 'VALIDATION_ERROR', message, details: {} } },
});

/**
 * Mount these routes in Issue #2's HTTP server after its session middleware.
 * userId must come from the verified session, never from a business body/query.
 * The host parses JSON and serializes result.body with result.status unchanged.
 * null means this module does not own the method/path; continue host routing.
 * Unexpected service/store exceptions deliberately reach the host error handler.
 */
export async function routeInvoicingRequest(service, {
  method, pathname, query = new URLSearchParams(), body = {}, userId,
}) {
  let operation;
  let encodedId;
  if (method === 'GET' && pathname === '/api/projects') {
    operation = 'listProjects';
  } else if (method === 'GET' && pathname === '/api/invoices') {
    operation = 'listInvoices';
  } else if (typeof pathname === 'string') {
    const detail = method === 'GET' && /^\/api\/invoices\/([^/]*)$/.exec(pathname);
    const complete = method === 'POST' && /^\/api\/milestones\/([^/]*)\/complete$/.exec(pathname);
    const issue = method === 'POST' && /^\/api\/invoices\/([^/]*)\/issue$/.exec(pathname);
    const match = detail || complete || issue;
    if (match && match[0] === pathname) {
      operation = detail ? 'getInvoice' : complete ? 'completeMilestone' : 'issueInvoice';
      encodedId = match[1];
    }
  }
  if (!operation) return null;

  if (!(query instanceof URLSearchParams)) return invalid('查询参数格式无效。');
  const filters = {};
  for (const [key, value] of query) {
    if (operation !== 'listInvoices' || key !== 'status' || Object.hasOwn(filters, key)) {
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
    case 'listProjects': return service.listProjects(userId);
    case 'listInvoices': return service.listInvoices(userId, filters);
    case 'getInvoice': return service.getInvoice(userId, id);
    case 'completeMilestone': return service.completeMilestone(userId, id, body);
    case 'issueInvoice': return service.issueInvoice(userId, id, body);
  }
}
