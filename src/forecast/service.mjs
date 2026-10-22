import { isDate } from '../../contracts/validate.mjs';

const DAY = 86_400_000;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const record = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
class ForecastFault extends Error {
  constructor(code, message, status) { super(message); Object.assign(this, { code, status }); }
}
const invalid = () => { throw new ForecastFault('INVALID_STATE', '当前公司的预测数据不完整或不一致，请核对后重试。', 409); };
const requireState = condition => { if (!condition) invalid(); };
const badQuery = () => { throw new ForecastFault('VALIDATION_ERROR', '预测参数无效，只接受约定的模式和延迟情景。', 400); };
const safe = value => { requireState(value >= -MAX && value <= MAX); return Number(value); };
const money = (value, minimum = 1) => requireState(Number.isSafeInteger(value) && value >= minimum);
const label = (value, max = 200) => requireState(typeof value === 'string' && value.trim().length > 0
  && value.length <= max && !/[<>\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u.test(value));
const id = value => requireState(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_/-]{0,127}$/.test(value));

function dateAfter(date, days) {
  requireState(isDate(date) && Number.isSafeInteger(days) && days >= 0);
  const timestamp = Date.parse(date) + days * DAY;
  requireState(Number.isFinite(timestamp) && timestamp <= Date.parse('9999-12-31'));
  const result = new Date(timestamp).toISOString().slice(0, 10);
  requireState(isDate(result));
  return result;
}

function parseQuery(query, overview) {
  if (!record(query)) badQuery();
  const keys = Reflect.ownKeys(query);
  if (overview) { if (keys.length) badQuery(); return { mode: 'fixed', scenario: { kind: 'on_time' } }; }
  if (keys.some(key => !['mode', 'scenario', 'delayDays'].includes(key))) badQuery();
  if (Object.hasOwn(query, 'mode') && !['fixed', 'rolling'].includes(query.mode)) badQuery();
  if (Object.hasOwn(query, 'scenario') && !['on_time', 'late'].includes(query.scenario)) badQuery();
  const kind = query.scenario ?? 'on_time';
  if (kind === 'on_time' && Object.hasOwn(query, 'delayDays')) badQuery();
  if (kind === 'late' && ![7, 14, 'beyond_window'].includes(query.delayDays)) badQuery();
  return { mode: query.mode ?? 'fixed', scenario: kind === 'late' ? { kind, delayDays: query.delayDays } : { kind } };
}

function index(rows) {
  const map = new Map();
  for (const row of rows) if (record(row)) map.set(row.id, map.has(row.id) ? null : row);
  return map;
}

