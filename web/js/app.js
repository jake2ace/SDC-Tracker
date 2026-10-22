import { createApi } from './api.js';
import { createStore } from './state.js';
import { h, replaceKeepingFocus } from './dom.js';
import { L, setLang, getLang } from './i18n.js';
import { nextStep, errorBlock, loadingBlock, goodBlock, roleName, D, flashFor } from './views/ui.js';
import { renderOverview } from './views/overview.js';
import { renderInvoicing } from './views/invoicing.js';
import { renderCollections } from './views/collections.js';
import { renderCashflow } from './views/cashflow.js';

const config = Object.assign({ apiBase: 'http://127.0.0.1:3000', devChinese: false }, window.SDC_CONFIG ?? {});
const PAGES = { overview: renderOverview, invoicing: renderInvoicing, collections: renderCollections, cashflow: renderCashflow };
const PAGE_NAME = {
  overview: () => L('Overview', '总览'), invoicing: () => L('Projects & invoicing', '项目与开票'),
  collections: () => L('AI collections', 'AI 催收'), cashflow: () => L('Cash flow', '现金流'),
};

let storage = null;
try { storage = window.localStorage; storage.getItem('probe'); } catch { storage = null; }

let store;
const api = createApi({ baseUrl: config.apiBase, getUser: () => store.state.userId });
store = createStore({ api, storage });

if (config.devChinese) {
  try { setLang(storage?.getItem('sdc.lang') ?? 'en'); } catch { setLang('en'); }
}

const $ = id => document.getElementById(id);

function route() {
  const name = location.hash.replace(/^#\/?/, '');
  return Object.hasOwn(PAGES, name) ? name : null;
}

const ctx = {
  store,
  config,
  later: fn => queueMicrotask(fn),
  go(page, opts = null) {
    const s = store.state;
    if (opts?.filter) { s.ui.filter = opts.filter; s.ui.selectedCollection = null; }
    if (opts?.invoiceId) {
      const inv = s.invoices.data?.invoices.find(i => i.id === opts.invoiceId);
      const overdue = s.collections.overdue.data?.items.some(x => x.invoice.id === opts.invoiceId);
      s.ui.filter = inv?.status === 'paid' ? 'paid' : overdue ? 'overdue' : 'unpaid';
      s.ui.selectedCollection = opts.invoiceId;
    }
    if (opts?.selectInvoice) s.ui.selectedInvoice = opts.selectInvoice;
    if (opts?.scenario) Object.assign(s.ui.cf, { active: 'late', delay: opts.scenario });
    if (location.hash === `#/${page}`) schedule();
    else location.hash = `#/${page}`;
    window.scrollTo(0, 0);
  },
  confirm({ title, body, confirmLabel }) {
    const dlg = $('confirm');
    $('confirm-title').textContent = title;
    $('confirm-body').replaceChildren(...body);
    $('confirm-ok').textContent = confirmLabel ?? L('OK', '确定');
    $('confirm-cancel').textContent = L('Cancel', '取消');
    return new Promise(resolve => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
      dlg.returnValue = 'cancel';
      dlg.showModal();
      $('confirm-cancel').focus();
    });
  },
};

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}
store.subscribe(schedule);

function setOptions(select, options, value) {
  const sig = JSON.stringify(options);
  if (select.dataset.sig !== sig) {
    select.replaceChildren(...options.map(([v, label]) => h('option', { value: v }, label)));
    select.dataset.sig = sig;
  }
  if (document.activeElement !== select) select.value = value;
}

