import { h } from '../dom.js';
import { L } from '../i18n.js';
import {
  M, D, DL, badge, invoiceBadge, sliceView, errorBlock, goodBlock, emptyBlock, loadingBlock,
  logRow, personFor, roleName, flashFor,
} from './ui.js';

const FILTERS = [
  ['overdue', () => L('Overdue', '已逾期')],
  ['unpaid', () => L('All unpaid', '全部未付')],
  ['paid', () => L('Paid', '已付')],
];

function tabs(ctx) {
  const s = ctx.store.state;
  return h('div', { class: 'tabs', role: 'group', 'aria-label': L('Filter', '筛选') },
    FILTERS.map(([key, label]) => {
      const sl = s.collections[key];
      const count = sl.data ? sl.data.items.length : null;
      return h('button', { type: 'button', 'aria-pressed': String(s.ui.filter === key),
        onClick: () => { s.ui.filter = key; s.ui.selectedCollection = null; ctx.store.emit(); } },
      label(), count === null ? '' : ` ${count}`);
    }));
}

function pick(s, items) {
  const found = items.find(x => x.invoice.id === s.ui.selectedCollection);
  return found ?? items[0] ?? null;
}

function table(ctx, items, selectedId) {
  const s = ctx.store.state;
  return h('div', { class: 'table-wrap' }, h('table',
    h('thead', h('tr',
      h('th', L('Invoice', '发票')), h('th', L('Client', '客户')), h('th', { class: 'num' }, L('Amount', '金额')),
      h('th', L('Status', '状态')), h('th', { class: 'hide-sm num' }, L('Reminders sent', '已发提醒')))),
    h('tbody', items.map(item => h('tr', {
      class: ['clickable', item.invoice.id === selectedId ? 'sel' : ''],
      tabindex: '0',
      'aria-selected': String(item.invoice.id === selectedId),
      onClick: () => { s.ui.selectedCollection = item.invoice.id; ctx.later(() => ctx.store.ensureDetail(item.invoice.id)); ctx.store.emit(); },
      onKeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } },
    },
    h('td', { class: 'nowrap' }, item.invoice.invoiceNo),
    h('td', item.client.name),
    h('td', { class: 'num' }, M(item.invoice.amount)),
    h('td', invoiceBadge(item.invoice, item.overdueDays)),
    h('td', { class: 'hide-sm num' }, String(item.reminders.filter(r => r.status === 'sent').length)))))));
}

function history(ctx, item) {
  const detail = ctx.store.detailSlice(item.invoice.id);
  const demoDate = ctx.store.state.session.data.settings.demoDate;
  if (!detail.data) {
    return detail.status === 'error' ? errorBlock(detail.error, { ctx, onRetry: () => ctx.store.refreshAll() }) : loadingBlock();
  }
  const logs = detail.data.logs;
  const rows = logs.map(logRow);
  if (item.invoice.status === 'issued' && item.invoice.dueDate < demoDate) {
    // Logs come newest first; slot the due date in where it belongs.
    const at = logs.findIndex(log => log.demoDate <= item.invoice.dueDate);
    rows.splice(at === -1 ? rows.length : at, 0, h('tr',
      h('td', { class: 'hide-sm muted nowrap' }, D(item.invoice.dueDate)),
      h('td', badge('bad', L('Due', '到期'))),
      h('td', L('Due date passed, not paid', '到期，没有收到款'))));
  }
  return rows.length ? h('table', h('tbody', rows)) : h('p', { class: 'muted' }, L('No activity yet.', '还没有记录。'));
}

function reminderList(ctx, item) {
  const done = item.reminders.filter(r => r.status !== 'draft');
  if (!done.length) return null;
  const s = ctx.store.state;
  const lastSent = [...done].reverse().find(r => r.status === 'sent');
  return h('div', { class: 'mt16' },
    h('h3', { class: 'section' }, L('Earlier reminders', '之前的提醒')),
    h('ul', { class: 'rem-list' }, done.map(r => h('li',
      h('div', { class: 'row between' },
        h('span', L(`Reminder ${r.sequence}`, `第 ${r.sequence} 封提醒`)),
        r.status === 'sent'
          ? badge('good', L(`Sent by ${r.sentBy} (simulated)`, `由 ${r.sentBy} 模拟发送`))
          : badge('info', L('Cancelled, invoice paid', '已取消，发票已付款'))),
      h('details', h('summary', r.subject), h('pre', { class: 'mail' }, r.body))))),
    lastSent ? h('button', { type: 'button', class: 'btn quiet', disabled: s.busy.has(`send:${lastSent.id}`),
      onClick: () => ctx.store.actions.sendReminder(item.invoice.id, lastSent.id, lastSent.reviewToken, true) },
    L(`Repeat check: send reminder ${lastSent.sequence} again`, `重复检查：再发一次第 ${lastSent.sequence} 封`)) : null);
}

