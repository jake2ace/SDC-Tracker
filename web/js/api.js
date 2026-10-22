// Thin client for the integrated backend (contracts/api.ts).
// Every /api request carries X-Demo-User. Nothing here holds a secret.

export class ApiFailure extends Error {
  constructor({ status = 0, code, message = '', details = {}, requestId = null, network = false, aborted = false }) {
    super(message || code);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.network = network;
    this.aborted = aborted;
  }
}

const enc = encodeURIComponent;

export function forecastQuery({ mode = 'fixed', scenario = 'on_time', delayDays } = {}) {
  const q = { mode, scenario };
  if (scenario === 'late') q.delayDays = String(delayDays);
  return q;
}

export function createApi({ baseUrl, fetchImpl = (...args) => fetch(...args), getUser }) {
  const base = new URL(baseUrl);

  async function request(method, path, { body, query, signal, as } = {}) {
    const user = as ?? getUser();
    if (!user) throw new ApiFailure({ status: 401, code: 'UNAUTHENTICATED', message: 'No demo identity selected.' });
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { 'X-Demo-User': user, Accept: 'application/json' };
    const init = { method, headers, signal, credentials: 'omit', cache: 'no-store', redirect: 'error' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchImpl(url.toString(), init);
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw new ApiFailure({ code: 'ABORTED', aborted: true });
      // fetch only says "Failed to fetch" for both a stopped server and a CORS refusal
      throw new ApiFailure({ code: 'NETWORK', network: true, message: String(err?.message ?? err) });
    }
    const headerId = res.headers.get('X-Request-Id');
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const e = data && typeof data === 'object' ? data.error : null;
      throw new ApiFailure({
        status: res.status,
        code: e?.code ?? `HTTP_${res.status}`,
        message: typeof e?.message === 'string' ? e.message : text.slice(0, 200),
        details: e?.details && typeof e.details === 'object' ? e.details : {},
        requestId: (e?.details && e.details.requestId) || headerId,
      });
    }
    if (!data || typeof data !== 'object') {
      throw new ApiFailure({ status: res.status, code: 'BAD_RESPONSE', message: 'The backend returned an unexpected response.', requestId: headerId });
    }
    return data;
  }

  return {
    baseUrl: base.origin,
    request,
    session: o => request('GET', '/api/demo/session', o),
    updateSettings: (patch, o) => request('PUT', '/api/demo/settings', { ...o, body: patch }),
    reset: o => request('POST', '/api/demo/reset', o),
    projects: o => request('GET', '/api/projects', o),
    invoices: o => request('GET', '/api/invoices', o),
    invoice: (id, o) => request('GET', `/api/invoices/${enc(id)}`, o),
    completeMilestone: (id, o) => request('POST', `/api/milestones/${enc(id)}/complete`, o),
    approve: (id, o) => request('POST', `/api/invoices/${enc(id)}/approve`, o),
    reject: (id, reason, o) => request('POST', `/api/invoices/${enc(id)}/reject`, { ...o, body: { reason } }),
    issue: (id, o) => request('POST', `/api/invoices/${enc(id)}/issue`, o),
    collections: (filter, o) => request('GET', '/api/collections', { ...o, query: { filter } }),
    generateReminder: (invoiceId, regenerate, o) => request('POST', `/api/invoices/${enc(invoiceId)}/reminders`,
      regenerate ? { ...o, body: { regenerate: true } } : o),
    templateReminder: (invoiceId, regenerate, o) => request('POST', `/api/invoices/${enc(invoiceId)}/reminders`,
      { ...o, body: { useTemplate: true, ...(regenerate ? { regenerate: true } : {}) } }),
    editReminder: (id, subject, text, o) => request('PATCH', `/api/reminders/${enc(id)}`, { ...o, body: { subject, body: text } }),
    sendReminder: (id, reviewToken, o) => request('POST', `/api/reminders/${enc(id)}/send`, { ...o, body: { reviewToken } }),
    recordPayment: (invoiceId, receivedAt, o) => request('POST', `/api/invoices/${enc(invoiceId)}/payments`, { ...o, body: { receivedAt } }),
    overview: o => request('GET', '/api/overview', o),
    forecast: (params, o) => request('GET', '/api/forecast', { ...o, query: forecastQuery(params) }),
    activity: (limit, o) => request('GET', '/api/activity', { ...o, query: { limit } }),
  };
}
