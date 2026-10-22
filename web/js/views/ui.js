import { h } from '../dom.js';
import { L, getLang } from '../i18n.js';
import { ringgit, shortDate, longDate, addDaysIso } from '../format.js';
import { ACTION_ROLE } from '../state.js';

export const M = (sen, opts) => ringgit(sen, opts);
export const D = date => shortDate(date, getLang());
export const DL = date => longDate(date, getLang());

export function roleName(role) {
  return { pm: L('PM', '项目经理'), owner: L('Owner', '老板'), finance: L('Finance', '财务') }[role] ?? role;
}

export function personFor(session, role) {
  return session?.users?.find(u => u.companyId === session.company.id && u.role === role) ?? null;
}

export function badge(kind, text) {
  return h('span', { class: `status st-${kind}` }, text);
}

export function invoiceBadge(invoice, overdueDays = 0) {
  switch (invoice?.status) {
    case 'pending_approval': return badge('warn', L('Awaiting approval', '等待批准'));
    case 'approved': return badge('warn', L('Approved, not issued', '已批准，待开票'));
    case 'rejected': return badge('bad', L('Rejected', '已驳回'));
    case 'issued': return overdueDays > 0
      ? badge('bad', L(`${overdueDays} ${overdueDays === 1 ? 'day' : 'days'} late`, `逾期 ${overdueDays} 天`))
      : badge('info', L('Issued, unpaid', '已开票，未付'));
    case 'paid': return badge('good', L('Paid', '已收款'));
    default: return badge('info', invoice?.status ?? '');
  }
}

export function milestoneBadge(milestone, invoice, overdueDays) {
  if (milestone.settledBeforeDemo) return badge('good', L('Paid', '已收款'));
  if (milestone.status === 'pending') return badge('info', L('In progress', '进行中'));
  if (!invoice) return badge('info', L('Done', '已完成'));
  return invoiceBadge(invoice, overdueDays);
}

export function loadingBlock(text = L('Loading...', '加载中...')) {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

export function emptyBlock(...lines) {
  return h('div', { class: 'empty' }, ...lines.map(line => h('p', line)));
}

function technical(err) {
  const rows = [
    [L('Code', '代码'), err.code],
    err.status ? [L('HTTP status', 'HTTP 状态'), String(err.status)] : null,
    err.requestId ? [L('Request ID', '请求编号'), err.requestId] : null,
    // Server messages are partly Chinese. Kept for debugging, folded away in the English UI.
    err.message && err.message !== err.code ? [L('Server message', '后端信息'), err.message] : null,
  ].filter(Boolean);
  return h('details', { class: 'tech' }, h('summary', L('Technical details', '技术细节')),
    h('dl', ...rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)])));
}

const ACTION_TEXT = {
  complete: () => L('mark a milestone done', '把阶段标为完成'),
  approve: () => L('approve invoices', '批准发票'),
  reject: () => L('reject invoices', '驳回发票'),
  issue: () => L('issue invoices', '开票'),
  generate: () => L('draft reminders', '生成提醒'),
  edit: () => L('edit reminders', '修改提醒'),
  send: () => L('send reminders', '发送提醒'),
  payment: () => L('record payments', '登记收款'),
};