// Only the authenticated company's financial graph is consumed. A related row
// with conflicting ownership is an error, never a fallback to another company.
function scope(state, userId) {
  requireState(record(state) && state.schemaVersion === 1);
  for (const key of ['users', 'companies', 'clients', 'projects', 'milestones', 'invoices', 'payments', 'expenses']) {
    requireState(Array.isArray(state[key]));
  }
  const users = state.users.filter(row => record(row) && typeof userId === 'string' && row.id === userId);
  if (users.length !== 1 || !['pm', 'owner', 'finance'].includes(users[0].role)) {
    throw new ForecastFault('UNAUTHENTICATED', '请先选择有效的身份。', 401);
  }
  const user = users[0];
  const maps = Object.fromEntries(['companies', 'clients', 'projects', 'milestones', 'invoices', 'payments', 'expenses']
    .map(key => [key, index(state[key])]));
  const company = maps.companies.get(user.companyId);
  if (!company) throw new ForecastFault('UNAUTHENTICATED', '请先选择有效的身份。', 401);
  id(company.id); label(company.name, 160);
  money(company.openingBalance, Number.MIN_SAFE_INTEGER); money(company.safetyLine, 0);
  requireState(company.currency === 'MYR' && company.forecastDays === 30 && isDate(company.forecastBaseDate)
    && isDate(state.settings?.demoDate));
  const owned = row => record(row) && row.companyId === company.id;
  const projects = state.projects.filter(owned);
  const projectIds = new Set(projects.map(row => row.id));
  const milestones = state.milestones.filter(row => record(row) && projectIds.has(row.projectId));
  const stagesByProject = new Map(projects.map(row => [row.id, []]));
  for (const stage of milestones) stagesByProject.get(stage.projectId).push(stage);
  const milestoneIds = new Set(milestones.map(row => row.id));
  const invoices = state.invoices.filter(row => owned(row)
    || (record(row) && (projectIds.has(row.projectId) || milestoneIds.has(row.milestoneId))));
  const invoiceIds = new Set(invoices.map(row => row.id));
  const payments = state.payments.filter(row => owned(row) || (record(row) && invoiceIds.has(row.invoiceId)));
  const expenses = state.expenses.filter(owned);
  const allIds = new Set([company.id]);
  for (const [name, rows] of Object.entries({ projects, milestones, invoices, payments, expenses })) {
    requireState(rows.length <= 20_000);
    for (const row of rows) {
      id(row.id); requireState(maps[name].get(row.id) === row && !allIds.has(row.id)); allIds.add(row.id);
    }
  }
  for (const project of projects) {
    const client = maps.clients.get(project.clientId);
    requireState(client && owned(client));
    id(client.id); label(client.name, 160); label(project.name); money(project.contractTotal);
    const stages = stagesByProject.get(project.id);
    requireState(stages.length > 0);
    const sequences = new Set();
    let total = 0n;
    for (const stage of stages) {
      label(stage.name); money(stage.paymentTerm?.amount);
      requireState(stage.paymentTerm.dueFrom === 'issue_date' && isDate(stage.plannedDate)
        && Number.isSafeInteger(stage.paymentTerm.netDays) && stage.paymentTerm.netDays >= 0
        && Number.isSafeInteger(stage.seq) && stage.seq > 0 && !sequences.has(stage.seq)
        && ['pending', 'completed'].includes(stage.status)
        && (stage.settledBeforeDemo === undefined || typeof stage.settledBeforeDemo === 'boolean'));
      sequences.add(stage.seq);
      dateAfter(stage.plannedDate, stage.paymentTerm.netDays);
      if (stage.status === 'completed') requireState(isDate(stage.completedAt) && stage.completedAt <= state.settings.demoDate);
      else requireState(stage.completedAt === null && !stage.settledBeforeDemo);
      total += BigInt(stage.paymentTerm.amount);
    }
    requireState(total === BigInt(project.contractTotal));
  }
  const byStage = new Map(), invoiceNumbers = new Set();
  for (const invoice of invoices) {
    const project = maps.projects.get(invoice.projectId), stage = maps.milestones.get(invoice.milestoneId);
    requireState(owned(invoice) && project && owned(project) && stage && stage.projectId === project.id
      && project.clientId === invoice.clientId && stage.status === 'completed' && !stage.settledBeforeDemo
      && !byStage.has(stage.id));
    money(invoice.amount);
    requireState(invoice.currency === 'MYR' && invoice.amount === stage.paymentTerm.amount
      && invoice.netDays === stage.paymentTerm.netDays && isDate(invoice.draftedAt)
      && invoice.draftedAt <= state.settings.demoDate
      && invoice.expectedDueDate === dateAfter(invoice.draftedAt, invoice.netDays)
      && ['pending_approval', 'approved', 'rejected', 'issued', 'paid'].includes(invoice.status));
    if (['issued', 'paid'].includes(invoice.status)) {
      requireState(isDate(invoice.issuedAt) && invoice.issuedAt >= invoice.draftedAt
        && invoice.issuedAt <= state.settings.demoDate && invoice.dueDate === dateAfter(invoice.issuedAt, invoice.netDays));
      label(invoice.invoiceNo, 100);
      requireState(!invoiceNumbers.has(invoice.invoiceNo));
      invoiceNumbers.add(invoice.invoiceNo);
    } else requireState(invoice.issuedAt === null && invoice.dueDate === null && invoice.invoiceNo === null);
    if (invoice.status !== 'paid') requireState(invoice.paidAt === null);
    byStage.set(stage.id, invoice);
  }
  for (const stage of milestones) {
    if (stage.status === 'completed' && !stage.settledBeforeDemo) requireState(byStage.has(stage.id));
  }
  const byInvoice = new Map();
  for (const payment of payments) {
    const invoice = maps.invoices.get(payment.invoiceId);
    requireState(owned(payment) && invoice && owned(invoice) && invoiceIds.has(invoice.id)
      && invoice.status === 'paid' && !byInvoice.has(invoice.id));
    money(payment.amount);
    requireState(payment.amount === invoice.amount && isDate(payment.receivedAt)
      && payment.receivedAt >= invoice.issuedAt && payment.receivedAt <= state.settings.demoDate
      && payment.receivedAt === invoice.paidAt);
    byInvoice.set(invoice.id, payment);
  }
  for (const invoice of invoices) if (invoice.status === 'paid') requireState(byInvoice.has(invoice.id));
  for (const expense of expenses) { money(expense.amount); label(expense.label, 300); requireState(isDate(expense.date)); }
  return { company, projects, milestones, invoices, payments, expenses, maps, byStage, byInvoice, demoDate: state.settings.demoDate };
}