function editor(ctx, item, draft) {
  const s = ctx.store.state;
  const id = draft.id;
  const edits = s.ui.edits;
  const current = edits.get(id) ?? { subject: draft.subject, body: draft.body };
  const dirty = () => {
    const e = edits.get(id);
    return Boolean(e && (e.subject !== draft.subject || e.body !== draft.body));
  };
  const stale = draft.facts.overdueDays !== item.overdueDays;
  const busy = ['edit', 'send'].some(a => s.busy.has(`${a}:${id}`)) || s.busy.has(`generate:${item.invoice.id}`) || s.busy.has('switch');
  const f = draft.facts;

  const subjectId = `subj-${id}`, bodyId = `body-${id}`, saveId = `save-${id}`, sendId = `send-${id}`, dirtyId = `dirty-${id}`;
  // Update the buttons in place while typing, a full re-render would be wasteful.
  const sync = () => {
    const d = dirty();
    const save = document.getElementById(saveId), send = document.getElementById(sendId), note = document.getElementById(dirtyId);
    if (save) save.disabled = busy || !d;
    if (send) send.disabled = busy || d || stale;
    if (note) note.hidden = !d;
  };
  const onInput = () => {
    edits.set(id, { subject: document.getElementById(subjectId).value, body: document.getElementById(bodyId).value });
    sync();
  };

  const confirmSend = async () => {
    // Capture the version shown in this dialog, never a refreshed version after approval.
    const reviewToken = draft.reviewToken;
    const ok = await ctx.confirm({
      title: L('Send this reminder? (simulated)', '确认发送这封提醒？（模拟）'),
      body: [
        h('dl', { class: 'kv tight' },
          h('dt', L('To', '收件人')), h('dd', `${item.client.contactName} <${item.client.email}>`),
          h('dt', L('Subject', '主题')), h('dd', draft.subject)),
        h('pre', { class: 'mail' }, draft.body),
        h('p', { class: 'note' }, L('This is a simulation. The message goes to a mock outbox, no real email is sent.',
          '这是模拟发送，邮件只进入模拟发件箱，不会真的发出。')),
      ],
      confirmLabel: L('Send (simulated)', '确认并模拟发送'),
    });
    if (ok) ctx.store.actions.sendReminder(item.invoice.id, id, reviewToken);
  };

  const regenerate = async () => {
    if (dirty()) {
      const ok = await ctx.confirm({ title: L('Discard your edits?', '放弃修改？'),
        body: [h('p', L('Regenerating replaces the text with a new draft.', '重新生成会用新草稿替换当前文字。'))],
        confirmLabel: L('Discard and regenerate', '放弃并重新生成') });
      if (!ok) return;
    }
    edits.delete(id);
    ctx.store.actions.generateReminder(item.invoice.id, true);
  };

  return [
    h('p', { class: 'note tight' },
      draft.source === 'ai'
        ? L('AI picked the wording from an approved phrase list. Amounts and dates come from the records, not the AI.',
          'AI 只从审核过的话术里挑选措辞，金额和日期取自系统记录。')
        : draft.source === 'manual_template'
          ? L('Manual template selected. No AI was used. Review and edit it before confirming.', '已选择人工备用模板，没有使用 AI。请检查、修改后再确认。')
          : L('Sample template text, not written by AI.', '示例模板文案，不是 AI 生成。'),
      ' ',
      L(`Facts used: ${f.invoiceNo}, ${M(f.amount)}, due ${DL(f.dueDate)}, ${f.overdueDays} ${f.overdueDays === 1 ? 'day' : 'days'} late, ${f.previousReminders} earlier ${f.previousReminders === 1 ? 'reminder' : 'reminders'}.`,
        `用到的事实：${f.invoiceNo}，${M(f.amount)}，${DL(f.dueDate)}到期，逾期 ${f.overdueDays} 天，之前提醒过 ${f.previousReminders} 次。`)),
    stale ? h('div', { class: 'msg warn' }, h('b', L('This draft is out of date.', '这份草稿已过时。')), ' ',
      L(`It was written when the invoice was ${f.overdueDays} days late, now it is ${item.overdueDays}. Regenerate before sending.`,
        `写草稿时逾期 ${f.overdueDays} 天，现在是 ${item.overdueDays} 天，发送前请重新生成。`)) : null,
    draft.lastSendError && !s.flash.get(`col:${item.invoice.id}`)
      ? h('div', { class: 'msg bad' }, h('b', L('The last send attempt failed.', '上一次发送失败。')), ' ', L('Nothing was sent. You can retry.', '没有发出去，可以重试。'))
      : null,
    h('label', { for: subjectId, class: 'field-label' }, L('Subject', '主题')),
    h('input', { id: subjectId, class: 'text', maxlength: '200', value: current.subject, disabled: busy, onInput }),
    h('label', { for: bodyId, class: 'field-label' }, L('Message to the client', '发给客户的内容')),
    h('textarea', { id: bodyId, maxlength: '4000', disabled: busy, onInput, spellcheck: 'true' }, current.body),
    h('div', { class: 'row mt12' },
      h('button', { id: sendId, type: 'button', class: 'btn primary', disabled: busy || dirty() || stale, onClick: confirmSend },
        s.busy.has(`send:${id}`) ? L('Sending...', '发送中...') : L('Confirm and send (simulated)', '确认并模拟发送')),
      h('button', { id: saveId, type: 'button', class: 'btn', disabled: busy || !dirty(),
        onClick: () => { const e = edits.get(id); if (e) ctx.store.actions.saveReminder(item.invoice.id, id, e.subject, e.body); } },
      s.busy.has(`edit:${id}`) ? L('Saving...', '保存中...') : L('Save edits', '保存修改')),
      h('button', { type: 'button', class: 'btn', disabled: busy, onClick: regenerate },
        s.busy.has(`generate:${item.invoice.id}`) ? L('Generating...', '生成中...') : L('Regenerate', '重新生成'))),
    h('p', { id: dirtyId, class: 'hint mt6', hidden: !dirty() }, L('Save your edits first, so what gets sent is exactly what you see.', '先保存修改，确保发出去的就是你看到的内容。')),
  ];
}

