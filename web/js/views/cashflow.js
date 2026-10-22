import { h } from '../dom.js';
import { L } from '../i18n.js';
import { forecastKey, comparableForecasts } from '../state.js';
import { M, D, DL, errorBlock, loadingBlock } from './ui.js';
import { balanceChart } from './chart.js';

export function lateLabel(delay) {
  if (delay === 'beyond_window') return L('Paid after the window', '晚于窗口付款');
  return L(`Paid ${delay} days late`, `晚付 ${delay} 天`);
}

const SCENARIOS = [
  { active: 'on_time', delay: null, label: () => L('Paid on time', '按时付款') },
  { active: 'late', delay: '7', label: () => L('7 days late', '晚 7 天') },
  { active: 'late', delay: '14', label: () => L('14 days late', '晚 14 天') },
  { active: 'late', delay: 'beyond_window', label: () => L('Paid after the window', '晚于窗口付款') },
];

function controls(ctx) {
  const cf = ctx.store.state.ui.cf;
  const set = patch => { Object.assign(cf, patch); ctx.later(() => ctx.store.ensureForecasts()); ctx.store.emit(); };
  return h('div', { class: 'row' },
    h('div', { class: 'tabs', role: 'group', 'aria-label': L('Scenario', '情景') },
      SCENARIOS.map(sc => h('button', {
        type: 'button',
        'aria-pressed': String(sc.active === 'on_time' ? cf.active === 'on_time' : cf.active === 'late' && cf.delay === sc.delay),
        onClick: () => set(sc.active === 'on_time' ? { active: 'on_time' } : { active: 'late', delay: sc.delay }),
      }, sc.label()))),
    h('div', { class: 'tabs', role: 'group', 'aria-label': L('Window', '窗口') },
      h('button', { type: 'button', 'aria-pressed': String(cf.mode === 'fixed'), onClick: () => set({ mode: 'fixed' }) }, L('Fixed case', '固定案例')),
      h('button', { type: 'button', 'aria-pressed': String(cf.mode === 'rolling'), onClick: () => set({ mode: 'rolling' }) }, L('Rolling from demo date', '从演示日期滚动'))));
}

function lineStatus(line) {
  if (!line) return '';
  if (line.included) {
    if (line.kind === 'actual_receipt') return L(`Received ${D(line.date)}`, `${D(line.date)}实际到账`);
    if (line.assumedToday) return L(`Overdue, assumed today ${D(line.date)}`, `已逾期，假设今天 ${D(line.date)} 到账`);
    return L(`Counted on ${D(line.date)}`, `${D(line.date)}计入`);
  }
  switch (line.excludeReason) {
    case 'after_window': return L(`Falls after the window (${D(line.date)})`, `在窗口之外（${D(line.date)}），不计入`);
    case 'pushed_beyond_window': return L('Pushed past the window', '推迟到窗口之外，不计入');
    case 'before_base': return L('Before the window, already in the opening balance', '在窗口之前，已计入期初余额');
    case 'rejected_draft': return L('Rejected draft, not counted', '草稿已驳回，不计入');
    default: return L('Not counted', '不计入');
  }
}

function lineItem(line) {
  const r = line.ref;
  const stage = { planned: L('not invoiced yet', '尚未开票'), draft: L('draft', '草稿'), approved: L('approved', '已批准'),
    rejected: L('rejected', '已驳回'), issued: L('issued', '已开票'), paid: L('paid', '已付') }[r.stage] ?? r.stage;
  if (line.kind === 'expense') return r.expenseLabel;
  const name = r.invoiceNo || r.milestoneName;
  if (line.kind === 'actual_receipt') return L(`${name}, ${r.clientName} payment received`, `${name}，${r.clientName} 实际收款`);
  return L(`${name}, ${r.clientName} expected payment (${stage})`, `${name}，${r.clientName} 预计付款（${stage}）`);
}

