import { h } from '../dom.js';
import { L } from '../i18n.js';
import {
  M, D, DL, badge, invoiceBadge, milestoneBadge, sliceView, errorBlock, goodBlock, emptyBlock,
  loadingBlock, logRow, roleName, personFor, flashFor,
} from './ui.js';

function overdueMap(s) {
  const map = new Map();
  for (const item of s.collections.unpaid.data?.items ?? []) map.set(item.invoice.id, item.overdueDays);
  return map;
}

function pickInvoice(s, projects) {
  const all = projects.flatMap(p => p.invoices);
  const chosen = s.ui.selectedInvoice && all.find(inv => inv.id === s.ui.selectedInvoice);
  if (chosen) return chosen;
  const order = ['pending_approval', 'approved', 'issued', 'rejected', 'paid'];
  return [...all].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.draftedAt.localeCompare(a.draftedAt))[0] ?? null;
}

function milestoneTable(ctx, project, overdue, selectedId) {
  const s = ctx.store.state;
  const rows = project.milestones.slice().sort((a, b) => a.seq - b.seq).map(m => {
    const invoice = project.invoices.find(inv => inv.milestoneId === m.id);
    const busy = s.busy.has(`complete:${m.id}`);
    const action = m.status === 'pending'
      ? h('button', { type: 'button', class: 'btn sm', disabled: busy || s.busy.has('switch'),
        onClick: e => { e.stopPropagation(); ctx.store.actions.completeMilestone(m.id); } },
      busy ? L('Saving...', '保存中...') : L('Mark done', '标为完成'))
      : null;
    const selectable = Boolean(invoice);
    return h('tr', {
      class: [invoice && invoice.id === selectedId ? 'sel' : '', selectable ? 'clickable' : ''],
      tabindex: selectable ? '0' : null,
      'aria-selected': selectable ? String(invoice.id === selectedId) : null,
      onClick: selectable ? () => { s.ui.selectedInvoice = invoice.id; ctx.later(() => ctx.store.ensureDetail(invoice.id)); ctx.store.emit(); } : null,
      onKeydown: selectable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } : null,
    },
    h('td', `M${m.seq} ${m.name}`),
    h('td', { class: 'num' }, M(m.paymentTerm.amount)),
    h('td', { class: 'hide-sm' }, L(`${m.paymentTerm.netDays} days`, `${m.paymentTerm.netDays} 天`)),
    h('td', milestoneBadge(m, invoice, overdue.get(invoice?.id) ?? 0)),
    h('td', { class: 'right' }, action));
  });
  const flashes = project.milestones.map(m => flashFor(ctx, `ms:${m.id}`, f => f.type === 'draftCreated'
    ? goodBlock(L('Draft invoice created.', '已生成发票草稿。'),
      L(`${M(f.data.invoice.amount)} for ${f.data.milestone.name}. It now waits for the owner.`, `${f.data.milestone.name}，${M(f.data.invoice.amount)}，等待老板批准。`))
    : goodBlock(L('Same draft returned.', '返回的是同一张草稿。'),
      L('This milestone already had a draft, so no second invoice was created.', '这个阶段已经有草稿，没有生成第二张发票。'))));
  return h('div', { class: 'panel' },
    h('div', { class: 'row between' },
      h('h3', project.name),
      h('span', { class: 'muted' }, L(`${project.client.name} · Contract ${M(project.contractTotal)}`, `${project.client.name} · 合同 ${M(project.contractTotal)}`))),
    h('div', { class: 'table-wrap' }, h('table', { class: 'mt10' },
      h('thead', h('tr',
        h('th', L('Milestone', '阶段')), h('th', { class: 'num' }, L('Amount', '金额')),
        h('th', { class: 'hide-sm' }, L('Terms', '账期')), h('th', L('Status', '状态')), h('th'))),
      h('tbody', rows))),
    flashes,
    h('p', { class: 'note' }, L('Only the PM can mark a milestone done. Doing it again returns the same draft, not a new one.',
      '只有项目经理能把阶段标为完成。同一个阶段再点一次，拿到的还是同一张草稿。')));
}

function invoiceTitle(invoice) {
  if (['issued', 'paid'].includes(invoice.status)) return L(`Invoice ${invoice.invoiceNo}`, `发票 ${invoice.invoiceNo}`);
  return L(`Draft invoice, ${invoice.basis.milestoneName}`, `发票草稿，${invoice.basis.milestoneName}`);
}