export function describeError(err, action, ctx) {
  const base = ctx?.config?.apiBase ?? '';
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const role = ctx?.store?.role();
  switch (err?.code) {
    case 'NETWORK':
      return {
        title: L('Can’t reach the backend.', '连不上后端。'),
        body: L(`Check that it is running at ${base} and was started with CORS_ORIGINS=${origin}. Then retry.`,
          `确认后端在 ${base} 运行，并且启动时 CORS_ORIGINS=${origin}，然后重试。`),
      };
    case 'UNAUTHENTICATED':
      return { title: L('The backend didn’t accept this demo identity.', '后端不认这个演示身份。'),
        body: L('Pick a person in the demo bar and try again.', '在演示栏重新选一个身份再试。') };
    case 'FORBIDDEN': {
      const needed = ACTION_ROLE[action];
      const who = needed ? personFor(ctx?.store?.state.session.data, needed) : null;
      return {
        title: L('Blocked by the backend.', '被后端拦下了。'),
        body: L(`A ${roleName(role)} can’t ${ACTION_TEXT[action]?.() ?? 'do this'}. Nothing changed.`,
          `${roleName(role)}不能${ACTION_TEXT[action]?.() ?? '执行这个操作'}，数据没有变化。`),
        switchTo: who,
      };
    }
    case 'NOT_FOUND':
      return { title: L('Record not found for this company.', '本公司找不到这条记录。'),
        body: L('It may belong to the other company, or the demo was reset. The page has been refreshed.',
          '它可能属于另一家公司，或者演示数据已重置。页面已刷新。') };
    case 'INVALID_STATE':
      return { title: L('That can’t be done in the current state.', '当前状态下不能这样操作。'),
        body: L('Someone may have already done it, or the record moved on. The page now shows the latest state.',
          '可能已经有人处理过，或者记录状态已变。页面已更新为最新状态。') };
    case 'DRAFT_CHANGED':
      return { title: L('The reminder changed. Nothing was sent.', '提醒内容已变化，没有发送。'),
        body: L('The message or recipient changed after you opened the confirmation. Review the refreshed draft and confirm again.',
          '确认框打开后，文案或收件人发生了变化。请重新检查刷新后的草稿，再次确认。') };
    case 'VALIDATION_ERROR':
      if (err.details?.earliestDate) {
        return { title: L('The demo date can’t go back that far.', '演示日期不能往回调这么多。'),
          body: L(`There is already a business event on ${DL(err.details.earliestDate)}. Pick that day or later.`,
            `${DL(err.details.earliestDate)} 已经有业务记录，请选这一天或之后。`) };
      }
      return { title: L('The backend rejected the input.', '后端拒绝了输入内容。'),
        body: L('Check the field and try again. Plain text only, no < or > characters.', '检查输入后再试。只能是纯文本，不能有 < 或 >。') };
    case 'UPSTREAM_FAILED':
      if (action === 'issue') {
        return { title: L('The invoice was not issued.', '没有开出发票。'),
          body: L('The mock accounting API failed. Retry is safe: it reuses the same request ID, so you won’t end up with two invoices.',
            '模拟会计接口失败。可以放心重试，会用同一个请求编号，不会变成两张。'), retry: true };
      }
      if (action === 'send') {
        return { title: L('Nothing was sent.', '没有发出去。'),
          body: L('The mock outbox failed. Retry is safe: the same reminder can only go out once.',
            '模拟发件接口失败。可以放心重试，同一封提醒只会发一次。'), retry: true };
      }
      return { title: L('The backend couldn’t finish this request.', '后端没能完成这个请求。'),
        body: L('Nothing was confirmed. Try again.', '没有任何操作被确认，请重试。'), retry: true };
    case 'AI_UNAVAILABLE':
      return {
        title: L('No reminder draft was created.', '没有生成提醒草稿。'),
        body: err.details?.guardrail === 'blocked'
          ? L('The AI output failed the safety check, so it was thrown away. Any earlier draft is unchanged. Nothing was sent.',
            'AI 输出没通过安全检查，已丢弃，之前的草稿保持不变，也没有发送。')
          : L('The AI service is unavailable (missing key, rate limit or provider error). Nothing was sent. Try again in a minute.',
            'AI 服务不可用（缺少密钥、限流或服务商出错），没有发送任何内容，稍后再试。'),
        retry: true,
      };
    default:
      return { title: L('Something went wrong.', '出错了。'), body: L('Nothing was confirmed. Try again.', '没有任何操作被确认，请重试。') };
  }
}

export function errorBlock(err, { action, ctx, onRetry, retryLabel } = {}) {
  const info = describeError(err, action, ctx);
  const buttons = [];
  if (info.switchTo && ctx) {
    buttons.push(h('button', { type: 'button', class: 'btn sm', onClick: () => ctx.store.switchUser(info.switchTo.id) },
      L(`Switch to ${info.switchTo.name} (${roleName(info.switchTo.role)})`, `切换到 ${info.switchTo.name}（${roleName(info.switchTo.role)}）`)));
  }
  if (onRetry) buttons.push(h('button', { type: 'button', class: 'btn sm', onClick: onRetry }, retryLabel ?? L('Retry', '重试')));
  return h('div', { class: 'msg bad', role: 'alert' },
    h('b', info.title), ' ', info.body,
    buttons.length ? h('div', { class: 'row msg-actions' }, buttons) : null,
    technical(err));
}

