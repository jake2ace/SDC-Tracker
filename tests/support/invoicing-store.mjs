import { DatabaseSync } from 'node:sqlite';

/** Disk-backed test adapter. The application supplies its own store in Issue #2. */
export function createSqliteTestStore(filename, initialState) {
  const db = new DatabaseSync(filename);
  let closed = false;
  db.exec('PRAGMA busy_timeout = 2000');
  db.exec('CREATE TABLE IF NOT EXISTS demo_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)');
  if (initialState !== undefined) {
    db.prepare('INSERT OR IGNORE INTO demo_state (id, payload) VALUES (1, ?)').run(JSON.stringify(initialState));
  }
  const select = db.prepare('SELECT payload FROM demo_state WHERE id = 1');
  const update = db.prepare('UPDATE demo_state SET payload = ? WHERE id = 1');
  const snapshot = () => {
    const row = select.get();
    if (!row) throw new Error('Test store has not been seeded');
    return JSON.parse(row.payload);
  };
  return {
    async read() {
      return snapshot();
    },
    async transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const state = snapshot();
        const result = fn(state);
        if (result && typeof result.then === 'function') {
          throw new TypeError('Transaction callbacks must be synchronous');
        }
        const detached = structuredClone(result);
        update.run(JSON.stringify(state));
        db.exec('COMMIT');
        return detached;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}