function paymentBlock(ctx, item) {
  const s = ctx.store.state;
  const id = item.invoice.id;
  const demoDate = s.session.data.settings.demoDate;
  const dates = s.ui.payDates ?? (s.ui.payDates = new Map());
  const inputId = `paid-${id}`;
  const busy = s.busy.has(`payment:${id}`) || s.busy.has('switch');
  const record = async () => {
    const date = document.getElementById(inputId)?.value || demoDate;
    const ok = await ctx.confirm({
      title: L('Record this payment?', '确认登记收款？'),
      body: [h('p', L(`${M(item.invoice.amount)} from ${item.client.name} for ${item.invoice.invoiceNo}, received on ${DL(date)}.`,
        `${item.client.name} 支付 ${item.invoice.invoiceNo}，${M(item.invoice.amount)}，${DL(date)}到账。`)),
      h('p', { class: 'note' }, L('Any reminder that hasn’t gone out will be cancelled, and the forecast will count this as received.',
        '还没发出的提醒会被取消，预测会把这笔算作实际到账。'))],
      confirmLabel: L('Record payment', '登记收款'),
    });
    if (ok) ctx.store.actions.recordPayment(id, date);
  };
  return h('div', { class: 'pay-box' },
    h('h3', { class: 'section' }, L('Record payment', '登记收款')),
    h('div', { class: 'row' },
      h('label', { for: inputId, class: 'field-label inline' }, L('Received on', '到账日期')),
      h('input', { id: inputId, type: 'date', class: 'date', value: dates.get(id) ?? demoDate, min: item.invoice.issuedAt, max: demoDate,
        disabled: busy, onInput: e => dates.set(id, e.target.value) }),
      h('button', { type: 'button', class: 'btn', disabled: busy, onClick: record },
        busy ? L('Recording...', '登记中...') : L(`Record full payment of ${M(item.invoice.amount)}`, `登记全额收款 ${M(item.invoice.amount)}`))),
    h('p', { class: 'hint' }, L('Only finance can do this. The date can’t be later than the demo date.', '只有财务可以操作，日期不能晚于演示日期。')));
}

