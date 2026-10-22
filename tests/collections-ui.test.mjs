import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCollections } from '../web/js/views/collections.js';
import { createApi } from '../web/js/api.js';

// Minimal DOM for exercising the real render/event handlers without a browser dependency.
function installDom(t) {
  const previous = { Node: globalThis.Node, document: globalThis.document };
  class Node {
    constructor(tag = '', text = '') { this.tag = tag; this.text = text; this.children = []; this.handlers = {}; this.value = ''; this.style = {}; this.dataset = {}; }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    get textContent() { return this.text + this.children.map(n => n.textContent).join(''); }
    set textContent(text) { this.text = text; this.children = []; }
  }
  globalThis.Node = Node;
  globalThis.document = { createElement: tag => new Node(tag), createTextNode: text => new Node('', text) };
  t.after(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete globalThis[key];
      else globalThis[key] = previous[key];
    }
  });
}

function nodes(root) { return root.flat(Infinity).flatMap(n => n ? [n, ...nodes(n.children ?? [])] : []); }
function button(root, label) { return nodes(root).find(n => n.tag === 'button' && n.textContent === label); }

function fixture({ draft = true, failed = false, source = 'ai' } = {}) {
  const reminder = { id: 'rem_1', status: 'draft', sequence: 1, subject: 'Reviewed subject', body: 'Reviewed text',
    source, reviewToken: 'old-review-token', facts: { invoiceNo: 'INV-1', amount: 1800000, dueDate: '2026-11-05', overdueDays: 3, previousReminders: 0 } };
  const item = { invoice: { id: 'inv_1', invoiceNo: 'INV-1', status: 'issued', amount: 1800000, dueDate: '2026-11-05', issuedAt: '2026-10-22' },
    overdueDays: 3, client: { name: 'Example Client', contactName: 'Finance', email: 'finance@example.test' }, reminders: draft ? [reminder] : [] };
  const state = { session: { data: { settings: { demoDate: '2026-11-08' } } }, busy: new Set(), flash: new Map(),
    ui: { filter: 'overdue', selectedCollection: 'inv_1', edits: new Map() },
    collections: Object.fromEntries(['overdue', 'unpaid', 'paid'].map(key => [key, { status: 'ready', data: { items: key === 'paid' ? [] : [item] } }])) };
  if (failed) state.flash.set('col:inv_1', { kind: 'bad', action: 'generate', error: { code: 'AI_UNAVAILABLE' } });
  const calls = [];
  const ctx = { store: { state, canCollect: () => true, detailSlice: () => ({ data: { logs: [] } }), role: () => 'finance',
    actions: { sendReminder: (...args) => calls.push(['send', ...args]), useTemplate: (...args) => calls.push(['template', ...args]) } }, later() {}, confirm: async () => true };
  return { ctx, reminder, calls };
}

test('confirmation submits the exact version shown even when the draft object later changes', async t => {
  installDom(t);
  const { ctx, reminder, calls } = fixture();
  let decide;
  ctx.confirm = options => {
    assert.match(nodes(options.body).map(n => n.text ?? '').join(''), /Reviewed subject/);
    return new Promise(resolve => { decide = resolve; });
  };
  const tree = renderCollections(ctx);
  const pending = button(tree, 'Confirm and send (simulated)').handlers.click();
  reminder.reviewToken = 'new-review-token';
  reminder.subject = 'Not reviewed';
  decide(true);
  await pending;
  assert.deepEqual(calls, [['send', 'inv_1', 'rem_1', 'old-review-token']]);
});

test('manual fallback requires an explicit action after AI failure and never sends', async t => {
  installDom(t);
  const normal = fixture({ draft: false });
  assert.equal(button(renderCollections(normal.ctx), 'Use editable manual template'), undefined);
  const { ctx, calls } = fixture({ draft: false, failed: true });
  await button(renderCollections(ctx), 'Use editable manual template').handlers.click();
  assert.deepEqual(calls, [['template', 'inv_1', false]]);
});

test('manual fallback replacement can be cancelled and its source is visibly labelled', async t => {
  installDom(t);
  const { ctx, calls } = fixture({ failed: true, source: 'manual_template' });
  ctx.confirm = async () => false;
  const tree = renderCollections(ctx);
  assert.match(nodes(tree).map(n => n.text ?? '').join(''), /Manual template selected\. No AI was used/);
  await button(tree, 'Use editable manual template').handlers.click();
  assert.deepEqual(calls, []);
});

test('client sends review token and explicit template flag without losing abort or identity options', async () => {
  const calls = [];
  const ctrl = new AbortController();
  const api = createApi({ baseUrl: 'http://127.0.0.1:3000', getUser: () => 'finance', fetchImpl: async (url, init) => {
    calls.push({ url, init }); return new Response('{}', { headers: { 'content-type': 'application/json' } });
  } });
  await api.sendReminder('rem/1', 'reviewed-version', { signal: ctrl.signal });
  await api.templateReminder('inv/1', true, { signal: ctrl.signal });
  assert.deepEqual(JSON.parse(calls[0].init.body), { reviewToken: 'reviewed-version' });
  assert.deepEqual(JSON.parse(calls[1].init.body), { useTemplate: true, regenerate: true });
  assert.ok(calls[0].url.endsWith('/rem%2F1/send'));
  for (const { init } of calls) {
    assert.equal(init.signal, ctrl.signal);
    assert.equal(init.headers['X-Demo-User'], 'finance');
  }
});
