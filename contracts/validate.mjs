// Fixture preflight only; this is not HTTP request validation or authorization.
const DAY = 86_400_000;
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
export function addDays(value, days) {
  if (!isDate(value) || !Number.isInteger(days)) throw new Error('Invalid date or day count');
  return new Date(Date.parse(value) + days * DAY).toISOString().slice(0, 10);
}
function timestamp(value) {
  return typeof value === 'string' && isDate(value.slice(0, 10))
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:[0-5]\d)$/.test(value)
    && Number.isFinite(Date.parse(value));
}

/** Return human-readable errors for the important cross-record contract invariants. */
export function validateState(state) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  if (!state || typeof state !== 'object') return ['state must be an object'];
  const names = ['companies', 'users', 'clients', 'projects', 'milestones', 'invoices',
    'payments', 'reminders', 'expenses', 'logs', 'mockAccounting', 'mockOutbox'];
  for (const name of names) check(Array.isArray(state[name]), `${name}: array required`);
  if (errors.length) return errors;
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const amount = (value, label, min = 1) => check(Number.isSafeInteger(value) && value >= min, `${label}: integer sen required`);
  const integer = (value, label, min = 0) => check(Number.isSafeInteger(value) && value >= min, `${label}: integer required`);
  const date = (value, label) => check(isDate(value), `${label}: valid date required`);
  const maps = {};
  const allIds = new Set();
  for (const name of names) {
    maps[name] = new Map();
    for (const row of state[name]) {
      if (!row || typeof row !== 'object') { errors.push(`${name}: object required`); continue; }
      const key = name.startsWith('mock') ? row.requestId : row.id;
      check(text(key), `${name}: nonempty identifier required`);
      check(!maps[name].has(key), `${name}: duplicate identifier ${key}`);
      maps[name].set(key, row);
      if (!name.startsWith('mock')) {
        check(!allIds.has(key), `${name}: duplicate entity ID ${key}`);
        allIds.add(key);
      }
    }
  }
  // Avoid turning malformed collection contents into exceptions during preflight.
  if (names.some(name => state[name].some(row => !row || typeof row !== 'object'))) return errors;
  const owned = (row, label) => check(maps.companies.has(row.companyId), `${label}: unknown company`);
  const actor = (name, companyId, role, label) => check(state.users.some(u => u.name === name && u.companyId === companyId && u.role === role), `${label}: actor must be ${role} in the same company`);
  const once = (rows, key, label) => {
    const values = rows.map(row => row[key]);
    check(new Set(values).size === values.length, `${label}: duplicate ${key}`);
  };
  check(state.schemaVersion === 1, 'schemaVersion: supported version is 1');
  integer(state.seq, 'seq');
  const settings = state.settings ?? {};
  date(settings.demoDate, 'settings.demoDate');
  check(maps.users.get(settings.userId)?.companyId === settings.companyId, 'settings: user and company must match');
  check(maps.companies.has(settings.companyId), 'settings: unknown company');
  check(typeof settings.failNext?.accounting === 'boolean' && typeof settings.failNext?.outbox === 'boolean', 'settings: failure flags must be booleans');
  for (const c of state.companies) {
    amount(c.openingBalance, `${c.id}.openingBalance`, Number.MIN_SAFE_INTEGER);
    amount(c.safetyLine, `${c.id}.safetyLine`, 0);
    date(c.forecastBaseDate, `${c.id}.forecastBaseDate`);
    check(c.currency === 'MYR' && c.forecastDays === 30, `${c.id}: MYR and 30-day window required`);
  }
  for (const u of state.users) { owned(u, u.id); check(['pm', 'owner', 'finance'].includes(u.role), `${u.id}: invalid role`); }
  for (const c of state.clients) { owned(c, c.id); check(typeof c.email === 'string' && c.email.endsWith('.example'), `${c.id}: synthetic .example email required`); }
  for (const p of state.projects) {
    owned(p, p.id); amount(p.contractTotal, `${p.id}.contractTotal`);
    check(maps.clients.get(p.clientId)?.companyId === p.companyId, `${p.id}: client company mismatch`);
    const stages = state.milestones.filter(m => m.projectId === p.id);
    check(stages.reduce((sum, m) => sum + (m.paymentTerm?.amount ?? NaN), 0) === p.contractTotal, `${p.id}: stage amounts must equal contract total`);
    once(stages, 'seq', p.id);
  }
  for (const m of state.milestones) {
    const p = maps.projects.get(m.projectId);
    check(Boolean(p), `${m.id}: unknown project`);
    integer(m.seq, `${m.id}.seq`, 1); date(m.plannedDate, `${m.id}.plannedDate`);
    amount(m.paymentTerm?.amount, `${m.id}.amount`); integer(m.paymentTerm?.netDays, `${m.id}.netDays`);
    check(m.paymentTerm?.dueFrom === 'issue_date', `${m.id}: dueFrom must be issue_date`);
    check(['pending', 'completed'].includes(m.status), `${m.id}: invalid milestone state`);
    if (m.status === 'completed') {
      date(m.completedAt, `${m.id}.completedAt`);
      check(m.completedAt <= settings.demoDate, `${m.id}: completion after demo date`);
      actor(m.completedBy, p?.companyId, 'pm', m.id);
      check(m.settledBeforeDemo || state.invoices.some(i => i.milestoneId === m.id), `${m.id}: completed stage needs invoice`);
    } else check(m.completedAt === null && m.completedBy === null, `${m.id}: pending stage has completion data`);
    if (m.settledBeforeDemo) check(m.status === 'completed' && !state.invoices.some(i => i.milestoneId === m.id), `${m.id}: historical stage cannot create another invoice`);
  }
  once(state.invoices, 'milestoneId', 'invoices');
  once(state.invoices, 'issueRequestId', 'invoices');
  once(state.invoices.filter(i => i.invoiceNo !== null), 'invoiceNo', 'invoices');
  once(state.payments, 'invoiceId', 'payments');
  once(state.reminders, 'sendRequestId', 'reminders');
  once(state.reminders.filter(r => r.status === 'draft'), 'invoiceId', 'draft reminders');
  for (const i of state.invoices) {
    owned(i, i.id);
    const p = maps.projects.get(i.projectId), m = maps.milestones.get(i.milestoneId);
    check(p?.companyId === i.companyId && p?.clientId === i.clientId && maps.clients.get(i.clientId)?.companyId === i.companyId, `${i.id}: project/client company mismatch`);
    check(m?.projectId === i.projectId && m?.status === 'completed' && !m?.settledBeforeDemo, `${i.id}: milestone mismatch`);
    amount(i.amount, `${i.id}.amount`); integer(i.netDays, `${i.id}.netDays`); integer(i.issueAttempts, `${i.id}.issueAttempts`);
    check(i.amount === m?.paymentTerm?.amount && i.netDays === m?.paymentTerm?.netDays && i.currency === 'MYR', `${i.id}: invoice terms mismatch`);
    check(i.basis?.contractTotal === p?.contractTotal && i.basis?.projectName === p?.name && i.basis?.milestoneName === m?.name && i.basis?.termNote === m?.paymentTerm?.note, `${i.id}: basis snapshot mismatch`);
    check(text(i.issueRequestId), `${i.id}: issue request ID required`);
    date(i.draftedAt, `${i.id}.draftedAt`); date(i.expectedDueDate, `${i.id}.expectedDueDate`);
    if (isDate(i.draftedAt) && Number.isInteger(i.netDays)) check(i.expectedDueDate === addDays(i.draftedAt, i.netDays), `${i.id}: expected due date mismatch`);
    check(['pending_approval', 'approved', 'rejected', 'issued', 'paid'].includes(i.status), `${i.id}: invalid invoice state`);
    if (i.status === 'pending_approval') check(i.approval === null, `${i.id}: pending invoice has approval`);
    else {
      check(i.approval?.role === 'owner' && timestamp(i.approval?.at), `${i.id}: owner approval required`);
      actor(i.approval?.by, i.companyId, 'owner', i.id);
      if (i.status === 'rejected') check(text(i.approval?.reason), `${i.id}: rejection reason required`);
    }
    const issued = ['issued', 'paid'].includes(i.status), receipt = maps.mockAccounting.get(i.issueRequestId);
    if (issued) {
      check(text(i.invoiceNo) && i.issueAttempts > 0, `${i.id}: issuance metadata required`);
      date(i.issuedAt, `${i.id}.issuedAt`); date(i.dueDate, `${i.id}.dueDate`);
      check(i.issuedAt >= i.draftedAt && i.issuedAt <= settings.demoDate, `${i.id}: invalid issuance chronology`);
      if (isDate(i.issuedAt) && Number.isInteger(i.netDays)) check(i.dueDate === addDays(i.issuedAt, i.netDays), `${i.id}: actual due date mismatch`);
      check(receipt?.invoiceNo === i.invoiceNo && receipt?.issuedAt === i.issuedAt && receipt?.dueDate === i.dueDate, `${i.id}: missing or mismatched accounting receipt`);
    } else check(i.invoiceNo === null && i.issuedAt === null && i.dueDate === null && !receipt, `${i.id}: unissued invoice has issuance metadata`);
    const payments = state.payments.filter(p => p.invoiceId === i.id);
    if (i.status === 'paid') check(payments.length === 1 && payments[0].receivedAt === i.paidAt, `${i.id}: paid invoice needs one matching payment`);
    else check(i.paidAt === null && payments.length === 0, `${i.id}: unpaid invoice has payment`);
  }
  for (const p of state.payments) {
    const i = maps.invoices.get(p.invoiceId); owned(p, p.id); amount(p.amount, `${p.id}.amount`); date(p.receivedAt, `${p.id}.receivedAt`);
    check(i?.companyId === p.companyId && i?.status === 'paid' && i?.amount === p.amount, `${p.id}: full payment and invoice company/state must match`);
    check(p.receivedAt >= i?.issuedAt && p.receivedAt <= settings.demoDate, `${p.id}: payment date out of range`);
    actor(p.recordedBy, p.companyId, 'finance', p.id);
  }
  for (const r of state.reminders) {
    const i = maps.invoices.get(r.invoiceId); owned(r, r.id);
    check(i?.companyId === r.companyId && ['issued', 'paid'].includes(i?.status), `${r.id}: invoice company/state mismatch`);
    check(['draft', 'sent', 'cancelled'].includes(r.status) && ['mock_template', 'manual_template', 'ai'].includes(r.source), `${r.id}: invalid reminder state/source`);
    integer(r.sequence, `${r.id}.sequence`, 1); integer(r.facts?.previousReminders, `${r.id}.previousReminders`); integer(r.facts?.overdueDays, `${r.id}.overdueDays`, 1);
    check(r.sequence === r.facts?.previousReminders + 1 && r.tone === (r.sequence === 1 ? 'gentle' : r.sequence === 2 ? 'firm' : 'final'), `${r.id}: sequence/tone mismatch`);
    check(r.facts?.amount === i?.amount && r.facts?.dueDate === i?.dueDate && r.facts?.invoiceNo === i?.invoiceNo, `${r.id}: reminder facts mismatch`);
    check(text(r.subject) && text(r.body) && text(r.sendRequestId) && timestamp(r.createdAt), `${r.id}: reminder metadata required`);
    actor(r.createdBy, r.companyId, 'finance', r.id);
    if (r.editedAt !== null) check(timestamp(r.editedAt), `${r.id}: invalid edit timestamp`);
    const outbox = maps.mockOutbox.get(r.sendRequestId);
    if (r.status === 'sent') {
      check(timestamp(r.sentAt) && Date.parse(r.sentAt) >= Date.parse(r.createdAt), `${r.id}: invalid send timestamp`);
      actor(r.sentBy, r.companyId, 'finance', r.id);
      check(outbox?.reminderId === r.id && outbox?.sentAt === r.sentAt && outbox?.subject === r.subject, `${r.id}: missing or mismatched outbox receipt`);
    } else check(r.sentAt === null && r.sentBy === null && !outbox, `${r.id}: unsent reminder has sent metadata`);
    if (r.status === 'draft') check(i?.status === 'issued' && i?.dueDate < settings.demoDate, `${r.id}: draft reminder needs unpaid overdue invoice`);
    if (r.status === 'cancelled') check(text(r.cancelReason), `${r.id}: cancellation reason required`);
  }
  for (const e of state.expenses) { owned(e, e.id); amount(e.amount, `${e.id}.amount`); date(e.date, `${e.id}.date`); }
  for (const r of state.mockAccounting) {
    check(r.simulation === true && state.invoices.some(i => i.issueRequestId === r.requestId && ['issued', 'paid'].includes(i.status)), `${r.requestId}: orphaned or non-simulated accounting receipt`);
  }
  for (const o of state.mockOutbox) {
    const r = maps.reminders.get(o.reminderId), i = maps.invoices.get(r?.invoiceId);
    check(o.simulation === true && r?.status === 'sent' && r?.sendRequestId === o.requestId && o.to === maps.clients.get(i?.clientId)?.email, `${o.requestId}: orphaned, wrong recipient or non-simulated outbox`);
  }
  const roles = { 'milestone.complete': 'pm', 'invoice.approve': 'owner', 'invoice.reject': 'owner', 'invoice.issue': 'finance', 'reminder.send': 'finance', 'payment.record': 'finance' };
  const entities = { milestone: 'milestones', invoice: 'invoices', reminder: 'reminders', payment: 'payments' };
  for (const log of state.logs) {
    owned(log, log.id); date(log.demoDate, `${log.id}.demoDate`); check(timestamp(log.at), `${log.id}: invalid timestamp`);
    check(['success', 'failure', 'denied', 'info'].includes(log.result), `${log.id}: invalid log result`);
    if (log.role !== 'system') actor(log.actor, log.companyId, log.role, log.id);
    if (log.result === 'success' && roles[log.action]) check(log.role === roles[log.action], `${log.id}: successful action has wrong role`);
    if (entities[log.entityType]) {
      const entity = maps[entities[log.entityType]].get(log.entityId);
      const companyId = log.entityType === 'milestone' ? maps.projects.get(entity?.projectId)?.companyId : entity?.companyId;
      check(companyId === log.companyId, `${log.id}: log entity company mismatch`);
    } else check(log.entityType === 'system' && log.entityId === null, `${log.id}: unknown log entity`);
  }
  return errors;
}
