import { isDate } from '../../contracts/validate.mjs';

const STATUSES = { VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403,
  NOT_FOUND: 404, INVALID_STATE: 409, UPSTREAM_FAILED: 502, AI_UNAVAILABLE: 503 };
const reply = (body, status = 200) => ({ status, body: structuredClone(body) });
const error = (code, message, details = {}) => ({ status: STATUSES[code], body: { error: { code, message, details } } });
const record = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fields = (body, names) => record(body) && Object.keys(body).every(key => names.includes(key));
const empty = body => fields(body, []);
const notFound = () => error('NOT_FOUND', '未找到记录。');
const badInput = () => error('VALIDATION_ERROR', '请求字段或格式无效。');
const unauthorized = () => error('UNAUTHENTICATED', '请先选择有效的演示身份。');

function userFor(state, userId) {
  const user = state.users.find(row => typeof userId === 'string' && row.id === userId);
  return user && ['pm', 'owner', 'finance'].includes(user.role)
    && state.companies.some(row => row.id === user.companyId) ? user : null;
}

function invoiceFor(state, user, id) {
  const invoice = state.invoices.find(row => row.id === id && row.companyId === user.companyId);
  if (!invoice) return null;
  const project = state.projects.find(row => row.id === invoice.projectId && row.companyId === user.companyId);
  const client = state.clients.find(row => row.id === invoice.clientId && row.companyId === user.companyId);
  const milestone = state.milestones.find(row => row.id === invoice.milestoneId && row.projectId === project?.id);
  return project && client && milestone && project.clientId === client.id ? { invoice, client } : null;
}

function reminderFor(state, user, id) {
  const reminder = state.reminders.find(row => row.id === id && row.companyId === user.companyId);
  const found = reminder && invoiceFor(state, user, reminder.invoiceId);
  return found ? { reminder, ...found } : null;
}