function figures(result) {
  const sm = result.summary;
  return h('div', { class: 'figures mb16' },
    h('div', { class: 'fig' }, h('div', { class: 'label' }, L('Opening balance', '期初余额')),
      h('div', { class: ['value', result.openingBalance < 0 ? 'neg' : ''] }, M(result.openingBalance)), h('div', { class: 'hint' }, D(result.baseDate))),
    h('div', { class: 'fig' }, h('div', { class: 'label' }, L('End of window', '窗口结束时')),
      h('div', { class: ['value', sm.endBalance < 0 ? 'neg' : ''] }, M(sm.endBalance)), h('div', { class: 'hint' }, D(result.endDate))),
    h('div', { class: 'fig' }, h('div', { class: 'label' }, L('First day under safety line', '第一次低于安全线')),
      h('div', { class: ['value', sm.firstBreachDate ? 'neg' : ''] }, sm.firstBreachDate ? D(sm.firstBreachDate) : L('None', '无')),
      h('div', { class: 'hint' }, sm.breachDays
        ? L(`${sm.breachDays} ${sm.breachDays === 1 ? 'day' : 'days'} under ${M(result.safetyLine)}`, `共 ${sm.breachDays} 天低于 ${M(result.safetyLine)}`)
        : L(`Safety line ${M(result.safetyLine)}`, `安全线 ${M(result.safetyLine)}`))),
    h('div', { class: 'fig' }, h('div', { class: 'label' }, L('Biggest gap', '最大缺口')),
      h('div', { class: ['value', sm.maxGapToSafety ? 'neg' : ''] }, M(sm.maxGapToSafety)),
      h('div', { class: 'hint' }, sm.maxGapToSafety
        ? (sm.maxShortfallBelowZero
          ? L(`under the safety line; ${M(sm.maxShortfallBelowZero)} under zero`, `低于安全线；低于零 ${M(sm.maxShortfallBelowZero)}`)
          : L('under the safety line; never below zero', '低于安全线；没有低于零'))
        : L('Stays above the safety line', '一直高于安全线'))));
}

function sourcesTable(a, b, labelB) {
  const ids = [...new Set([...a.lines, ...b.lines].map(l => l.id))];
  const byId = (res, id) => res.lines.find(l => l.id === id);
  const rows = ids.map(id => {
    const la = byId(a, id), lb = byId(b, id), any = la ?? lb;
    const shownDate = any.kind === 'expected_receipt' ? any.originalDate : any.date;
    return h('tr',
      h('td', { class: 'nowrap' }, D(shownDate)),
      h('td', lineItem(any)),
      h('td', { class: 'num' }, M(any.amount, { signed: true })),
      h('td', lineStatus(la)),
      h('td', lineStatus(lb)));
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'mt8' },
    h('thead', h('tr', h('th', L('Date', '日期')), h('th', L('Item', '内容')), h('th', { class: 'num' }, L('Amount', '金额')),
      h('th', L('Paid on time', '按时付款')), h('th', labelB))),
    h('tbody',
      h('tr', h('td', { class: 'nowrap' }, D(a.baseDate)), h('td', L('Opening balance', '期初余额')), h('td', { class: 'num' }, M(a.openingBalance)),
        h('td', L('Counted', '计入')), h('td', L('Counted', '计入'))),
      rows)));
}

function dailyTable(a, b, labelB) {
  return h('details', { class: 'daily' },
    h('summary', L('Show all 30 days', '展开 30 天明细')),
    h('div', { class: 'table-wrap', 'data-keep-scroll': 'daily' }, h('table',
      h('thead', h('tr', h('th', L('Date', '日期')),
        h('th', { class: 'num' }, L('In (on time)', '收入（按时）')), h('th', { class: 'num' }, L('Out', '支出')),
        h('th', { class: 'num' }, L('Balance, on time', '余额，按时')), h('th', { class: 'num' }, L(`Balance, ${labelB.toLowerCase()}`, `余额，${labelB}`)))),
      h('tbody', a.days.map((d, i) => h('tr',
        h('td', { class: 'nowrap' }, D(d.date)),
        h('td', { class: 'num' }, d.inflow ? M(d.inflow) : ''),
        h('td', { class: 'num' }, d.outflow ? M(-d.outflow) : ''),
        h('td', { class: ['num', d.belowSafety ? 'below' : ''] }, M(d.balance)),
        h('td', { class: ['num', b.days[i].belowSafety ? 'below' : ''] }, M(b.days[i].balance))))))));
}

