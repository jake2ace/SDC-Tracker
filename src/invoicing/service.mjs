import { addDays, isDate } from '../../contracts/validate.mjs';
import { simulateAccounting } from './accounting.mjs';

const STATUS = {
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403,
  NOT_FOUND: 404, INVALID_STATE: 409, UPSTREAM_FAILED: 502,
};
const INVOICE_STATUSES = new Set(['pending_approval', 'approved', 'rejected', 'issued', 'paid']);
const ok = (body, status = 200) => ({ status, body: structuredClone(body) });
const error = (code, message, details = {}) => ({ status: STATUS[code], body: { error: { code, message, details } } });
const unauthenticated = () => error('UNAUTHENTICATED', '请先选择有效的演示身份。');
const notFound = () => error('NOT_FOUND', '未找到记录。');
const record = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const emptyBody = body => record(body) && Object.keys(body).length === 0;

function nextId(state, prefix) {
  const collections = ['companies', 'users', 'clients', 'projects', 'milestones',
    'invoices', 'payments', 'reminders', 'expenses', 'logs'];
  let id;
  do {
    if (!Number.isSafeInteger(state.seq) || state.seq >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Invalid state sequence');
    }
    state.seq += 1;
    id = `${prefix}_${state.seq}`;
  } while (collections.some(name => state[name].some(row => row.id === id)));
  return id;
}

function findUser(state, id) {
  const user = state.users.find(row => typeof id === 'string' && row.id === id);
  return user && ['pm', 'owner', 'finance'].includes(user.role)
    && state.companies.some(company => company.id === user.companyId) ? user : null;
}

function ownedInvoice(state, user, id) {
  const invoice = state.invoices.find(row => row.id === id && row.companyId === user.companyId);
  if (!invoice) return null;
  const project = state.projects.find(row => row.id === invoice.projectId && row.companyId === user.companyId);
  const milestone = state.milestones.find(row => row.id === invoice.milestoneId && row.projectId === project?.id);
  const client = state.clients.find(row => row.id === invoice.clientId && row.companyId === user.companyId);
  return project && milestone && client ? invoice : null;
}

function validTerms(amount, netDays, date) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(netDays) || netDays < 0 || !isDate(date)) return false;
  try { return isDate(addDays(date, netDays)); } catch { return false; }
}

function validApproval(state, invoice) {
  const approval = invoice.approval;
  return approval?.role === 'owner' && typeof approval.at === 'string'
    && isDate(approval.at.slice(0, 10))
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:[0-5]\d)$/.test(approval.at)
    && Number.isFinite(Date.parse(approval.at))
    && state.users.some(user => user.companyId === invoice.companyId
      && user.role === 'owner' && user.name === approval.by);
}

function validReceipt(receipt, invoice) {
  return receipt?.requestId === invoice.issueRequestId && receipt.simulation === true
    && typeof receipt.invoiceNo === 'string' && receipt.invoiceNo.length > 0
    && isDate(receipt.issuedAt) && isDate(receipt.dueDate)
    && receipt.dueDate === addDays(receipt.issuedAt, invoice.netDays);
}

/**
 * Issue #3 business logic. The caller supplies an authenticated user ID, never a body field.
 *
 * store.read(): detached DemoState snapshot (or Promise of it).
 * store.transaction(fn): runs the synchronous fn exactly once under a database write lock;
 * commits all state changes on return, rolls back on throw, and resolves AFTER commit.
 * A returned 4xx/502 is a normal return: denial/failure logs must also be committed.
 * The lock must cover ALL writers, including Issue #2 approvals and demo controls.
 * Only synthetic accounting runs inside this transaction; no network calls are made.
 */
