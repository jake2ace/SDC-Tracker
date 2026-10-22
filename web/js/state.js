// One place that owns every piece of server data the pages show.
// Pages never keep their own copy; they read slices from here and call actions.
//
// Stale data rules (BACKEND_HANDOFF "Frontend behavior" 4 and 5):
//  * every load remembers the epoch it started in; a company switch or reset bumps
//    the epoch and aborts in-flight requests, so a slow answer can't bring old data back
//  * every slice also has its own sequence number, so two overlapping refreshes of the
//    same slice can't land out of order

export const ACTION_ROLE = {
  complete: 'pm', approve: 'owner', reject: 'owner', issue: 'finance',
  generate: 'finance', edit: 'finance', send: 'finance', payment: 'finance',
};

const DEFAULT_USER = 'u_lumen_pm';
const USER_KEY = 'sdc.demoUser';

const slice = () => ({ status: 'idle', data: null, error: null, seq: 0 });

export function forecastKey(mode, scenario, delay) {
  return scenario === 'late' ? `${mode}|late|${delay}` : `${mode}|on_time`;
}

// A chart must compare one completed refresh, with exactly the same calendar
// window and starting facts. Scenario-specific dates and balances may differ.
export function comparableForecasts(aSl, bSl) {
  const a = aSl?.data, b = bSl?.data;
  if (!a || !b || !aSl.snapshot || aSl.snapshot !== bSl.snapshot) return false;
  if (a.baseDate !== b.baseDate || a.endDate !== b.endDate
    || a.openingBalance !== b.openingBalance || a.safetyLine !== b.safetyLine) return false;
  if (!Array.isArray(a.lines) || !Array.isArray(b.lines)) return false;
  // Requests are separate at the HTTP boundary. If another tab changes a
  // payment between them, do not compare different underlying business facts.
  const facts = result => result.lines
    .map(line => [line.id, line.kind, line.originalDate, line.amount, line.ref])
    .sort(([left], [right]) => left.localeCompare(right));
  if (JSON.stringify(facts(a)) !== JSON.stringify(facts(b))) return false;
  return Array.isArray(a.days) && Array.isArray(b.days) && a.days.length === 30 && b.days.length === 30
    && a.days.every((day, i) => day.date === b.days[i].date);
}