export function renderCashflow(ctx) {
  const s = ctx.store.state;
  const cf = s.ui.cf;
  ctx.later(() => ctx.store.ensureForecasts());
  const aSl = ctx.store.forecastSlice(forecastKey(cf.mode, 'on_time'));
  const bSl = ctx.store.forecastSlice(forecastKey(cf.mode, 'late', cf.delay));
  const a = aSl.data, b = bSl.data;
  const labelB = lateLabel(cf.delay);
  const active = cf.active === 'on_time' ? a : b;

  const sub = active
    ? (cf.mode === 'fixed'
      ? L(`Fixed acceptance case, from ${DL(active.baseDate)} to ${DL(active.endDate)}, 30 days including both ends. Changing the demo date does not move this window.`,
        `固定验收案例：从 ${DL(active.baseDate)} 到 ${DL(active.endDate)}，共 30 天（含首尾）。调演示日期不会改变这个窗口。`)
      : L(`Rolling from the demo date, ${DL(active.baseDate)} to ${DL(active.endDate)}. Money received before ${D(active.baseDate)} is carried into the opening balance once.`,
        `从演示日期滚动：${DL(active.baseDate)} 到 ${DL(active.endDate)}。${D(active.baseDate)}之前的实际收款只结转进期初余额一次。`))
    : L('30 days of daily balances, worked out by the backend from the same records.', '后端用同一份记录算出的 30 天每日余额。');

  const head = h('div', { class: 'page-head' },
    h('div', h('h1', { class: 'page' }, L('Cash flow', '现金流')), h('p', { class: 'sub' }, sub)),
    controls(ctx));

  const failed = [aSl, bSl].find(sl => sl.status === 'error' && !sl.data);
  if (failed) return [head, errorBlock(failed.error, { ctx, onRetry: () => ctx.store.refreshAll() })];
  if (!a || !b || [aSl, bSl].some(sl => sl.status === 'loading')) {
    return [head, loadingBlock(L('Working out the forecast...', '正在计算预测...'))];
  }
  if (!comparableForecasts(aSl, bSl)) return [head,
    h('div', { class: 'msg bad', role: 'alert' },
      L('The forecast snapshots do not match. Refresh both scenarios before comparing them.', '预测快照不一致，请刷新两个情景后再比较。'),
      h('div', { class: 'row msg-actions' }, h('button', { type: 'button', class: 'btn sm', onClick: () => ctx.store.refreshAll() }, L('Retry', '重试'))))];

  return [
    head,
    figures(active),
    h('div', { class: 'panel' },
      h('div', { class: 'row between mb8' },
        h('h3', L('Daily closing balance (RM)', '每日余额（RM）')),
        h('div', { class: 'legend' },
          h('span', h('i', { class: 'key key-a' }), L('Paid on time', '按时付款')),
          h('span', h('i', { class: 'key key-b' }), labelB),
          h('span', h('i', { class: 'key key-safe' }), L(`Safety line ${M(a.safetyLine)}`, `安全线 ${M(a.safetyLine)}`)))),
      balanceChart({ a, b, active: cf.active === 'on_time' ? 'a' : 'b', safetyLine: a.safetyLine,
        labelA: L('on time', '按时'), labelB: labelB.toLowerCase(), baseDate: a.baseDate }),
      h('p', { class: 'caption' }, L(`Window ${DL(a.baseDate)} to ${DL(a.endDate)}. Amounts in ringgit.`, `窗口 ${DL(a.baseDate)} 至 ${DL(a.endDate)}，单位 RM。`))),
    h('div', { class: 'panel mt16' },
      h('h3', L('Where the numbers come from', '收支明细')),
      sourcesTable(a, b, labelB),
      dailyTable(a, b, labelB),
      h('p', { class: 'note' }, L('This is a rule-based scenario, not a trained model, and it makes no claim about accuracy. Once a payment is recorded it counts as received and is no longer treated as expected.',
        '这是按规则算出来的情景，不是训练出来的模型，也不代表预测准确率。记录收款后，这笔会变成实际收款，不会再当成预计收款算一次。'))),
  ];
}