function calculate(view, options) {
  const { company, demoDate, milestones, payments, expenses, maps, byStage, byInvoice } = view;
  const { scenario } = options;
  const baseDate = options.mode === 'fixed' ? company.forecastBaseDate : demoDate;
  requireState(baseDate >= company.forecastBaseDate);
  const endDate = dateAfter(baseDate, 29);
  const inWindow = date => date >= baseDate && date <= endDate;
  const before = date => date >= company.forecastBaseDate && date < baseDate;
  let opening = BigInt(company.openingBalance);
  for (const payment of payments) if (before(payment.receivedAt)) opening += BigInt(payment.amount);
  for (const expense of expenses) if (before(expense.date)) opening -= BigInt(expense.amount);
  const openingBalance = safe(opening), safety = BigInt(company.safetyLine), lines = [];
  for (const stage of milestones) {
    if (stage.settledBeforeDemo) continue;
    const invoice = byStage.get(stage.id), project = maps.projects.get(stage.projectId);
    const originalDate = invoice ? (['issued', 'paid'].includes(invoice.status) ? invoice.dueDate : invoice.expectedDueDate)
      : dateAfter(stage.plannedDate, stage.paymentTerm.netDays);
    const ref = { milestoneName: stage.name, clientName: maps.clients.get(project.clientId).name,
      stage: invoice?.status === 'pending_approval' ? 'draft' : invoice?.status ?? 'planned' };
    if (invoice) Object.assign(ref, { invoiceId: invoice.id, invoiceNo: invoice.invoiceNo });
    if (invoice?.status === 'paid') {
      const payment = byInvoice.get(invoice.id), date = payment.receivedAt;
      lines.push({ id: `actual_${payment.id}`, kind: 'actual_receipt', date, originalDate, amount: payment.amount,
        included: inWindow(date), excludeReason: inWindow(date) ? null : date < baseDate ? 'before_base' : 'after_window',
        assumedToday: false, ref: { ...ref, paymentId: payment.id } });
      continue;
    }
    const amount = invoice?.amount ?? stage.paymentTerm.amount;
    let date = originalDate, assumedToday = false, excludeReason = null;
    if (invoice?.status === 'rejected') excludeReason = 'rejected_draft';
    else {
      if (date < baseDate) { date = baseDate; assumedToday = true; }
      if (scenario.kind === 'late') {
        assumedToday = false;
        if (scenario.delayDays === 'beyond_window') {
          if (date <= endDate) { date = dateAfter(endDate, 1); excludeReason = 'pushed_beyond_window'; }
        } else date = dateAfter(date, scenario.delayDays);
      }
      if (!excludeReason && !inWindow(date)) excludeReason = 'after_window';
    }
    lines.push({ id: `expected_${stage.id}`, kind: 'expected_receipt', date, originalDate, amount,
      included: excludeReason === null, excludeReason, assumedToday, ref });
  }
  for (const expense of expenses) {
    lines.push({ id: `expense_${expense.id}`, kind: 'expense', date: expense.date, originalDate: expense.date,
      amount: -expense.amount, included: inWindow(expense.date),
      excludeReason: inWindow(expense.date) ? null : expense.date < baseDate ? 'before_base' : 'after_window',
      assumedToday: false, ref: { expenseLabel: expense.label } });
  }
  requireState(lines.length <= 10_000);
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const buckets = new Map();
  for (const line of lines) if (line.included) {
    const bucket = buckets.get(line.date) ?? { inflow: 0n, outflow: 0n };
    if (line.amount > 0) bucket.inflow += BigInt(line.amount); else bucket.outflow -= BigInt(line.amount);
    buckets.set(line.date, bucket);
  }
  let balance = opening;
  const days = Array.from({ length: 30 }, (_, n) => {
    const date = dateAfter(baseDate, n), bucket = buckets.get(date) ?? { inflow: 0n, outflow: 0n };
    balance += bucket.inflow - bucket.outflow;
    return { date, inflow: safe(bucket.inflow), outflow: safe(bucket.outflow), balance: safe(balance),
      belowSafety: balance < safety, gapToSafety: safe(balance < safety ? safety - balance : 0n),
      shortfallBelowZero: safe(balance < 0n ? -balance : 0n) };
  });
  const minimum = days.reduce((a, b) => b.balance < a.balance ? b : a);
  const breaches = days.filter(day => day.belowSafety);
  return { baseDate, endDate, days, openingBalance, safetyLine: company.safetyLine, scenario: { ...scenario }, lines,
    summary: { endBalance: days.at(-1).balance, minBalance: minimum.balance, minDate: minimum.date,
      firstBreachDate: breaches[0]?.date ?? null, breachDays: breaches.length,
      maxGapToSafety: Math.max(...days.map(day => day.gapToSafety)),
      maxShortfallBelowZero: Math.max(...days.map(day => day.shortfallBelowZero)) } };
}