function workspace(ctx, item) {
  const s = ctx.store.state;
  const inv = item.invoice;
  const draft = item.reminders.find(r => r.status === 'draft');
  const sentCount = item.reminders.filter(r => r.status === 'sent').length;
  const flash = flashFor(ctx, `col:${inv.id}`, f => {
    switch (f.type) {
      case 'templateReady':
        return goodBlock(L('Editable template ready.', '可编辑模板已准备好。'),
          L('No AI was used and nothing was sent. Review the text before confirming.', '没有使用 AI，也没有发送。请检查文案后再确认。'));
      case 'generated':
      case 'regenerated':
        return goodBlock(L('Draft ready.', '草稿已生成。'), L('Read it, edit if needed, then confirm. Nothing has been sent.', '检查、按需修改后再确认，目前什么都没发。'));
      case 'saved': return goodBlock(L('Edits saved.', '修改已保存。'), L('Still not sent.', '还没有发送。'));
      case 'sent': return goodBlock(L('Simulated send succeeded.', '模拟发送成功。'),
        L(`To ${f.data.outbox.to}. Mock outbox record ${f.data.outbox.requestId}.`,
          `发给 ${f.data.outbox.to}。模拟发件记录 ${f.data.outbox.requestId}。`));
      case 'sendReplay': return goodBlock(L('Already sent.', '已经发过了。'),
        L('The backend returned the same send record. Nothing went out twice.', '后端返回同一条发件记录，没有重复发送。'));
      case 'paid': return goodBlock(L('Payment recorded.', '收款已登记。'),
        L(`${M(f.data.payment.amount)} received on ${D(f.data.payment.receivedAt)}. ${f.data.cancelledReminders.length} unsent ${f.data.cancelledReminders.length === 1 ? 'reminder was' : 'reminders were'} cancelled. Overview and cash flow are updated.`,
          `${D(f.data.payment.receivedAt)}收到 ${M(f.data.payment.amount)}，取消了 ${f.data.cancelledReminders.length} 封未发的提醒，总览和现金流已更新。`),
        h('div', { class: 'row msg-actions' }, h('button', { type: 'button', class: 'btn sm', onClick: () => ctx.go('cashflow') }, L('See cash flow', '看现金流'))));
      case 'paymentReplay': return goodBlock(L('Same payment returned.', '返回的是同一笔收款。'), L('It was not counted twice.', '没有重复计算。'));
      default: return null;
    }
  });

  let main;
  if (inv.status === 'paid') {
    const justPaid = s.flash.get(`col:${inv.id}`)?.type === 'paid';
    main = [
      justPaid ? null : goodBlock(L(`Paid on ${DL(inv.paidAt)}.`, `${DL(inv.paidAt)}已收款。`), L('Collection has stopped for this invoice.', '这张发票已停止催收。')),
      h('button', { type: 'button', class: 'btn quiet mt6', disabled: s.busy.has(`payment:${inv.id}`),
        onClick: () => ctx.store.actions.recordPayment(inv.id, inv.paidAt, true) }, L('Repeat check: record the same payment again', '重复检查：再登记一次同一笔收款')),
    ];
  } else if (item.overdueDays <= 0) {
    main = [h('p', { class: 'muted' }, L(`Not overdue yet. It is due on ${DL(inv.dueDate)}. Reminders are only for overdue invoices.`,
      `还没逾期，${DL(inv.dueDate)}到期。只有逾期发票才能催收。`)), paymentBlock(ctx, item)];
  } else if (draft) {
    main = [...editor(ctx, item, draft), paymentBlock(ctx, item)];
  } else {
    const busy = s.busy.has(`generate:${inv.id}`) || s.busy.has('switch');
    main = [
      h('p', L(`${inv.invoiceNo} is ${item.overdueDays} ${item.overdueDays === 1 ? 'day' : 'days'} late and has no reminder draft yet.`,
        `${inv.invoiceNo} 已逾期 ${item.overdueDays} 天，还没有提醒草稿。`)),
      h('p', { class: 'note tight' }, L('The AI only picks wording from an approved list. The amount, due date and days late are filled in from the records. Nothing is sent until you confirm.',
        'AI 只从审核过的话术里挑措辞，金额、到期日和逾期天数都取自记录。你确认之前不会发送。')),
      h('div', { class: 'row mt12' }, h('button', { type: 'button', class: 'btn primary', disabled: busy,
        onClick: () => ctx.store.actions.generateReminder(inv.id) },
      busy ? L('Drafting...', '生成中...') : L(`Draft reminder ${sentCount + 1}`, `起草第 ${sentCount + 1} 封提醒`))),
      paymentBlock(ctx, item),
    ];
  }

  return h('div', { class: 'panel' },
    h('div', { class: 'row between' },
      h('h3', draft ? L(`Reminder ${draft.sequence}`, `第 ${draft.sequence} 封提醒`) : `${inv.invoiceNo} · ${item.client.name}`),
      invoiceBadge(inv, item.overdueDays)),
    flash,
    manualTemplateAction(ctx, item, draft),
    main,
    reminderList(ctx, item),
    h('p', { class: 'note' }, L('Reminders only go out after a person confirms. Recording a payment cancels any reminder that hasn’t gone out.',
      '提醒必须有人确认才会发出。登记收款后，没发出的提醒会自动取消。')));
}