function detailPanel(ctx, invoice, project, overdue) {
  const s = ctx.store.state;
  const session = s.session.data;
  const id = invoice.id;
  const kv = [
    [L('Client', '客户'), project.client.name],
    [L('Amount', '金额'), h('b', M(invoice.amount))],
    [L('Based on', '依据'), invoice.basis.termNote],
    [L('Drafted', '草稿日期'), DL(invoice.draftedAt)],
  ];
  if (['issued', 'paid'].includes(invoice.status)) {
    kv.push([L('Issued', '开票日期'), DL(invoice.issuedAt)]);
    kv.push([L('Due', '到期日'), DL(invoice.dueDate)]);
  } else {
    kv.push([L('Expected due', '预计到期'), L(`${DL(invoice.expectedDueDate)}, final date set when issued`, `${DL(invoice.expectedDueDate)}，以实际开票日为准`)]);
  }
  if (invoice.approval) {
    kv.push([invoice.status === 'rejected' ? L('Rejected by', '驳回人') : L('Approved by', '批准人'), invoice.approval.by]);
  }
  if (invoice.status === 'paid') kv.push([L('Paid', '收款日期'), DL(invoice.paidAt)]);

  const actions = [];
  const busyAny = ['approve', 'reject', 'issue'].some(a => s.busy.has(`${a}:${id}`)) || s.busy.has('switch');
  const flash = flashFor(ctx, `inv:${id}`, f => {
    switch (f.type) {
      case 'approved': return goodBlock(L('Approved.', '已批准。'), L('Finance can issue it now.', '财务现在可以开票。'));
      case 'issued': return goodBlock(L('Issued (simulated).', '模拟开票成功。'),
        L(`${f.data.receipt.invoiceNo}, issued ${D(f.data.receipt.issuedAt)}, due ${D(f.data.receipt.dueDate)}.`,
          `${f.data.receipt.invoiceNo}，${D(f.data.receipt.issuedAt)}开出，${D(f.data.receipt.dueDate)}到期。`));
      case 'issueReplay': return goodBlock(L('Same invoice returned.', '返回的是同一张发票。'),
        L(`${f.data.receipt.invoiceNo} again, from the saved receipt. No second invoice.`, `还是 ${f.data.receipt.invoiceNo}，取自已保存的回执，没有第二张。`));
      default: return null;
    }
  });

  if (invoice.status === 'pending_approval') {
    const reasons = s.ui.rejectReasons ?? (s.ui.rejectReasons = new Map());
    const reasonId = `reason-${id}`;
    actions.push(
      h('label', { for: reasonId, class: 'field-label' }, L('Reason, needed if you reject', '驳回原因（驳回时需要填写）')),
      h('input', { id: reasonId, class: 'text', maxlength: '500', autocomplete: 'off', value: reasons.get(id) ?? '',
        onInput: e => reasons.set(id, e.target.value) }),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', disabled: busyAny, onClick: () => ctx.store.actions.approve(id) },
          s.busy.has(`approve:${id}`) ? L('Approving...', '批准中...') : L('Approve', '批准')),
        h('button', { type: 'button', class: 'btn danger', disabled: busyAny, onClick: () => {
          const reason = (reasons.get(id) ?? '').trim();
          if (!reason) { ctx.store.state.flash.set(`inv:${id}`, { kind: 'local', text: L('Write a short reason before rejecting.', '驳回前请写一句原因。') }); ctx.store.emit(); document.getElementById(reasonId)?.focus(); return; }
          ctx.store.actions.reject(id, reason);
        } }, s.busy.has(`reject:${id}`) ? L('Rejecting...', '驳回中...') : L('Reject', '驳回')),
        h('span', { class: 'hint' }, L('Only the owner can do this', '只有老板可以操作'))));
  } else if (invoice.status === 'approved') {
    if (invoice.lastIssueError && !s.flash.get(`inv:${id}`)) {
      actions.push(h('div', { class: 'msg bad' }, h('b', L('The last attempt did not issue the invoice.', '上一次没有开出发票。')), ' ',
        L(`Attempts so far: ${invoice.issueAttempts}. Retrying uses the same request ID.`, `已尝试 ${invoice.issueAttempts} 次。重试会用同一个请求编号。`)));
    }
    actions.push(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', disabled: busyAny, onClick: () => ctx.store.actions.issue(id) },
        s.busy.has(`issue:${id}`) ? L('Issuing...', '开票中...') : (invoice.lastIssueError ? L('Retry issuing (simulated)', '重试模拟开票') : L('Issue invoice (simulated)', '模拟开票'))),
      h('span', { class: 'hint' }, L('Only finance can do this', '只有财务可以操作'))));
  } else if (invoice.status === 'rejected') {
    actions.push(h('div', { class: 'msg bad' }, h('b', L('Rejected.', '已驳回。')), ' ',
      L('Reason: ', '原因：'), `\u201c${invoice.approval?.reason ?? ''}\u201d`, ' ', L('Nothing will be issued for this draft.', '这张草稿不会开票。')));
  } else if (invoice.status === 'issued' || invoice.status === 'paid') {
    if (!s.flash.get(`inv:${id}`)) {
      actions.push(goodBlock(L('Issued (simulated).', '模拟开票成功。'),
        L(`${invoice.invoiceNo}, issued ${D(invoice.issuedAt)}, due ${D(invoice.dueDate)}.`, `${invoice.invoiceNo}，${D(invoice.issuedAt)}开出，${D(invoice.dueDate)}到期。`)));
    }
    actions.push(h('div', { class: 'row mt12' },
      h('button', { type: 'button', class: 'btn', onClick: () => ctx.go('collections', { invoiceId: id }) },
        invoice.status === 'paid' ? L('See payment', '查看收款') : L('Go to collections', '去催收')),
      h('button', { type: 'button', class: 'btn quiet', disabled: busyAny, onClick: () => ctx.store.actions.issue(id, true) },
        L('Repeat check: issue again', '重复检查：再开一次'))));
  }

  const milestone = project.milestones.find(m => m.id === invoice.milestoneId);
  const completeAgain = milestone && milestone.status === 'completed'
    ? h('button', { type: 'button', class: 'btn quiet', disabled: s.busy.has(`complete:${milestone.id}`),
      onClick: () => ctx.store.actions.completeMilestone(milestone.id) }, L('Repeat check: mark the milestone done again', '重复检查：再把阶段标为完成'))
    : null;

  const detail = ctx.store.detailSlice(id);
  const history = detail.data
    ? (detail.data.logs.length
      ? h('table', { class: 'mt6' }, h('tbody', detail.data.logs.map(logRow)))
      : h('p', { class: 'muted' }, L('No activity yet.', '还没有记录。')))
    : detail.status === 'error'
      ? errorBlock(detail.error, { ctx, onRetry: () => ctx.store.refreshAll() })
      : loadingBlock();

  return h('div', { class: 'panel' },
    h('div', { class: 'row between' }, h('h3', invoiceTitle(invoice)), invoiceBadge(invoice, overdue.get(id) ?? 0)),
    h('dl', { class: 'kv' }, kv.flatMap(([k, v]) => [h('dt', k), h('dd', v)])),
    flash,
    actions,
    h('h3', { class: 'section' }, L('History', '记录')),
    history,
    completeAgain ? h('div', { class: 'mt12' }, completeAgain) : null,
    h('p', { class: 'note' }, L(`You are acting as ${session.user.name} (${roleName(session.user.role)}). The backend checks the role on every click, so a blocked attempt is logged and changes nothing.`,
      `当前身份：${session.user.name}（${roleName(session.user.role)}）。后端每次都会检查角色，被拦下的操作会记日志，不会改动数据。`)));
}

