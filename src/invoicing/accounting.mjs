import { addDays } from '../../contracts/validate.mjs';

/** A deterministic, transaction-local simulator. It never contacts an accounting provider. */
export function simulateAccounting(state, invoice) {
  const existing = state.mockAccounting.find(row => row.requestId === invoice.issueRequestId);
  if (existing) return { receipt: existing };

  if (state.settings.failNext.accounting) {
    state.settings.failNext.accounting = false;
    return { error: '模拟开票失败，请重试。' };
  }

  const company = state.companies.find(row => row.id === invoice.companyId);
  const issuedAt = state.settings.demoDate;
  const prefix = `${company.code}-${issuedAt.slice(0, 4)}-`;
  const used = new Set([
    ...state.mockAccounting.map(row => row.invoiceNo),
    ...state.invoices.map(row => row.invoiceNo),
  ]);
  let number = 1;
  while (used.has(`${prefix}${String(number).padStart(4, '0')}`)) number += 1;
  const receipt = {
    requestId: invoice.issueRequestId,
    invoiceNo: `${prefix}${String(number).padStart(4, '0')}`,
    issuedAt,
    dueDate: addDays(issuedAt, invoice.netDays),
    simulation: true,
  };
  state.mockAccounting.push(receipt);
  return { receipt };
}
