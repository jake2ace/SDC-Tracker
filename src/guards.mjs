import { requireCondition } from './errors.mjs';

export function requireRole(actor, roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  requireCondition(allowed.includes(actor.role), 'FORBIDDEN', 'This role cannot perform the requested action.');
}

export function findInvoice(state, actor, id) {
  const invoice = state.invoices.find(item => item.id === id && item.companyId === actor.companyId);
  requireCondition(invoice, 'NOT_FOUND', 'Invoice not found.');
  return invoice;
}

// A shared guard for the issuance handler in Issue #3, not an execution endpoint.
// That handler must authorize finance and reconcile idempotent receipts first.
export function requireApprovedInvoice(invoice) {
  requireCondition(invoice.status === 'approved' && invoice.approval?.role === 'owner',
    'INVALID_STATE', 'An owner-approved invoice is required before issuance.');
  return invoice;
}
