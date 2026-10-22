import { h } from '../dom.js';
import { L, plural } from '../i18n.js';
import { forecastKey } from '../state.js';
import { M, D, DL, sliceView, logRow, loadingBlock, errorBlock } from './ui.js';

function focusItem(projects) {
  const all = projects.flatMap(p => p.invoices.map(inv => ({ inv, project: p, ms: p.milestones.find(m => m.id === inv.milestoneId) })));
  const open = all.filter(x => !['paid', 'rejected'].includes(x.inv.status)).sort((a, b) => b.inv.draftedAt.localeCompare(a.inv.draftedAt));
  if (open[0]) return open[0];
  const paid = all.filter(x => x.inv.status === 'paid').sort((a, b) => b.inv.paidAt.localeCompare(a.inv.paidAt))[0];
  if (paid) return paid;
  const pending = projects.flatMap(p => p.milestones.filter(m => m.status === 'pending').map(ms => ({ inv: null, project: p, ms })))
    .sort((a, b) => a.ms.plannedDate.localeCompare(b.ms.plannedDate));
  return pending[0] ?? null;
}

function flowPanel(ctx, projects) {
  const s = ctx.store.state;
  const f = focusItem(projects);
  if (!f) return h('div', { class: 'panel' }, h('h3', L('Nothing in progress', '没有进行中的项目')));
  const { inv, project, ms } = f;
  const demoDate = s.session.data.settings.demoDate;
  const item = inv && (s.collections.unpaid.data?.items ?? []).concat(s.collections.paid.data?.items ?? []).find(x => x.invoice.id === inv.id);
  const sent = item ? item.reminders.filter(r => r.status === 'sent').length : null;
  const step = (state, n, title, small) => h('li', { class: state }, h('span', { class: 'n' }, String(n)), h('div', h('span', title), small ? h('small', small) : null));

  const issued = inv && ['issued', 'paid'].includes(inv.status);
  const paid = inv?.status === 'paid';
  const overdue = inv?.status === 'issued' && inv.dueDate < demoDate;
  const steps = [
    step(ms.status === 'completed' ? 'done' : 'now', 1, L('Milestone done', '阶段完成'),
      ms.status === 'completed' ? L(`${D(ms.completedAt)}, ${ms.completedBy}`, `${D(ms.completedAt)}，${ms.completedBy}`) : L(`Planned for ${D(ms.plannedDate)}`, `计划 ${D(ms.plannedDate)}`)),
    step(issued ? 'done' : inv?.status === 'rejected' ? 'bad' : inv ? 'now' : '', 2, L('Approved and invoiced', '批准并开票'),
      issued ? L(`${inv.approval?.by ?? ''} approved, ${inv.invoiceNo}`, `${inv.approval?.by ?? ''} 批准，${inv.invoiceNo}`)
        : inv?.status === 'pending_approval' ? L('Waiting for the owner', '等待老板批准')
          : inv?.status === 'approved' ? L(`${inv.approval?.by} approved, waiting for finance to issue`, `${inv.approval?.by} 已批准，等财务开票`)
            : inv?.status === 'rejected' ? L(`Rejected: ${inv.approval?.reason ?? ''}`, `已驳回：${inv.approval?.reason ?? ''}`) : null),
    step(paid ? 'done' : overdue ? 'now' : '', 3, L('Follow up', '跟进逾期'),
      issued ? L(`Due ${D(inv.dueDate)}${overdue && item ? `, ${item.overdueDays} ${plural(item.overdueDays, 'day', 'days')} late` : overdue ? ', overdue' : ''}${sent !== null ? `, ${sent} ${plural(sent, 'reminder', 'reminders')} sent` : ''}`,
        `${D(inv.dueDate)}到期${overdue && item ? `，逾期 ${item.overdueDays} 天` : overdue ? '，已逾期' : ''}${sent !== null ? `，已发 ${sent} 封提醒` : ''}`) : null),
    step(paid ? 'done' : '', 4, L('Record payment', '记录收款'),
      paid ? L(`Received ${D(inv.paidAt)}`, `${D(inv.paidAt)}到账`) : L('Reminders stop after this', '之后自动停止提醒')),
    step(paid ? 'done' : '', 5, L('Forecast updates', '更新预测'), L('The actual receipt replaces the expected one', '实际收款替换预计收款，不会算两次')),
  ];
  return h('div', { class: 'panel' },
    h('h3', `${project.name}, M${ms.seq} ${ms.name}`),
    h('ol', { class: 'flow' }, steps));
}