function renderDemoBar() {
  const s = store.state;
  const session = s.session.data;
  const busy = s.busy.has('switch') || s.busy.has('reset') || s.busy.has('settings');
  const company = $('company'), user = $('user'), date = $('demo-date');
  const failA = $('fail-accounting'), failO = $('fail-outbox');
  for (const el of [company, user, date, failA, failO, $('reset')]) el.disabled = !session || busy;
  if (session) {
    setOptions(company, session.companies.map(c => [c.id, c.name]), session.company.id);
    setOptions(user, session.users.filter(u => u.companyId === session.company.id).map(u => [u.id, `${u.name}, ${roleName(u.role)}`]), session.user.id);
    if (document.activeElement !== date) date.value = session.settings.demoDate;
    failA.checked = session.settings.failNext.accounting;
    failO.checked = session.settings.failNext.outbox;
    $('company-line').textContent = `${session.company.name} · ${session.company.industry}`;
  }
  const down = s.boot.status === 'error' || (s.session.status === 'error' && s.session.error?.code === 'NETWORK');
  const state = $('api-state');
  state.className = `api-state ${down ? 'down' : session ? 'up' : ''}`;
  state.textContent = down ? L('Backend offline', '后端未连接') : session ? L('Live backend', '已连接后端') : '';
  state.title = config.apiBase;

  const msg = $('demo-msg');
  const f = s.flash.get('demo');
  if (!f) msg.replaceChildren();
  else if (f.kind === 'good' && f.type === 'reset') {
    msg.replaceChildren(goodBlock(L('Demo data reset.', '演示数据已重置。'),
      L('Both companies are back to the starting seed.', '两家公司都回到了初始数据。'),
      h('button', { type: 'button', class: 'btn sm', onClick: () => store.clearFlash('demo') }, L('Dismiss', '关闭'))));
  } else {
    msg.replaceChildren(flashFor(ctx, 'demo'), h('button', { type: 'button', class: 'btn sm dismiss', onClick: () => store.clearFlash('demo') }, L('Dismiss', '关闭')));
  }
}

function renderNextStep(page) {
  const box = $('next-step');
  const ns = store.state.boot.status === 'ready' ? nextStep(ctx) : null;
  if (!ns) { box.replaceChildren(); return; }
  const me = store.state.session.data.user;
  const buttons = [];
  if (ns.who && ns.who.id !== me.id) {
    buttons.push(h('button', { type: 'button', class: 'btn sm', disabled: store.state.busy.has('switch'),
      onClick: () => { store.switchUser(ns.who.id); if (ns.page && ns.page !== page) ctx.go(ns.page, ns.invoiceId ? { invoiceId: ns.page === 'collections' ? ns.invoiceId : undefined, selectInvoice: ns.invoiceId } : null); } },
    L(`Switch to ${ns.who.name}`, `切换到 ${ns.who.name}`)));
  }
  if (ns.page && ns.page !== page) {
    buttons.push(h('button', { type: 'button', class: 'btn sm', onClick: () => ctx.go(ns.page, ns.invoiceId
      ? { invoiceId: ns.page === 'collections' ? ns.invoiceId : undefined, selectInvoice: ns.invoiceId } : null) },
    ns.cta ?? L(`Open ${PAGE_NAME[ns.page]()}`, `打开${PAGE_NAME[ns.page]()}`)));
  }
  if (ns.jumpDate) {
    buttons.push(h('button', { type: 'button', class: 'btn sm', disabled: store.state.busy.has('settings'),
      onClick: () => store.actions.setDemoDate(ns.jumpDate) }, L(`Set demo date to ${D(ns.jumpDate)}`, `把演示日期设为 ${D(ns.jumpDate)}`)));
  }
  const you = ns.who && ns.who.id === me.id;
  box.replaceChildren(h('div', { class: `next next-${ns.kind}` },
    h('span', { class: 'next-label' }, ns.kind === 'done' ? L('Done', '完成') : L('Next step', '下一步')),
    h('p', ns.text, you ? h('span', { class: 'you' }, L(' That’s you.', ' 就是你。')) : null),
    buttons.length ? h('div', { class: 'row' }, buttons) : null));
}

