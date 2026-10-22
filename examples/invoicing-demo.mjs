import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addDays } from '../contracts/validate.mjs';
import { createInvoicingService } from '../src/invoicing/service.mjs';

// CLI only: no persistence, authentication or HTTP server. Every writer shares this queue.
function createMemoryStore(initialState) {
  let state = structuredClone(initialState);
  let queue = Promise.resolve();
  return {
    read: () => queue.then(() => structuredClone(state)),
    transaction(fn) {
      const work = queue.then(() => {
        const draft = structuredClone(state);
        const result = fn(draft);
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(() => {});
          throw new TypeError('Transaction callbacks must be synchronous');
        }
        const output = structuredClone(result);
        const committed = structuredClone(draft);
        state = committed; // Normal returns, including HTTP errors, commit; throws roll back.
        return output;
      });
      queue = work.then(() => undefined, () => undefined);
      return work;
    },
  };
}

const seed = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));
const company = seed.companies.find(row => row.id === seed.settings.companyId);
const projectIds = new Set(seed.projects.filter(row => row.companyId === company.id).map(row => row.id));
const milestone = seed.milestones.find(row => projectIds.has(row.projectId)
  && row.status === 'pending' && row.plannedDate === seed.settings.demoDate);
assert.ok(milestone, 'The seed must contain a pending milestone for the demo date');
const userFor = role => {
  const user = seed.users.find(row => row.companyId === company.id && row.role === role);
  assert.ok(user, `Missing seed user: ${role}`);
  return user;
};
const pm = userFor('pm');
const owner = userFor('owner');
const finance = userFor('finance');
const store = createMemoryStore(seed);
let clockDate = seed.settings.demoDate;
const now = () => new Date(`${clockDate}T12:00:00+08:00`);
const service = createInvoicingService({ store, now });
const money = sen => `RM ${(sen / 100).toLocaleString('en-MY', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

console.log('Issue #3 本地演示｜合成数据、模拟开票；关闭后不保存。');
console.log(`1. ${company.name}：${milestone.name}，付款约定 ${money(milestone.paymentTerm.amount)}。`);

const completed = await service.completeMilestone(pm.id, milestone.id);
assert.equal(completed.status, 201);
assert.equal(completed.body.invoice.amount, milestone.paymentTerm.amount);
assert.equal(completed.body.invoice.netDays, milestone.paymentTerm.netDays);
const invoiceId = completed.body.invoice.id;
console.log(`2. PM 完成阶段 → 待审批草稿，预计到期 ${completed.body.invoice.expectedDueDate}。`);

const denied = await service.issueInvoice(finance.id, invoiceId);
assert.equal(denied.status, 409);
console.log(`3. 尚未批准便开票 → ${denied.status}，拒绝执行。`);

// Explicit Issue #2 approval fixture, NOT an approval API or authentication implementation.
await store.transaction(state => {
  const invoice = state.invoices.find(row => row.id === invoiceId);
  assert.equal(invoice.companyId, owner.companyId);
  assert.equal(invoice.status, 'pending_approval');
  invoice.status = 'approved';
  invoice.approval = { by: owner.name, role: owner.role, at: now().toISOString() };
  state.seq += 1;
  state.logs.push({
    id: `log_cli_approval_${state.seq}`, companyId: owner.companyId,
    at: now().toISOString(), demoDate: state.settings.demoDate,
    actor: owner.name, role: owner.role, action: 'invoice.approve',
    entityType: 'invoice', entityId: invoiceId, result: 'success',
    message: 'CLI 演示：Issue #2 审批占位 fixture；并非调用审批接口。',
  });
});
console.log('4. 【#2 审批占位 fixture】写入同公司 Owner 的批准记录。');

clockDate = addDays(seed.settings.demoDate, 2);
await store.transaction(state => {
  state.settings.demoDate = clockDate;
  state.settings.failNext.accounting = true;
});
const failed = await service.issueInvoice(finance.id, invoiceId);
assert.equal(failed.status, 502);
const afterFailure = await store.read();
const failedInvoice = afterFailure.invoices.find(row => row.id === invoiceId);
assert.equal(failedInvoice.status, 'approved');
assert.equal(failedInvoice.issueAttempts, 1);
assert.ok(failedInvoice.lastIssueError);
assert.equal(afterFailure.settings.failNext.accounting, false);
console.log(`5. ${clockDate} 首次模拟开票 → ${failed.status}；保留错误，可重试。`);

const issued = await service.issueInvoice(finance.id, invoiceId);
assert.equal(issued.status, 200);
assert.equal(issued.body.invoice.dueDate, addDays(clockDate, milestone.paymentTerm.netDays));
assert.equal(issued.body.receipt.simulation, true);
console.log(`6. 重试 → ${issued.status}，${issued.body.receipt.invoiceNo}，${money(issued.body.invoice.amount)}。`);
console.log(`   实际开票 ${issued.body.invoice.issuedAt} + ${issued.body.invoice.netDays} 天 → 到期 ${issued.body.invoice.dueDate}。`);

const repeated = await service.issueInvoice(finance.id, invoiceId);
assert.equal(repeated.status, 200);
assert.deepEqual(repeated.body.receipt, issued.body.receipt);
assert.equal(repeated.body.invoice.issueAttempts, 2);
const finalState = await store.read();
assert.equal(finalState.mockAccounting.filter(row => row.requestId === issued.body.receipt.requestId).length, 1);
console.log(`7. 再次点击 → ${repeated.status}，返回同一回执；实际尝试 ${repeated.body.invoice.issueAttempts} 次、仅 1 张发票。`);
console.log('演示检查全部通过。');