export function createInvoicingService({ store, now = () => new Date() }) {
  if (!store || typeof store.read !== 'function' || typeof store.transaction !== 'function') {
    throw new TypeError('An atomic read/transaction store is required');
  }

  function log(state, user, action, entityType, entityId, result, message) {
    state.logs.push({
      id: nextId(state, 'log'), companyId: user.companyId, at: now().toISOString(),
      demoDate: state.settings.demoDate, actor: user.name, role: user.role,
      action, entityType, entityId, result, message,
    });
  }

  function deny(state, user, role, action, type, id) {
    if (user.role === role) return null;
    log(state, user, action, type, id, 'denied', '当前角色无权执行此操作。');
    return error('FORBIDDEN', '当前角色无权执行此操作。');
  }

  function invalidState(state, user, action, type, id, message) {
    log(state, user, action, type, id, 'denied', message);
    return error('INVALID_STATE', message);
  }

  async function readFor(userId, callback) {
    const state = await store.read();
    const user = findUser(state, userId);
    return user ? callback(state, user) : unauthenticated();
  }

  // Clone returned values so API consumers cannot mutate live transaction-owned data.
  async function writeFor(userId, body, callback) {
    return store.transaction(state => {
      const user = findUser(state, userId);
      if (!user) return unauthenticated();
      if (!emptyBody(body)) return error('VALIDATION_ERROR', '此操作不接受业务字段，请提交空对象。');
      return callback(state, user);
    });
  }

  return {
    async listProjects(userId) {
      return readFor(userId, (state, user) => ok({
        projects: state.projects.filter(project => project.companyId === user.companyId).map(project => ({
          ...project,
          client: state.clients.find(client => client.id === project.clientId && client.companyId === user.companyId),
          milestones: state.milestones.filter(milestone => milestone.projectId === project.id),
          invoices: state.invoices.filter(invoice => invoice.projectId === project.id && invoice.companyId === user.companyId),
        })),
      }));
    },

    async listInvoices(userId, query = {}) {
      return readFor(userId, (state, user) => {
        if (!record(query)
          || Object.keys(query).some(key => key !== 'status')
          || (Object.hasOwn(query, 'status') && !INVOICE_STATUSES.has(query.status))) {
          return error('VALIDATION_ERROR', '发票状态筛选无效。');
        }
        return ok({ invoices: state.invoices.filter(invoice => invoice.companyId === user.companyId
          && (!Object.hasOwn(query, 'status') || invoice.status === query.status)) });
      });
    },

    async getInvoice(userId, id) {
      return readFor(userId, (state, user) => {
        const invoice = ownedInvoice(state, user, id);
        if (!invoice) return notFound();
        return ok({ invoice, logs: state.logs.filter(row => row.companyId === user.companyId
          && ((row.entityType === 'invoice' && row.entityId === invoice.id)
            || (row.entityType === 'milestone' && row.entityId === invoice.milestoneId)))
          .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id)) });
      });
    },

    async completeMilestone(userId, id, body = {}) {
      return writeFor(userId, body, (state, user) => {
        const milestone = state.milestones.find(row => row.id === id);
        const project = state.projects.find(row => row.id === milestone?.projectId && row.companyId === user.companyId);
        const client = state.clients.find(row => row.id === project?.clientId && row.companyId === user.companyId);
        if (!milestone || !project || !client) return notFound();
        const denied = deny(state, user, 'pm', 'milestone.complete', 'milestone', id);
        if (denied) return denied;
        const invalid = message => invalidState(state, user, 'milestone.complete', 'milestone', id, message);
        if (milestone.settledBeforeDemo) return invalid('该阶段已在演示前结清，不能再次开票。');
        const invoices = state.invoices.filter(row => row.milestoneId === id);
        if (invoices.length) {
          const invoice = invoices[0];
          if (invoices.length !== 1 || milestone.status !== 'completed'
            || invoice.companyId !== user.companyId || invoice.projectId !== project.id
            || invoice.clientId !== client.id) return invalid('阶段与发票状态不一致。');
          return ok({ milestone, invoice, created: false });
        }
        if (milestone.status !== 'pending') return invalid('该阶段状态不允许生成草稿。');
        const { amount, netDays, dueFrom, note } = milestone.paymentTerm;
        const demoDate = state.settings.demoDate;
        if (dueFrom !== 'issue_date' || !validTerms(amount, netDays, demoDate)) {
          return invalid('付款金额、账期或演示日期无效。');
        }
        let invoiceId;
        do {
          invoiceId = nextId(state, 'inv');
        } while (state.invoices.some(row => row.issueRequestId === `issue_${invoiceId}`)
          || state.mockAccounting.some(row => row.requestId === `issue_${invoiceId}`));
        const invoice = {
          id: invoiceId, companyId: user.companyId, projectId: project.id,
          milestoneId: id, clientId: client.id, currency: 'MYR', amount, netDays,
          draftedAt: demoDate, expectedDueDate: addDays(demoDate, netDays), status: 'pending_approval',
          basis: { projectName: project.name, milestoneName: milestone.name,
            termNote: note, contractTotal: project.contractTotal },
          approval: null, issueRequestId: `issue_${invoiceId}`, issueAttempts: 0,
          lastIssueError: null, invoiceNo: null, issuedAt: null, dueDate: null, paidAt: null,
        };
        milestone.status = 'completed';
        milestone.completedAt = demoDate;
        milestone.completedBy = user.name;
        state.invoices.push(invoice);
        log(state, user, 'milestone.complete', 'milestone', id, 'success', '阶段完成，已按付款约定生成待审批发票草稿。');
        return ok({ milestone, invoice, created: true }, 201);
      });
    },

    async issueInvoice(userId, id, body = {}) {
      return writeFor(userId, body, (state, user) => {
        const invoice = ownedInvoice(state, user, id);
        if (!invoice) return notFound();
        const denied = deny(state, user, 'finance', 'invoice.issue', 'invoice', id);
        if (denied) return denied;
        const invalid = message => invalidState(state, user, 'invoice.issue', 'invoice', id, message);
        const milestone = state.milestones.find(row => row.id === invoice.milestoneId);
        if (milestone.status !== 'completed' || milestone.settledBeforeDemo
          || state.invoices.filter(row => row.milestoneId === invoice.milestoneId).length !== 1) {
          return invalid('只有已完成且未历史结清的阶段可以开票，同一阶段只能有一张发票。');
        }
        if (!validTerms(invoice.amount, invoice.netDays, state.settings.demoDate)
          || !isDate(invoice.draftedAt) || state.settings.demoDate < invoice.draftedAt
          || invoice.currency !== 'MYR' || !validApproval(state, invoice)) {
          return invalid('发票付款约定、日期或审批记录无效。');
        }
        const receipts = state.mockAccounting.filter(row => row.requestId === invoice.issueRequestId);
        if (receipts.length > 1) return invalid('开票回执不唯一，请检查数据。');
        const existing = receipts[0];
        if (['issued', 'paid'].includes(invoice.status)) {
          if (!validReceipt(existing, invoice) || existing.invoiceNo !== invoice.invoiceNo
            || existing.issuedAt !== invoice.issuedAt || existing.dueDate !== invoice.dueDate) {
            return invalid('已开票记录缺少匹配的模拟回执。');
          }
          return ok({ invoice, receipt: existing });
        }
        if (invoice.status !== 'approved') return invalid('发票必须经人工批准后才能模拟开票。');
        if (existing && (!validReceipt(existing, invoice) || existing.issuedAt < invoice.draftedAt
          || existing.issuedAt > state.settings.demoDate)) return invalid('已有模拟回执与发票不匹配。');
        if (typeof invoice.issueRequestId !== 'string' || !invoice.issueRequestId
          || state.invoices.some(row => row.id !== id && row.issueRequestId === invoice.issueRequestId)
          || !Number.isSafeInteger(invoice.issueAttempts) || invoice.issueAttempts < 0
          || invoice.issueAttempts >= Number.MAX_SAFE_INTEGER) return invalid('开票请求标识或次数无效。');

        // Permission and approval are checked before looking up/replaying the idempotency key.
        // Existing receipts recover an interrupted local write without issuing a second invoice.
        if (!existing) invoice.issueAttempts += 1;
        const result = simulateAccounting(state, invoice);
        if (result.error) {
          invoice.lastIssueError = result.error;
          log(state, user, 'invoice.issue', 'invoice', id, 'failure', result.error);
          return error('UPSTREAM_FAILED', result.error, { retryable: true, invoiceId: id });
        }
        const { receipt } = result;
        invoice.status = 'issued';
        invoice.invoiceNo = receipt.invoiceNo;
        invoice.issuedAt = receipt.issuedAt;
        invoice.dueDate = receipt.dueDate;
        invoice.lastIssueError = null;
        log(state, user, 'invoice.issue', 'invoice', id, 'success', `模拟开票成功：${receipt.invoiceNo}。`);
        return ok({ invoice, receipt });
      });
    },
  };
}