function render() {
  document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
  for (const btn of document.querySelectorAll('[data-lang-toggle]')) {
    btn.hidden = !config.devChinese;
    btn.textContent = getLang() === 'zh' ? 'EN' : '中文';
  }
  const page = route();
  $('landing').hidden = Boolean(page);
  $('app').hidden = !page;
  if (!page) return;
  if (store.state.boot.status === 'idle') { store.boot(); return; }

  for (const btn of document.querySelectorAll('[data-go]')) {
    if (btn.dataset.go === page) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  renderDemoBar();
  const view = $('view');
  const boot = store.state.boot;
  if (boot.status === 'error') {
    $('next-step').replaceChildren();
    replaceKeepingFocus(view, [h('div', { class: 'page-head' }, h('div', h('h1', { class: 'page' }, L('Can’t load the demo', '加载失败')))),
      errorBlock(boot.error, { ctx, onRetry: () => store.boot(), retryLabel: L('Try again', '重试') }),
      h('div', { class: 'panel mt16' }, h('h3', L('How to start the backend', '如何启动后端')),
        h('pre', { class: 'cmd' }, `DEMO_MODE=true CORS_ORIGINS=${location.origin} node --env-file=.env src/server.mjs`))]);
    return;
  }
  if (boot.status !== 'ready') {
    $('next-step').replaceChildren();
    replaceKeepingFocus(view, [loadingBlock(L('Connecting to the backend...', '正在连接后端...'))]);
    return;
  }
  renderNextStep(page);
  // A refresh that failed while older data is still on screen must not pass silently.
  const s = store.state;
  const stale = [s.session, s.projects, s.invoices, s.overview, s.activity, ...Object.values(s.collections), ...s.forecasts.values()]
    .find(sl => sl.status === 'error' && sl.data);
  const warn = stale ? h('div', { class: 'msg warn stale', role: 'alert' },
    h('b', L('Couldn\u2019t refresh.', '刷新失败。')), ' ',
    L('You are looking at the last data that loaded. Nothing new was confirmed.', '当前显示的是上一次加载的数据，没有新的操作被确认。'), ' ',
    h('button', { type: 'button', class: 'btn sm', onClick: () => store.refreshAll() }, L('Retry', '重试'))) : null;
  replaceKeepingFocus(view, [warn, PAGES[page](ctx)]);
}

// Wiring for the static parts of the page.
for (const btn of document.querySelectorAll('[data-enter]')) {
  btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.enter}`; });
}
for (const btn of document.querySelectorAll('[data-go]')) {
  btn.addEventListener('click', () => ctx.go(btn.dataset.go));
}
for (const btn of document.querySelectorAll('[data-lang-toggle]')) {
  btn.addEventListener('click', () => {
    setLang(getLang() === 'zh' ? 'en' : 'zh');
    try { storage?.setItem('sdc.lang', getLang()); } catch { /* ignore */ }
    for (const sel of document.querySelectorAll('select')) delete sel.dataset.sig;
    render();
  });
}
$('company').addEventListener('change', e => {
  const session = store.state.session.data;
  if (!session) return;
  const users = session.users.filter(u => u.companyId === e.target.value);
  const same = users.find(u => u.role === session.user.role) ?? users[0];
  if (same) store.switchUser(same.id);
});
$('user').addEventListener('change', e => store.switchUser(e.target.value));
$('demo-date').addEventListener('change', e => {
  const value = e.target.value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value !== store.state.session.data?.settings.demoDate) store.actions.setDemoDate(value);
});
const failChange = () => store.actions.setFailNext({ accounting: $('fail-accounting').checked, outbox: $('fail-outbox').checked });
$('fail-accounting').addEventListener('change', failChange);
$('fail-outbox').addEventListener('change', failChange);
$('reset').addEventListener('click', async () => {
  const ok = await ctx.confirm({
    title: L('Reset all demo data?', '重置全部演示数据？'),
    body: [h('p', L('This puts both companies back to the starting seed. Invoices, reminders, payments and activity created during the demo are removed.',
      '两家公司都会回到初始数据，演示中产生的发票、提醒、收款和日志都会被清掉。'))],
    confirmLabel: L('Reset data', '重置数据'),
  });
  if (ok) store.actions.reset();
});
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && store.state.flash.has('demo')) store.clearFlash('demo'); });

render();

// Exposed for the walkthrough script and for debugging in the console.
window.__sdc = { store };
