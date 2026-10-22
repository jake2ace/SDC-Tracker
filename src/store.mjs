import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validateState } from '../contracts/validate.mjs';

function assertValidState(state) {
  if (state?.schemaVersion !== 1) {
    throw new Error('Unsupported database schema version; expected version 1.');
  }
  const errors = validateState(state);
  if (errors.length > 0) {
    throw new Error(`Invalid database state: ${errors.join('; ')}`);
  }
}

/** Keep the complete shared contract in one transactional SQLite snapshot. */
export function openStore({ databasePath, seed }) {
  if (typeof databasePath !== 'string' || databasePath.length === 0) {
    throw new TypeError('A database path is required.');
  }
  const initialSeed = structuredClone(seed);
  assertValidState(initialSeed);

  const inMemory = databasePath === ':memory:';
  const existed = !inMemory && existsSync(databasePath);
  if (!inMemory) mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  let closed = false;
  let transactionActive = false;
  let selectState;
  let updateState;
  let insertRequestError;

  function ensureOpen() {
    if (closed) throw new Error('Store is closed.');
  }

  function loadState() {
    const row = selectState.get();
    if (!row) throw new Error('Database state snapshot is missing.');
    let state;
    try {
      state = JSON.parse(row.payload);
    } catch {
      throw new Error('Database state snapshot is not valid JSON.');
    }
    assertValidState(state);
    return state;
  }

  function atomic(operation) {
    ensureOpen();
    if (transactionActive) throw new Error('Nested store transactions are not supported.');
    database.exec('BEGIN IMMEDIATE');
    transactionActive = true;
    try {
      const result = operation();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      transactionActive = false;
    }
  }

  try {
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA journal_mode = WAL');

    const hasSnapshotTable = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backend_state'",
    ).get();
    if (existed && !hasSnapshotTable) {
      throw new Error('Existing database has no supported state snapshot.');
    }

    database.exec(`
      CREATE TABLE IF NOT EXISTS backend_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL
      )
    `);
    selectState = database.prepare('SELECT payload FROM backend_state WHERE id = 1');
    updateState = database.prepare('UPDATE backend_state SET payload = ? WHERE id = 1');

    if (!selectState.get()) {
      if (existed) throw new Error('Existing database state snapshot is missing.');
      database.prepare('INSERT INTO backend_state (id, payload) VALUES (1, ?)')
        .run(JSON.stringify(initialSeed));
    }
    loadState();

    // Request failures without an authenticated tenant do not belong in business activity.
    database.exec(`
      CREATE TABLE IF NOT EXISTS backend_request_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        at TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        actor TEXT
      )
    `);
    insertRequestError = database.prepare(`
      INSERT INTO backend_request_errors
        (request_id, at, method, path, status, code, message, actor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  } catch (error) {
    database.close();
    throw error;
  }

  return {
    read() {
      ensureOpen();
      return structuredClone(loadState());
    },

    transaction(fn) {
      if (typeof fn !== 'function') throw new TypeError('A transaction callback is required.');
      return atomic(() => {
        const state = loadState();
        const result = fn(state);
        if (result && typeof result.then === 'function') {
          throw new TypeError('Store transactions must be synchronous.');
        }
        assertValidState(state);
        const clonedResult = structuredClone(result);
        updateState.run(JSON.stringify(state));
        return clonedResult;
      });
    },

    reset() {
      return atomic(() => {
        assertValidState(initialSeed);
        updateState.run(JSON.stringify(initialSeed));
        return structuredClone(initialSeed.settings);
      });
    },

    recordRequestError({ requestId, at, method, path, status, code, message, actor }) {
      ensureOpen();
      const actorText = actor == null ? null :
        (typeof actor === 'string' ? actor : JSON.stringify(actor));
      insertRequestError.run(requestId, at, method, path, status, code, message, actorText);
    },

    close() {
      if (!closed) {
        if (transactionActive) throw new Error('Cannot close the store during a transaction.');
        database.close();
        closed = true;
      }
    },
  };
}
