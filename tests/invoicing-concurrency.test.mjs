import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteTestStore } from './support/invoicing-store.mjs';
import { validateState } from '../contracts/validate.mjs';

// Separate JS threads and database connections contend for the same SQLite write lock.
async function together(filename, method, userId, entityId) {
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const workers = [];
  let ready = 0;
  try {
    return await Promise.all(Array.from({ length: 2 }, () => new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./support/invoicing-worker.mjs', import.meta.url), {
        workerData: { filename, method, userId, entityId, gate },
      });
      workers.push(worker);
      let result;
      worker.on('message', message => {
        if (message.ready && ++ready === 2) {
          Atomics.store(new Int32Array(gate), 0, 1);
          Atomics.notify(new Int32Array(gate), 0, 2);
        } else if (message.result) result = message.result;
      });
      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0 || !result) reject(new Error(`Invoicing worker exited without a result (code ${code})`));
        else resolve(result);
      });
    })));
  } finally {
    await Promise.all(workers.map(worker => worker.terminate()));
  }
}

test('two simultaneous workers complete and issue only once through the shared database lock', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sdc-invoicing-workers-'));
  const filename = join(directory, 'state.sqlite');
  const seed = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));
  const store = createSqliteTestStore(filename, seed);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

  const completed = await together(filename, 'completeMilestone', 'u_lumen_pm', 'ms_kt_2');
  assert.deepEqual(completed.map(r => r.status).sort(), [200, 201]);
  assert.equal(completed.filter(r => r.body.created).length, 1);
  const invoiceId = completed[0].body.invoice.id;
  assert.equal(completed[1].body.invoice.id, invoiceId);
  let state = await store.read();
  assert.equal(state.invoices.filter(i => i.milestoneId === 'ms_kt_2').length, 1);
  assert.equal(state.logs.filter(log => log.action === 'milestone.complete' && log.result === 'success').length, 1);

  // Issue #2 hands over an owner-approved record before either finance request begins.
  await store.transaction(state => {
    const invoice = state.invoices.find(i => i.id === invoiceId);
    invoice.status = 'approved';
    invoice.approval = { by: 'Daniel Tan', role: 'owner', at: '2026-10-22T11:00:00+08:00' };
  });
  const issued = await together(filename, 'issueInvoice', 'u_lumen_fin', invoiceId);
  assert.deepEqual(issued.map(r => r.status), [200, 200]);
  assert.deepEqual(issued[0].body, issued[1].body);
  state = await store.read();
  const invoice = state.invoices.find(i => i.id === invoiceId);
  assert.equal(invoice.issueAttempts, 1);
  assert.equal(invoice.status, 'issued');
  assert.equal(state.mockAccounting.filter(r => r.requestId === invoice.issueRequestId).length, 1);
  assert.equal(state.logs.filter(log => log.entityId === invoiceId && log.action === 'invoice.issue' && log.result === 'success').length, 1);
  assert.deepEqual(validateState(state), []);
});