export function renderInvoicing(ctx) {
  const s = ctx.store.state;
  const head = h('div', { class: 'page-head' }, h('div',
    h('h1', { class: 'page' }, L('Projects & invoicing', '项目与开票')),
    h('p', { class: 'sub' }, L('When a milestone is done, a draft invoice is built from its payment terms. Finance can only issue it after the owner approves.',
      '阶段完成后会按付款约定生成发票草稿。老板批准之后，财务才能开票。'))));

  const body = sliceView(s.projects, {
    ctx,
    render: data => {
      const projects = data.projects;
      if (!projects.length) return emptyBlock(L('This company has no projects yet.', '这家公司还没有项目。'));
      const overdue = overdueMap(s);
      const selected = pickInvoice(s, projects);
      // Keep a fresh selection (e.g. a draft that was just created) until the reload brings it in.
      if (selected && (!s.ui.selectedInvoice || s.projects.status === 'ready')) s.ui.selectedInvoice = selected.id;
      if (selected) ctx.later(() => ctx.store.ensureDetail(selected.id));
      const project = selected ? projects.find(p => p.id === selected.projectId) : null;
      const pm = personFor(s.session.data, 'pm');
      return h('div', { class: 'grid split' },
        h('div', { class: 'grid' }, projects.map(p => milestoneTable(ctx, p, overdue, selected?.id))),
        selected && project
          ? detailPanel(ctx, selected, project, overdue)
          : h('div', { class: 'panel' }, h('h3', L('No invoice yet', '还没有发票')),
            emptyBlock(L(`When ${pm?.name ?? 'the PM'} marks a milestone done, its draft invoice shows up here for the owner to review.`,
              `${pm?.name ?? '项目经理'}把阶段标为完成后，草稿会出现在这里等老板审核。`))));
    },
  });
  return [head, body];
}