export function goodBlock(title, body, extra) {
  return h('div', { class: 'msg good', role: 'status' }, h('b', title), body ? ' ' : null, body ?? null, extra ?? null);
}

// Plain-English name for an activity log action.
export function actionName(action) {
  const map = {
    'milestone.complete': L('Mark milestone done', '阶段标为完成'),
    'invoice.approve': L('Approve invoice draft', '批准发票草稿'),
    'invoice.reject': L('Reject invoice draft', '驳回发票草稿'),
    'invoice.issue': L('Issue invoice (simulated)', '模拟开票'),
    'reminder.generate': L('Draft reminder', '生成提醒草稿'),
    'reminder.edit': L('Edit reminder', '修改提醒'),
    'reminder.send': L('Send reminder (simulated)', '模拟发送提醒'),
    'reminder.cancel': L('Cancel unsent reminder after payment', '付款后取消未发提醒'),
    'payment.record': L('Record payment', '登记收款'),
    'collections.view': L('Open collections', '打开催收列表'),
    'demo.settings': L('Change demo settings', '修改演示设置'),
    'api.error': L('API request', '接口请求'),
  };
  return map[action] ?? action;
}

export function resultBadge(result) {
  return {
    success: badge('good', L('Done', '成功')),
    failure: badge('bad', L('Failed', '失败')),
    denied: badge('warn', L('Blocked', '拦截')),
    info: badge('info', L('Info', '信息')),
  }[result] ?? badge('info', result);
}

export function logRow(log) {
  return h('tr',
    h('td', { class: 'hide-sm muted nowrap' }, D(log.demoDate)),
    h('td', resultBadge(log.result)),
    h('td',
      h('span', `${log.actor}: ${actionName(log.action)}`),
      // Raw server text is mostly Chinese, so only show it in the dev language.
      getLang() === 'zh' && log.message ? h('small', { class: 'log-msg' }, log.message) : null));
}

export function sliceView(sl, { render, ctx, onRetry, empty, loadingText }) {
  if (sl.data) {
    return render(sl.data, sl.status === 'loading');
  }
  if (sl.status === 'error') return errorBlock(sl.error, { ctx, onRetry: onRetry ?? (() => ctx.store.refreshAll()) });
  if (sl.status === 'idle' && empty) return empty;
  return loadingBlock(loadingText);
}