function nextId(state, prefix) {
  let id;
  do {
    if (!Number.isSafeInteger(state.seq) || state.seq >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid state sequence');
    id = `${prefix}_${++state.seq}`;
  } while (['companies', 'users', 'clients', 'projects', 'milestones', 'invoices', 'payments', 'reminders', 'expenses', 'logs']
    .some(name => state[name].some(row => row.id === id)));
  return id;
}

function overdueDays(invoice, date) {
  return invoice.status === 'issued' && isDate(invoice.dueDate) && isDate(date)
    ? Math.max(0, (Date.parse(date) - Date.parse(invoice.dueDate)) / 86_400_000) : 0;
}

function factsFor(state, invoice) {
  const days = overdueDays(invoice, state.settings.demoDate);
  if (days <= 0 || !Number.isSafeInteger(invoice.amount) || invoice.amount <= 0
    || typeof invoice.invoiceNo !== 'string' || !invoice.invoiceNo || invoice.currency !== 'MYR'
    || state.payments.some(row => row.invoiceId === invoice.id)) return null;
  return { amount: invoice.amount, overdueDays: days, dueDate: invoice.dueDate, invoiceNo: invoice.invoiceNo,
    previousReminders: state.reminders.filter(row => row.invoiceId === invoice.id && row.status === 'sent').length };
}

function content(body) {
  if (!fields(body, ['subject', 'body']) || typeof body.subject !== 'string' || typeof body.body !== 'string') return null;
  const subject = body.subject.trim(), text = body.body.trim();
  if (!subject || subject.length > 200 || !text || text.length > 4000
    || /[<>\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u.test(subject)
    || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u.test(text)) return null;
  return { subject, body: text };
}

const sameFacts = (a, b) => a && b && ['amount', 'overdueDays', 'dueDate', 'invoiceNo', 'previousReminders']
  .every(key => a[key] === b[key]);

/**
 * Uses the same atomic store contract as Issue #3. Authenticated user IDs come
 * from the host session; all writers (including approvals/payments) share a lock.
 * Model calls run OUTSIDE database transactions. Their results are committed
 * only after rechecking facts and any draft that a human may have edited.
 */
export function createCollectionsService({ store, generator, now = () => new Date() }) {
  if (!store || typeof store.read !== 'function' || typeof store.transaction !== 'function'
    || typeof generator !== 'function') throw new TypeError('An atomic store and AI generator are required');

  function log(state, user, action, type, id, result, message) {
    state.logs.push({ id: nextId(state, 'log'), companyId: user.companyId, at: now().toISOString(),
      demoDate: state.settings.demoDate, actor: user.name, role: user.role, action,
      entityType: type, entityId: id, result, message });
  }
  function deny(state, user, action, type, id, roles = ['finance']) {
    if (roles.includes(user.role)) return null;
    log(state, user, action, type, id, 'denied', '当前角色无权执行此操作。');
    return error('FORBIDDEN', '当前角色无权执行此操作。');
  }
  function invalid(state, user, action, type, id, message) {
    log(state, user, action, type, id, 'denied', message);
    return error('INVALID_STATE', message);
  }
  function transaction(userId, callback) {
    return store.transaction(state => {
      const user = userFor(state, userId);
      return user ? callback(state, user) : unauthorized();
    });
  }
  function inputFor(state, found, facts) {
    return { companyName: state.companies.find(row => row.id === found.invoice.companyId).name,
      clientName: found.client.name,
      tone: facts.previousReminders === 0 ? 'gentle' : facts.previousReminders === 1 ? 'firm' : 'final',
      facts };
  }
  function draftFor(state, invoiceId) {
    return state.reminders.filter(row => row.invoiceId === invoiceId && row.status === 'draft');
  }

  return {
    async listCollections(userId, query = {}) {
      return transaction(userId, (state, user) => {
        const denied = deny(state, user, 'collections.view', 'system', null, ['owner', 'finance']);
        if (denied) return denied;
        if (!fields(query, ['filter']) || (Object.hasOwn(query, 'filter')
          && !['overdue', 'unpaid', 'paid'].includes(query.filter))) return badInput();
        const filter = query.filter ?? 'overdue';
        return reply({ items: state.invoices.filter(invoice => invoice.companyId === user.companyId)
          .map(invoice => invoiceFor(state, user, invoice.id)).filter(Boolean)
          .filter(({ invoice }) => filter === 'paid' ? invoice.status === 'paid'
            : filter === 'unpaid' ? invoice.status === 'issued' : overdueDays(invoice, state.settings.demoDate) > 0)
          .map(({ invoice, client }) => ({ invoice, client, overdueDays: overdueDays(invoice, state.settings.demoDate),
            reminders: state.reminders.filter(row => row.companyId === user.companyId && row.invoiceId === invoice.id)
              .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)) })) });
      });
    },

    async generateReminder(userId, invoiceId, body = {}) {
      const prepared = await transaction(userId, (state, user) => {
        if (!fields(body, ['regenerate']) || (Object.hasOwn(body, 'regenerate') && typeof body.regenerate !== 'boolean')) return badInput();
        const found = invoiceFor(state, user, invoiceId);
        if (!found) return notFound();
        const denied = deny(state, user, 'reminder.generate', 'invoice', invoiceId);
        if (denied) return denied;
        const facts = factsFor(state, found.invoice), drafts = draftFor(state, invoiceId);
        if (!facts || drafts.length > 1) return invalid(state, user, 'reminder.generate', 'invoice', invoiceId,
          '只有未付款的逾期发票可以生成提醒，并且最多保留一份草稿。');
        const draft = drafts[0];
        if (draft && !body.regenerate) return reply({ reminder: draft });
        return { input: structuredClone(inputFor(state, found, facts)), draft: draft ? structuredClone(draft) : null };
      });
      if (prepared.status) return prepared;

      let generated, guardrailBlocked = false;
      try {
        generated = content(await generator(structuredClone(prepared.input)));
        guardrailBlocked = !generated;
      } catch (failure) {
        guardrailBlocked = ['AI_INVALID_RESPONSE', 'AI_INVALID_INPUT'].includes(failure?.code);
        // Never propagate provider responses, credentials, or raw model text to the API/log.
      }
      if (!generated) {
        return transaction(userId, (state, user) => {
          if (!invoiceFor(state, user, invoiceId)) return notFound();
          const denied = deny(state, user, 'reminder.generate', 'invoice', invoiceId);
          if (denied) return denied;
          if (guardrailBlocked) {
            const message = 'AI 内容未通过安全检查，未保存新内容，原草稿已保留。';
            log(state, user, 'reminder.generate', 'invoice', invoiceId, 'failure', message);
            return error('AI_UNAVAILABLE', message, { retryable: true, guardrail: 'blocked' });
          }
          log(state, user, 'reminder.generate', 'invoice', invoiceId, 'failure', 'AI 文案生成失败，原草稿已保留。');
          return error('AI_UNAVAILABLE', 'AI 文案生成失败，请检查密钥或稍后重试。', { retryable: true });
        });
      }

      return transaction(userId, (state, user) => {
        const found = invoiceFor(state, user, invoiceId);
        if (!found) return notFound();
        const denied = deny(state, user, 'reminder.generate', 'invoice', invoiceId);
        if (denied) return denied;
        const facts = factsFor(state, found.invoice), drafts = draftFor(state, invoiceId);
        if (!facts || JSON.stringify(inputFor(state, found, facts)) !== JSON.stringify(prepared.input) || drafts.length > 1) {
          return invalid(state, user, 'reminder.generate', 'invoice', invoiceId, '发票、付款或提醒事实已变化，请重新生成。');
        }
        const current = drafts[0];
        if (!prepared.draft && current && !body.regenerate) return reply({ reminder: current });
        if (JSON.stringify(current ?? null) !== JSON.stringify(prepared.draft)) {
          return invalid(state, user, 'reminder.generate', 'invoice', invoiceId, '提醒草稿已由其他操作更新，请重新检查。');
        }
        let reminder = current;
        if (!reminder) {
          let id;
          do { id = nextId(state, 'rem'); }
          while (state.reminders.some(row => row.sendRequestId === `send_${id}`)
            || state.mockOutbox.some(row => row.requestId === `send_${id}`));
          reminder = { id, companyId: user.companyId, invoiceId, status: 'draft',
            sequence: facts.previousReminders + 1, tone: prepared.input.tone,
            ...generated, source: 'ai', facts: structuredClone(facts), createdAt: now().toISOString(),
            createdBy: user.name, editedAt: null, sentAt: null, sentBy: null,
            sendRequestId: `send_${id}`, lastSendError: null, cancelReason: null };
          state.reminders.push(reminder);
        } else {
          Object.assign(reminder, generated, { source: 'ai', facts: structuredClone(facts),
            sequence: facts.previousReminders + 1, tone: prepared.input.tone, editedAt: now().toISOString(), lastSendError: null });
        }
        log(state, user, 'reminder.generate', 'reminder', reminder.id, 'success', 'AI 提醒草稿已生成，等待人工检查与确认。');
        return reply({ reminder }, current ? 200 : 201);
      });
    },

    async editReminder(userId, reminderId, body) {
      return transaction(userId, (state, user) => {
        const text = content(body);
        if (!text) return badInput();
        const found = reminderFor(state, user, reminderId);
        if (!found) return notFound();
        const denied = deny(state, user, 'reminder.edit', 'reminder', reminderId);
        if (denied) return denied;
        if (found.reminder.status !== 'draft' || !factsFor(state, found.invoice)) {
          return invalid(state, user, 'reminder.edit', 'reminder', reminderId, '只有未付逾期发票的草稿可以修改。');
        }
        Object.assign(found.reminder, text, { editedAt: now().toISOString() });
        log(state, user, 'reminder.edit', 'reminder', reminderId, 'success', '提醒文案已由人工修改，尚未发送。');
        return reply({ reminder: found.reminder });
      });
    },

    async sendReminder(userId, reminderId, body = {}) {
      return transaction(userId, (state, user) => {
        if (!empty(body)) return badInput();
        const found = reminderFor(state, user, reminderId);
        if (!found) return notFound();
        const { reminder, invoice, client } = found;
        const denied = deny(state, user, 'reminder.send', 'reminder', reminderId);
        if (denied) return denied;
        const invalidSend = message => invalid(state, user, 'reminder.send', 'reminder', reminderId, message);
        const outboxes = state.mockOutbox.filter(row => row.requestId === reminder.sendRequestId);
        const existing = outboxes[0];
        if (outboxes.length > 1 || !reminder.sendRequestId
          || state.reminders.some(row => row.id !== reminderId && row.sendRequestId === reminder.sendRequestId)) {
          return invalidSend('提醒请求标识或回执不唯一。');
        }
        if (reminder.status === 'sent') {
          if (!existing || existing.simulation !== true || existing.reminderId !== reminder.id
            || existing.to !== client.email || existing.subject !== reminder.subject || existing.sentAt !== reminder.sentAt) {
            return invalidSend('已发送提醒缺少匹配的模拟回执。');
          }
          return reply({ reminder, outbox: existing });
        }
        if (reminder.status !== 'draft' || existing) return invalidSend('该提醒不能发送。');
        const facts = factsFor(state, invoice);
        if (!facts || !sameFacts(facts, reminder.facts) || reminder.sequence !== facts.previousReminders + 1) {
          return invalidSend('发票已付款或事实已变化，请重新生成并人工检查。');
        }
        if (!content({ subject: reminder.subject, body: reminder.body })) return invalidSend('提醒文案格式无效。');
        if (state.settings.failNext.outbox) {
          state.settings.failNext.outbox = false;
          reminder.lastSendError = '模拟发送失败，请重试。';
          log(state, user, 'reminder.send', 'reminder', reminderId, 'failure', reminder.lastSendError);
          return error('UPSTREAM_FAILED', reminder.lastSendError, { retryable: true, reminderId });
        }
        const sentAt = now().toISOString();
        const outbox = { requestId: reminder.sendRequestId, reminderId, to: client.email,
          subject: reminder.subject, sentAt, simulation: true };
        state.mockOutbox.push(outbox);
        Object.assign(reminder, { status: 'sent', sentAt, sentBy: user.name, lastSendError: null });
        log(state, user, 'reminder.send', 'reminder', reminderId, 'success', '人工确认后已模拟发送提醒。');
        return reply({ reminder, outbox });
      });
    },

    async recordPayment(userId, invoiceId, body) {
      return transaction(userId, (state, user) => {
        if (!fields(body, ['receivedAt']) || !isDate(body.receivedAt)) return badInput();
        const found = invoiceFor(state, user, invoiceId);
        if (!found) return notFound();
        const { invoice } = found;
        const denied = deny(state, user, 'payment.record', 'invoice', invoiceId);
        if (denied) return denied;
        const invalidPayment = message => invalid(state, user, 'payment.record', 'invoice', invoiceId, message);
        const payments = state.payments.filter(row => row.invoiceId === invoiceId);
        if (invoice.status === 'paid') {
          const payment = payments[0];
          if (payments.length !== 1 || payment.companyId !== user.companyId || payment.amount !== invoice.amount
            || payment.receivedAt !== body.receivedAt || invoice.paidAt !== body.receivedAt) {
            return invalidPayment('此发票已有不同的收款记录。');
          }
          return reply({ invoice, payment, cancelledReminders: state.reminders.filter(row => row.invoiceId === invoiceId
            && row.companyId === user.companyId && row.status === 'cancelled') });
        }
        if (invoice.status !== 'issued' || payments.length || !Number.isSafeInteger(invoice.amount) || invoice.amount <= 0) {
          return invalidPayment('只有已开票且未收款的发票可以登记全额到账。');
        }
        if (!isDate(invoice.issuedAt) || !isDate(state.settings.demoDate)
          || body.receivedAt < invoice.issuedAt || body.receivedAt > state.settings.demoDate) return badInput();
        const payment = { id: nextId(state, 'pay'), companyId: user.companyId, invoiceId,
          amount: invoice.amount, receivedAt: body.receivedAt, recordedBy: user.name };
        state.payments.push(payment);
        invoice.status = 'paid';
        invoice.paidAt = body.receivedAt;
        const cancelledReminders = state.reminders.filter(row => row.invoiceId === invoiceId
          && row.companyId === user.companyId && row.status === 'draft');
        for (const reminder of cancelledReminders) {
          reminder.status = 'cancelled';
          reminder.cancelReason = '发票已全额付款，停止催收。';
          log(state, user, 'reminder.cancel', 'reminder', reminder.id, 'success', reminder.cancelReason);
        }
        log(state, user, 'payment.record', 'payment', payment.id, 'success', '已登记全额到账，停止催收。');
        return reply({ invoice, payment, cancelledReminders }, 201);
      });
    },
  };
}