function manualTemplateAction(ctx, item, draft) {
  const s = ctx.store.state;
  const failure = s.flash.get(`col:${item.invoice.id}`);
  if (failure?.kind !== 'bad' || failure.error?.code !== 'AI_UNAVAILABLE' ||
      item.invoice.status !== 'issued' || item.overdueDays <= 0) return null;
  const busy = s.busy.has(`generate:${item.invoice.id}`) || s.busy.has('switch') ||
    Boolean(draft && ['edit', 'send'].some(action => s.busy.has(`${action}:${draft.id}`)));
  return h('div', { class: 'row mt12' }, h('button', {
    type: 'button', class: 'btn', disabled: busy,
    onClick: async () => {
      if (draft) {
        const ok = await ctx.confirm({
          title: L('Replace this draft with a manual template?', '用人工模板替换当前草稿？'),
          body: [h('p', L('This replaces the existing draft and any unsaved edits. No AI will be used and nothing will be sent.',
            '这会替换当前草稿及未保存的修改，不会使用 AI，也不会发送。'))],
          confirmLabel: L('Use manual template', '使用人工模板'),
        });
        if (!ok) return;
      }
      ctx.store.actions.useTemplate(item.invoice.id, Boolean(draft));
    },
  }, L('Use editable manual template', '使用可编辑的人工模板')));
}

export function renderCollections(ctx) {
  const s = ctx.store.state;
  const session = s.session.data;
  const allowed = ctx.store.canCollect();
  const head = h('div', { class: 'page-head' },
    h('div',
      h('h1', { class: 'page' }, L('AI collections', 'AI 催收')),
      h('p', { class: 'sub' }, L('Unpaid invoices past their due date. Reminders only mention facts on record, and nothing is sent (simulated) until you confirm.',
        '这里列出没付且已过期的发票。提醒只写系统里有记录的事实，你确认后才会（模拟）发出去。'))),
    allowed ? tabs(ctx) : null);

  if (!session) return [head, loadingBlock()];
  if (!allowed) {
    const fin = personFor(session, 'finance');
    return [head, h('div', { class: 'panel narrow' },
      h('h3', L('Collections are for the owner and finance', '催收只对老板和财务开放')),
      h('p', L(`${session.user.name} is a ${roleName(session.user.role)}, so this list isn’t loaded. The backend would refuse it anyway.`,
        `${session.user.name}是${roleName(session.user.role)}，所以不加载这个列表，后端也会拒绝。`)),
      fin ? h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.store.switchUser(fin.id) },
        L(`Switch to ${fin.name} (Finance)`, `切换到 ${fin.name}（财务）`)) : null)];
  }

  const sl = s.collections[s.ui.filter];
  const body = sliceView(sl, {
    ctx,
    render: data => {
      const items = data.items;
      const selected = pick(s, items);
      if (selected) {
        if (!s.ui.selectedCollection || sl.status === 'ready') s.ui.selectedCollection = selected.invoice.id;
        ctx.later(() => ctx.store.ensureDetail(selected.invoice.id));
      }
      const emptyText = {
        overdue: L(`Nothing is overdue on ${DL(session.settings.demoDate)}. Move the demo date past a due date to see follow ups.`,
          `${DL(session.settings.demoDate)}没有逾期发票。把演示日期调到到期日之后，就能看到催收。`),
        unpaid: L('No issued invoices are waiting for payment.', '没有等待付款的已开发票。'),
        paid: L('No payments recorded yet.', '还没有登记收款。'),
      }[s.ui.filter];
      if (!items.length) return h('div', { class: 'panel narrow' }, emptyBlock(emptyText));
      return h('div', { class: 'grid split' },
        h('div', { class: 'panel' },
          table(ctx, items, selected?.invoice.id),
          selected ? [h('h3', { class: 'section' }, L('History of this invoice', '这张发票的记录')), history(ctx, selected)] : null),
        workspace(ctx, selected));
    },
  });
  return [head, body];
}