// Works out what the demo story needs next, from backend data only.
export function nextStep(ctx) {
  const s = ctx.store.state;
  const session = s.session.data;
  const projects = s.projects.data?.projects;
  if (!session || !projects) return null;
  const demoDate = session.settings.demoDate;
  const invoices = projects.flatMap(p => p.invoices.map(inv => ({ inv, project: p, milestone: p.milestones.find(m => m.id === inv.milestoneId) })));
  const open = invoices.filter(x => !['paid', 'rejected'].includes(x.inv.status))
    .sort((a, b) => b.inv.draftedAt.localeCompare(a.inv.draftedAt));
  const pendingMs = projects.flatMap(p => p.milestones.filter(m => m.status === 'pending').map(m => ({ m, project: p })))
    .sort((a, b) => a.m.plannedDate.localeCompare(b.m.plannedDate));
  const person = role => personFor(session, role);
  const collectItems = s.collections.overdue.data?.items ?? [];

  const focus = open[0];
  if (!focus) {
    const paid = invoices.filter(x => x.inv.status === 'paid').sort((a, b) => b.inv.paidAt.localeCompare(a.inv.paidAt))[0];
    if (paid && (!pendingMs[0] || paid.inv.paidAt >= demoDate)) {
      return { kind: 'done', role: null, page: 'cashflow',
        text: L(`${paid.inv.invoiceNo} was paid on ${D(paid.inv.paidAt)}. Reminders stopped and the forecast now counts it as received.`,
          `${paid.inv.invoiceNo} 已于 ${D(paid.inv.paidAt)} 收款，提醒已停止，预测把它算作实际到账。`),
        cta: L('See cash flow', '看现金流') };
    }
    const next = pendingMs[0];
    if (!next) return null;
    return { kind: 'todo', role: 'pm', page: 'invoicing', who: person('pm'),
      text: L(`${(person('pm')?.name ?? '')} (PM) marks "${next.m.name}" on ${next.project.name} as done. That builds the invoice draft.`,
        `${(person('pm')?.name ?? '')}（项目经理）把 ${next.project.name} 的「${next.m.name}」标为完成，系统据此生成发票草稿。`) };
  }
  const { inv, milestone } = focus;
  const what = `${milestone?.name ?? ''}, ${M(inv.amount)}`;
  switch (inv.status) {
    case 'pending_approval':
      return { kind: 'todo', role: 'owner', page: 'invoicing', who: person('owner'), invoiceId: inv.id,
        text: L(`${(person('owner')?.name ?? '')} (owner) reviews the draft invoice for ${what}.`,
          `${(person('owner')?.name ?? '')}（老板）审核发票草稿：${what}。`) };
    case 'approved':
      return { kind: 'todo', role: 'finance', page: 'invoicing', who: person('finance'), invoiceId: inv.id,
        text: L(`${(person('finance')?.name ?? '')} (finance) issues the approved invoice for ${what}. Issuing is simulated.`,
          `${(person('finance')?.name ?? '')}（财务）为已批准的发票开票：${what}。开票是模拟的。`) };
    case 'issued': {
      if (inv.dueDate >= demoDate) {
        const jump = addDaysIso(inv.dueDate, 3);
        return { kind: 'wait', role: null, page: 'collections', invoiceId: inv.id, jumpDate: jump,
          text: L(`${inv.invoiceNo} is due on ${D(inv.dueDate)}. Move the demo date past it to see what happens if the client pays late.`,
            `${inv.invoiceNo} 在 ${D(inv.dueDate)} 到期。把演示日期调到之后，看看客户晚付款会怎样。`) };
      }
      const item = collectItems.find(x => x.invoice.id === inv.id);
      const draft = item?.reminders.find(r => r.status === 'draft');
      const sent = item?.reminders.filter(r => r.status === 'sent').length ?? 0;
      const fin = (person('finance')?.name ?? '');
      const late = item ? item.overdueDays : null;
      const lateText = late ? L(`, ${late} ${late === 1 ? 'day' : 'days'} late`, `，逾期 ${late} 天`) : L(', overdue', '，已逾期');
      if (draft) {
        return { kind: 'todo', role: 'finance', page: 'collections', who: person('finance'), invoiceId: inv.id,
          text: L(`${fin} (finance) checks reminder ${draft.sequence} for ${inv.invoiceNo} and confirms before it goes out.`,
            `${fin}（财务）检查 ${inv.invoiceNo} 的第 ${draft.sequence} 封提醒，确认后才会发出。`) };
      }
      if (sent && item) {
        return { kind: 'todo', role: 'finance', page: 'collections', who: person('finance'), invoiceId: inv.id,
          text: L(`${inv.invoiceNo}${lateText}. ${sent} ${sent === 1 ? 'reminder has' : 'reminders have'} gone out. When the client pays, ${fin} records it here, or drafts the next reminder.`,
            `${inv.invoiceNo}${lateText}，已经发过 ${sent} 封提醒。客户付款后由 ${fin} 登记，或者再起草下一封。`) };
      }
      return { kind: 'todo', role: 'finance', page: 'collections', who: person('finance'), invoiceId: inv.id,
        text: L(`${inv.invoiceNo} for ${M(inv.amount)} is unpaid${lateText}. ${fin} (finance) drafts a reminder to review.`,
          `${inv.invoiceNo}（${M(inv.amount)}）还没付${lateText}。${fin}（财务）起草一封提醒来检查。`) };
    }
    default:
      return null;
  }
}

// Messages that belong to one panel (scope), set by store actions.
export function flashFor(ctx, scope, describe) {
  const f = ctx.store.state.flash.get(scope);
  if (!f) return null;
  if (f.kind === 'bad') return errorBlock(f.error, { action: f.action, ctx });
  if (f.kind === 'local') return h('div', { class: 'msg bad', role: 'alert' }, f.text);
  return describe ? describe(f) : null;
}