export function createStore({ api, storage = null } = {}) {
  const listeners = new Set();
  let ctrl = new AbortController();
  let switchSeq = 0;
  let forecastSeq = 0;
  const activeActions = new Map();

  const s = {
    epoch: 0,
    userId: readStoredUser() ?? DEFAULT_USER,
    boot: { status: 'idle', error: null },
    session: slice(),
    projects: slice(),
    invoices: slice(),
    overview: slice(),
    activity: slice(),
    collections: { overdue: slice(), unpaid: slice(), paid: slice() },
    forecasts: new Map(),
    details: new Map(),
    busy: new Set(),
    flash: new Map(),
    ui: {
      selectedInvoice: null,
      selectedCollection: null,
      filter: 'overdue',
      cf: { mode: 'fixed', active: 'late', delay: 'beyond_window' },
      edits: new Map(),
    },
  };

  function readStoredUser() {
    try { return storage?.getItem(USER_KEY) || null; } catch { return null; }
  }
  function storeUser(id) {
    try { storage?.setItem(USER_KEY, id); } catch { /* private mode, fine */ }
  }

  function emit() { for (const fn of listeners) fn(s); }

  const role = () => s.session.data?.user?.role ?? null;
  const canCollect = () => ['owner', 'finance'].includes(role());

  async function load(sl, fn, { keepData = true } = {}) {
    const ep = s.epoch;
    const seq = ++sl.seq;
    sl.status = 'loading';
    sl.error = null;
    if (!keepData) sl.data = null;
    emit();
    try {
      const data = await fn({ signal: ctrl.signal });
      if (ep !== s.epoch || seq !== sl.seq) return;
      sl.data = data;
      sl.status = 'ready';
    } catch (err) {
      if (err?.aborted || ep !== s.epoch || seq !== sl.seq) return;
      sl.status = 'error';
      sl.error = err;
    }
    emit();
  }

  function forecastSlice(key) {
    if (!s.forecasts.has(key)) s.forecasts.set(key, slice());
    return s.forecasts.get(key);
  }

  function neededForecastKeys() {
    const { mode, delay } = s.ui.cf;
    return new Set([
      forecastKey('fixed', 'late', 'beyond_window'), // overview "lowest cash if paid late"
      forecastKey(mode, 'on_time'),
      forecastKey(mode, 'late', delay),
    ]);
  }

  async function loadForecasts(keys = neededForecastKeys()) {
    const ep = s.epoch;
    const snapshot = ++forecastSeq;
    const signal = ctrl.signal;
    // Keep a single active set. Returning to a different scenario loads its
    // comparison again instead of reusing half of an older comparison.
    for (const key of s.forecasts.keys()) if (!keys.has(key)) s.forecasts.delete(key);
    const entries = [...keys].map(key => {
      const sl = forecastSlice(key);
      sl.status = 'loading';
      sl.error = null;
      return { key, sl };
    });
    emit();
    const results = await Promise.allSettled(entries.map(async ({ key }) => {
      const [mode, scenario, delay] = key.split('|');
      const params = scenario === 'late'
        ? { mode, scenario, delayDays: delay === 'beyond_window' ? delay : Number(delay) }
        : { mode, scenario };
      return api.forecast(params, { signal });
    }));
    if (ep !== s.epoch || snapshot !== forecastSeq) return;
    const failure = results.find(result => result.status === 'rejected');
    // A partial success is not a new comparison. Retain the entire previous
    // snapshot and mark it stale; never mix a fresh curve with an old curve.
    entries.forEach(({ sl }, i) => {
      if (failure) {
        sl.status = 'error';
        sl.error = failure.reason;
      } else {
        sl.data = results[i].value;
        sl.snapshot = snapshot;
        sl.status = 'ready';
      }
    });
    emit();
  }

  function ensureForecasts() {
    const keys = neededForecastKeys();
    return [...keys].some(key => forecastSlice(key).status === 'idle') ? loadForecasts(keys) : Promise.resolve();
  }

  function detailSlice(id) {
    if (!s.details.has(id)) s.details.set(id, slice());
    return s.details.get(id);
  }
  function loadDetail(id) { return load(detailSlice(id), o => api.invoice(id, o)); }
  function ensureDetail(id) {
    if (!id) return null;
    const sl = detailSlice(id);
    return sl.status === 'idle' ? loadDetail(id) : null;
  }

  function selectedIds() {
    return [...new Set([s.ui.selectedInvoice, s.ui.selectedCollection].filter(Boolean))];
  }

  async function refreshAll() {
    const jobs = [
      load(s.session, o => api.session(o)),
      load(s.projects, o => api.projects(o)),
      load(s.invoices, o => api.invoices(o)),
      load(s.overview, o => api.overview(o)),
      load(s.activity, o => api.activity(12, o)),
    ];
    if (canCollect()) {
      for (const f of ['overdue', 'unpaid', 'paid']) jobs.push(load(s.collections[f], o => api.collections(f, o)));
    }
    jobs.push(loadForecasts());
    // Only the invoices on screen need their detail refreshed; the rest are dropped.
    const ids = selectedIds();
    for (const id of [...s.details.keys()]) if (!ids.includes(id)) s.details.delete(id);
    for (const id of ids) jobs.push(loadDetail(id));
    await Promise.all(jobs);
  }

  function clearCompanyData() {
    for (const key of ['session', 'projects', 'invoices', 'overview', 'activity']) s[key] = slice();
    s.collections = { overdue: slice(), unpaid: slice(), paid: slice() };
    s.forecasts.clear();
    s.details.clear();
    s.flash.clear();
    s.ui.selectedInvoice = null;
    s.ui.selectedCollection = null;
    s.ui.filter = 'overdue';
    s.ui.edits.clear();
    s.ui.rejectReasons?.clear();
    s.ui.payDates?.clear();
  }

  function newEpoch() {
    ctrl.abort();
    ctrl = new AbortController();
    s.epoch += 1;
    for (const key of activeActions.keys()) s.busy.delete(key);
    activeActions.clear();
  }

  async function boot() {
    s.boot = { status: 'loading', error: null };
    emit();
    const ep = s.epoch;
    try {
      let session;
      try {
        session = await api.session({ signal: ctrl.signal });
      } catch (err) {
        // A remembered user that no longer exists falls back to the PM once.
        if (err?.code !== 'UNAUTHENTICATED' || s.userId === DEFAULT_USER) throw err;
        s.userId = DEFAULT_USER;
        storeUser(DEFAULT_USER);
        session = await api.session({ signal: ctrl.signal });
      }
      if (ep !== s.epoch) return;
      s.session.data = session;
      s.session.status = 'ready';
      s.boot = { status: 'ready', error: null };
      emit();
      await refreshAll();
    } catch (err) {
      if (err?.aborted || ep !== s.epoch) return;
      s.boot = { status: 'error', error: err };
      emit();
    }
  }

  // Role and company switching. A company switch must also tell the backend via
  // PUT /api/demo/settings with both companyId and userId.
  async function switchUser(userId) {
    const session = s.session.data;
    const target = session?.users?.find(u => u.id === userId);
    if (!target || userId === s.userId) return;
    const crossCompany = target.companyId !== session.company.id;
    const token = ++switchSeq;
    if (crossCompany) {
      s.busy.add('switch');
      emit();
      try {
        await api.updateSettings({ companyId: target.companyId, userId }, { as: s.userId });
      } catch (err) {
        s.busy.delete('switch');
        if (token === switchSeq) s.flash.set('demo', { kind: 'bad', error: err, action: 'switch' });
        emit();
        return;
      }
      s.busy.delete('switch');
      if (token !== switchSeq) return;
    }
    newEpoch();
    s.userId = userId;
    storeUser(userId);
    if (crossCompany) {
      clearCompanyData();
    } else {
      s.flash.clear();
      if (!['owner', 'finance'].includes(target.role)) s.collections = { overdue: slice(), unpaid: slice(), paid: slice() };
    }
    emit();
    await load(s.session, o => api.session(o));
    await refreshAll();
  }

  // Wraps every write. The button for `key` stays disabled until the follow-up
  // refresh is done, so nobody can click an action against stale state.
  async function runAction(key, scope, fn, onSuccess) {
    if (s.busy.has(key)) return null;
    const ep = s.epoch;
    const token = Symbol(key);
    activeActions.set(key, token);
    s.busy.add(key);
    s.flash.delete(scope);
    emit();
    let result = null;
    try {
      try {
        result = await fn({ signal: ctrl.signal });
        if (ep !== s.epoch) return null;
        const message = onSuccess ? onSuccess(result) : null;
        if (message) s.flash.set(scope, { kind: 'good', ...message });
      } catch (err) {
        if (err?.aborted || ep !== s.epoch) return null;
        result = null;
        s.flash.set(scope, { kind: 'bad', error: err, action: key.split(':')[0] });
      }
      if (ep === s.epoch) await refreshAll();
      return result;
    } finally {
      // An old request may finish after a new identity starts the same action.
      // Only the request that owns this busy flag may release it.
      if (activeActions.get(key) === token) {
        activeActions.delete(key);
        s.busy.delete(key);
        emit();
      }
    }
  }

  const actions = {
    completeMilestone: id => runAction(`complete:${id}`, `ms:${id}`, o => api.completeMilestone(id, o), r => {
      s.ui.selectedInvoice = r.invoice.id;
      return { type: r.created ? 'draftCreated' : 'draftReused', data: r };
    }),
    approve: id => runAction(`approve:${id}`, `inv:${id}`, o => api.approve(id, o), r => ({ type: 'approved', data: r })),
    reject: (id, reason) => runAction(`reject:${id}`, `inv:${id}`, o => api.reject(id, reason, o), r => ({ type: 'rejected', data: r })),
    issue: (id, again = false) => runAction(`issue:${id}`, `inv:${id}`, o => api.issue(id, o),
      r => ({ type: again ? 'issueReplay' : 'issued', data: r })),
    generateReminder: (invoiceId, regenerate = false) => runAction(`generate:${invoiceId}`, `col:${invoiceId}`,
      o => api.generateReminder(invoiceId, regenerate, o), r => {
        s.ui.edits.delete(r.reminder.id);
        return { type: regenerate ? 'regenerated' : 'generated', data: r };
      }),
    useTemplate: (invoiceId, regenerate = false) => runAction(`generate:${invoiceId}`, `col:${invoiceId}`,
      o => api.templateReminder(invoiceId, regenerate, o), r => {
        s.ui.edits.delete(r.reminder.id);
        return { type: 'templateReady', data: r };
      }),
    saveReminder: (invoiceId, reminderId, subject, body) => runAction(`edit:${reminderId}`, `col:${invoiceId}`,
      o => api.editReminder(reminderId, subject, body, o), r => {
        s.ui.edits.delete(reminderId);
        return { type: 'saved', data: r };
      }),
    sendReminder: (invoiceId, reminderId, reviewToken, again = false) => runAction(`send:${reminderId}`, `col:${invoiceId}`,
      o => api.sendReminder(reminderId, reviewToken, o), r => {
        s.ui.edits.delete(reminderId);
        return { type: again ? 'sendReplay' : 'sent', data: r };
      }),
    recordPayment: (invoiceId, receivedAt, again = false) => runAction(`payment:${invoiceId}`, `col:${invoiceId}`,
      o => api.recordPayment(invoiceId, receivedAt, o), r => {
        // The invoice leaves the overdue list, so follow it to the Paid tab.
        s.ui.filter = 'paid';
        s.ui.selectedCollection = invoiceId;
        return { type: again ? 'paymentReplay' : 'paid', data: r };
      }),
    setDemoDate: date => runAction('settings', 'demo', o => api.updateSettings({ demoDate: date }, o), () => null),
    setFailNext: failNext => runAction('settings', 'demo', o => api.updateSettings({ failNext }, o), () => null),
    async reset() {
      if (s.busy.has('reset')) return;
      s.busy.add('reset');
      s.flash.delete('demo');
      emit();
      try {
        await api.reset({});
      } catch (err) {
        s.busy.delete('reset');
        s.flash.set('demo', { kind: 'bad', error: err, action: 'reset' });
        emit();
        return;
      }
      newEpoch();
      clearCompanyData();
      s.busy.delete('reset');
      s.flash.set('demo', { kind: 'good', type: 'reset' });
      emit();
      await load(s.session, o => api.session(o));
      await refreshAll();
    },
  };

  return {
    state: s,
    role,
    canCollect,
    boot,
    refreshAll,
    switchUser,
    actions,
    ensureForecasts,
    ensureDetail,
    forecastSlice,
    detailSlice,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit,
    clearFlash(scope) { if (s.flash.delete(scope)) emit(); },
  };
}