/** Read-only, deterministic service. The host supplies a trusted session ID and
 * one consistent snapshot per request; there are no AI, filesystem or network tools. */
export function createForecastService({ store }) {
  if (!store || typeof store.read !== 'function') throw new TypeError('A snapshot store is required');
  async function run(userId, query, overview) {
    try {
      const options = parseQuery(query, overview);
      const view = scope(await store.read(), userId);
      const forecast = calculate(view, options);
      if (!overview) return { status: 200, body: forecast };
      const issued = view.invoices.filter(row => row.status === 'issued');
      const overdue = issued.filter(row => row.dueDate < view.demoDate);
      const total = rows => safe(rows.reduce((sum, row) => sum + BigInt(row.amount), 0n));
      return { status: 200, body: { companyId: view.company.id, demoDate: view.demoDate,
        unpaidAmount: total(issued), overdueAmount: total(overdue), overdueCount: overdue.length,
        pendingApprovalCount: view.invoices.filter(row => row.status === 'pending_approval').length,
        pendingIssueAmount: total(view.invoices.filter(row => ['pending_approval', 'approved'].includes(row.status))),
        forecast: forecast.summary } };
    } catch (failure) {
      if (!(failure instanceof ForecastFault)) throw failure;
      return { status: failure.status, body: { error: { code: failure.code, message: failure.message, details: {} } } };
    }
  }
  return { getForecast: (userId, query = {}) => run(userId, query, false),
    getOverview: (userId, query = {}) => run(userId, query, true) };
}
