import { parentPort, workerData } from 'node:worker_threads';
import { createInvoicingService } from '../../src/invoicing/service.mjs';
import { createSqliteTestStore } from './invoicing-store.mjs';

const store = createSqliteTestStore(workerData.filename);
try {
  const service = createInvoicingService({ store, now: () => new Date('2026-10-22T04:00:00Z') });
  const gate = new Int32Array(workerData.gate);
  parentPort.postMessage({ ready: true });
  if (Atomics.wait(gate, 0, 0, 5000) === 'timed-out') throw new Error('Concurrent test barrier timed out');
  const result = await service[workerData.method](workerData.userId, workerData.entityId);
  parentPort.postMessage({ result });
} finally {
  store.close();
}