function summary(ctx, ov, late, company) {
  const s = ctx.store.state;
  const unpaidCount = (s.invoices.data?.invoices ?? []).filter(i => i.status === 'issued').length;
  const parts = [];
  if (ov.unpaidAmount > 0) {
    parts.push(L(`${company.name} is waiting on ${M(ov.unpaidAmount)} from ${unpaidCount} issued ${plural(unpaidCount, 'invoice', 'invoices')}`,
      `${company.name} 有 ${unpaidCount} 张已开发票共 ${M(ov.unpaidAmount)} 还没收到`)
      + (ov.overdueAmount > 0
        ? L(`, and ${M(ov.overdueAmount)} of that is overdue.`, `，其中 ${M(ov.overdueAmount)} 已逾期。`)
        : L('. None of it is overdue yet.', '，目前都还没逾期。')));
  } else {
    parts.push(L(`${company.name} has no issued invoices waiting for payment.`, `${company.name} 没有等待付款的已开发票。`));
  }
  if (ov.pendingApprovalCount > 0) {
    parts.push(L(`${ov.pendingApprovalCount} draft ${plural(ov.pendingApprovalCount, 'invoice is', 'invoices are')} waiting for the owner.`,
      `有 ${ov.pendingApprovalCount} 张发票草稿等老板批准。`));
  }
  if (late) {
    const sm = late.summary;
    parts.push(sm.firstBreachDate
      ? L(`If clients pay after the 30-day window, cash falls to ${M(sm.minBalance)} on ${D(sm.minDate)}, ${M(sm.maxGapToSafety)} under the safety line.`,
        `如果客户在 30 天窗口之后才付款，现金会在 ${D(sm.minDate)} 跌到 ${M(sm.minBalance)}，比安全线低 ${M(sm.maxGapToSafety)}。`)
      : L(`Even if clients pay after the window, cash stays above the ${M(late.safetyLine)} safety line.`,
        `即使客户晚于窗口付款，现金也一直高于 ${M(late.safetyLine)} 的安全线。`));
  }
  return h('div', { class: 'story-line' }, parts.map(p => h('p', p)));
}

function figures(ctx, ov, late) {
  const s = ctx.store.state;
  const unpaid = (s.invoices.data?.invoices ?? []).filter(i => i.status === 'issued');
  const overdueItems = s.collections.overdue.data?.items ?? [];
  const fig = (page, opts, label, value, hint, neg) => h('a', { class: 'fig', href: `#/${page}`,
    onClick: e => { e.preventDefault(); ctx.go(page, opts); } },
  h('div', { class: 'label' }, label), h('div', { class: ['value', neg ? 'neg' : ''] }, value), h('div', { class: 'hint' }, hint));
  const overdueHint = ov.overdueCount === 0 ? L('Nothing overdue', '没有逾期')
    : overdueItems.length === 1
      ? L(`${overdueItems[0].invoice.invoiceNo}, ${overdueItems[0].overdueDays} ${plural(overdueItems[0].overdueDays, 'day', 'days')} late`,
        `${overdueItems[0].invoice.invoiceNo}，逾期 ${overdueItems[0].overdueDays} 天`)
      : L(`${ov.overdueCount} ${plural(ov.overdueCount, 'invoice', 'invoices')} overdue`, `${ov.overdueCount} 张发票逾期`);
  const sm = late?.summary;
  return h('div', { class: 'figures' },
    fig('collections', { filter: 'unpaid' }, L('Outstanding', '待收款'), M(ov.unpaidAmount),
      L(`${unpaid.length} ${plural(unpaid.length, 'invoice', 'invoices')} unpaid`, `${unpaid.length} 张发票未付`)),
    fig('collections', { filter: 'overdue' }, L('Overdue', '已逾期'), M(ov.overdueAmount), overdueHint),
    fig('invoicing', null, L('Awaiting approval', '等待批准'), String(ov.pendingApprovalCount),
      ov.pendingIssueAmount ? L(`${M(ov.pendingIssueAmount)} not issued yet`, `${M(ov.pendingIssueAmount)} 还没开票`) : L('Handled by the owner', '由老板处理')),
    sm
      ? fig('cashflow', { scenario: 'beyond_window' }, L('Lowest cash if paid late', '现金最低点（若晚付款）'), M(sm.minBalance),
        sm.maxGapToSafety ? L(`${D(sm.minDate)}, ${M(sm.maxGapToSafety)} under safety line`, `${D(sm.minDate)}，低于安全线 ${M(sm.maxGapToSafety)}`)
          : L('Stays above the safety line', '一直高于安全线'), sm.minBalance < 0)
      : fig('cashflow', null, L('Lowest cash if paid late', '现金最低点（若晚付款）'), '...', L('Loading', '加载中')));
}

export function renderOverview(ctx) {
  const s = ctx.store.state;
  const session = s.session.data;
  const lateSl = ctx.store.forecastSlice(forecastKey('fixed', 'late', 'beyond_window'));
  const head = h('div', { class: 'page-head' }, h('div',
    h('h1', { class: 'page' }, L('Overview', '总览')),
    h('p', { class: 'sub' }, session
      ? L(`Where things stand on ${DL(session.settings.demoDate)}. Click a number to open the list behind it.`,
        `${DL(session.settings.demoDate)}的情况。点数字可以打开对应列表。`)
      : '')));
  const body = sliceView(s.overview, {
    ctx,
    render: ov => [
      summary(ctx, ov, lateSl.data, session.company),
      figures(ctx, ov, lateSl.data),
      lateSl.status === 'error' && !lateSl.data ? errorBlock(lateSl.error, { ctx, onRetry: () => ctx.store.refreshAll() }) : null,
      h('div', { class: 'grid split mt16' },
        s.projects.data ? flowPanel(ctx, s.projects.data.projects) : loadingBlock(),
        h('div', { class: 'panel' },
          h('h3', L('Recent activity', '最近操作')),
          sliceView(s.activity, {
            ctx,
            render: data => data.logs.length
              ? h('table', { class: 'mt6' }, h('tbody', data.logs.slice(0, 8).map(logRow)))
              : h('p', { class: 'muted' }, L('Nothing has happened yet.', '还没有操作记录。')),
          }))),
    ],
  });
  return [head, body];
}
