import { randomUUID } from 'node:crypto';
import { isDate } from '../contracts/validate.mjs';
import { requireCondition, requireObject } from './errors.mjs';
import { findInvoice, requireRole } from './guards.mjs';

export function appendActivity(state, actor, {
  action, result = 'success', entityType = 'system', entityId = null, message
}) {
  const log = {
    id: `log_${randomUUID()}`, companyId: actor.companyId,
    at: new Date().toISOString(), demoDate: state.settings.demoDate,
    actor: actor.name, role: actor.role, action, entityType, entityId, result, message
  };
  state.logs.push(log);
  return log;
}

export function activityFor(state, actor, limit = 50) {
  return state.logs.filter(log => log.companyId === actor.companyId)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id))
    .slice(0, limit);
}

function latestBusinessDate(state) {
  const dates = [
    ...state.milestones.map(item => item.completedAt),
    ...state.invoices.flatMap(item => [item.draftedAt, item.issuedAt, item.paidAt]),
    ...state.payments.map(item => item.receivedAt),
    ...state.logs.filter(item => item.entityType !== 'system').map(item => item.demoDate)
  ].filter(Boolean);
  return dates.sort().at(-1) ?? null;
}

export function updateSettings(state, actor, body) {
  requireObject(body, ['demoDate', 'companyId', 'userId', 'failNext']);
  if (Object.hasOwn(body, 'demoDate')) {
    requireCondition(isDate(body.demoDate), 'VALIDATION_ERROR', 'demoDate must be a valid YYYY-MM-DD date.');
    const earliest = latestBusinessDate(state);
    requireCondition(!earliest || body.demoDate >= earliest, 'VALIDATION_ERROR',
      'demoDate cannot precede an existing business event.', { earliestDate: earliest });
  }
  if (Object.hasOwn(body, 'companyId')) requireCondition(typeof body.companyId === 'string',
    'VALIDATION_ERROR', 'companyId must be a string.');
  if (Object.hasOwn(body, 'userId')) requireCondition(typeof body.userId === 'string',
    'VALIDATION_ERROR', 'userId must be a string.');
  const companyId = body.companyId ?? actor.companyId;
  const userId = body.userId ?? actor.id;
  requireCondition(companyId === actor.companyId || Object.hasOwn(body, 'userId'),
    'VALIDATION_ERROR', 'Switching companies requires a matching userId in the same request.');
  const user = state.users.find(item => item.id === userId);
  requireCondition(user && user.companyId === companyId && state.companies.some(item => item.id === companyId),
    'VALIDATION_ERROR', 'The selected user and company must exist and belong together.');
  if (Object.hasOwn(body, 'failNext')) {
    requireObject(body.failNext, ['accounting', 'outbox']);
    requireCondition(typeof body.failNext.accounting === 'boolean' && typeof body.failNext.outbox === 'boolean',
      'VALIDATION_ERROR', 'failNext must include both accounting and outbox as booleans.');
  }
  state.settings = { ...state.settings, ...body, companyId, userId,
    failNext: body.failNext ? { ...body.failNext } : state.settings.failNext };
  appendActivity(state, actor, { action: 'demo.settings', result: 'info', message: 'Demo settings updated.' });
  return { settings: state.settings };
}

export function decideInvoice(state, actor, id, action, body) {
  const invoice = findInvoice(state, actor, id);
  requireRole(actor, 'owner');
  requireObject(body, action === 'reject' ? ['reason'] : []);
  let reason;
  if (action === 'reject') {
    requireCondition(typeof body.reason === 'string' && body.reason.trim().length >= 1 && body.reason.trim().length <= 500,
      'VALIDATION_ERROR', 'A rejection reason of 1–500 characters is required.');
    reason = body.reason.trim();
  }
  // Authorization and body checks always precede idempotent replay.
  if (action === 'approve' && invoice.status === 'approved') return { invoice };
  if (action === 'reject' && invoice.status === 'rejected' && invoice.approval?.reason === reason) return { invoice };
  requireCondition(invoice.status === 'pending_approval', 'INVALID_STATE', 'Only a pending invoice may receive a new decision.');
  invoice.status = action === 'approve' ? 'approved' : 'rejected';
  invoice.approval = { by: actor.name, role: 'owner', at: new Date().toISOString(), ...(reason ? { reason } : {}) };
  appendActivity(state, actor, {
    action: `invoice.${action}`, entityType: 'invoice', entityId: invoice.id,
    message: action === 'approve' ? 'Invoice approved by its company owner.' : `Invoice rejected: ${reason}`
  });
  return { invoice };
}

export function sessionFor(state, actor) {
  return {
    settings: { ...state.settings, userId: actor.id, companyId: actor.companyId },
    user: actor, company: state.companies.find(item => item.id === actor.companyId),
    // This cross-company list exists only for explicitly enabled synthetic demo controls.
    companies: state.companies, users: state.users
  };
}
