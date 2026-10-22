import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { HttpError, requireCondition } from './errors.js';
import { runFoundationCheck } from './mock-connector.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const safeUser = user => user && ({
  id: user.id, name: user.name, role: user.role,
  workspaceId: user.workspace_id, workspaceName: user.workspace_name
});
const operationRecord = row => row && ({
  id: row.id, title: row.title, kind: row.kind, status: row.status,
  workspaceId: row.workspace_id, createdBy: row.created_by,
  createdAt: row.created_at, updatedAt: row.updated_at,
  payload: JSON.parse(row.payload), result: row.result ? JSON.parse(row.result) : null,
  attempts: row.attempts
});

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS foundation_workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS foundation_users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('operator','reviewer','viewer')),
      workspace_id TEXT NOT NULL REFERENCES foundation_workspaces(id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS foundation_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES foundation_users(id),
      csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS foundation_operations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES foundation_workspaces(id),
      title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind = 'foundation_check'),
      status TEXT NOT NULL CHECK(status IN ('draft','pending_approval','approved','rejected','executed')),
      payload TEXT NOT NULL, result TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES foundation_users(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS foundation_operations_workspace ON foundation_operations(workspace_id,created_at);
    CREATE TABLE IF NOT EXISTS foundation_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT REFERENCES foundation_workspaces(id),
      actor_id TEXT, actor_name TEXT,
      action TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('success','failure','denied')),
      operation_id TEXT, request_id TEXT NOT NULL,
      status_code INTEGER NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS foundation_logs_workspace ON foundation_audit_logs(workspace_id,id);
  `);

  // Namespaced fixtures avoid defining the business entities owned by Issue #1.
  const insertWorkspace = db.prepare('INSERT OR IGNORE INTO foundation_workspaces(id,name) VALUES (?,?)');
  const insertUser = db.prepare('INSERT OR IGNORE INTO foundation_users(id,name,role,workspace_id) VALUES (?,?,?,?)');
  for (const [suffix, label] of [['a', 'Demo Studio A'], ['b', 'Demo Studio B']]) {
    insertWorkspace.run(`demo-${suffix}`, label);
    for (const role of ['operator', 'reviewer', 'viewer']) {
      insertUser.run(`${role}-${suffix}`, `${role[0].toUpperCase() + role.slice(1)} ${suffix.toUpperCase()}`, role, `demo-${suffix}`);
    }
  }

  function audit({ actor = null, action, outcome = 'success', operationId = null, requestId, statusCode = 200, message }) {
    db.prepare(`INSERT INTO foundation_audit_logs
      (workspace_id,actor_id,actor_name,action,outcome,operation_id,request_id,status_code,message,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      actor?.workspaceId ?? null, actor?.id ?? null, actor?.name ?? null,
      action, outcome, operationId, requestId, statusCode, message, now()
    );
  }

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function getUser(id) {
    return safeUser(db.prepare(`SELECT u.*,w.name AS workspace_name FROM foundation_users u
      JOIN foundation_workspaces w ON w.id=u.workspace_id WHERE u.id=?`).get(id));
  }

  function findOperation(id, actor) {
    const op = operationRecord(db.prepare('SELECT * FROM foundation_operations WHERE id=? AND workspace_id=?').get(id, actor.workspaceId));
    requireCondition(op, 404, 'NOT_FOUND', 'Operation not found in this workspace.');
    return op;
  }

  function requireRole(actor, role) {
    requireCondition(actor.role === role, 403, 'FORBIDDEN', `The ${role} role is required for this action.`);
  }

  return {
    close() { db.close(); },
    audit,
    users() {
      return db.prepare(`SELECT u.*,w.name AS workspace_name FROM foundation_users u
        JOIN foundation_workspaces w ON w.id=u.workspace_id ORDER BY u.workspace_id,u.role`).all().map(safeUser);
    },
    createSession(userId, requestId, oldToken) {
      const user = getUser(userId);
      requireCondition(user, 400, 'INVALID_USER', 'Choose a provided demo user.');
      const token = randomBytes(32).toString('hex');
      const csrfToken = randomBytes(32).toString('hex');
      transaction(() => {
        db.prepare('DELETE FROM foundation_sessions WHERE expires_at <= ?').run(Date.now());
        if (oldToken) db.prepare('DELETE FROM foundation_sessions WHERE token_hash=?').run(hash(oldToken));
        db.prepare('INSERT INTO foundation_sessions(token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)')
          .run(hash(token), userId, csrfToken, Date.now() + 8 * 60 * 60 * 1000);
        audit({ actor: user, action: 'session.login', requestId, message: 'Simulated demo identity selected.' });
      });
      return { token, user, csrfToken };
    },
    session(token) {
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
      const row = db.prepare('SELECT * FROM foundation_sessions WHERE token_hash=? AND expires_at>?').get(hash(token), Date.now());
      return row ? { user: getUser(row.user_id), csrfToken: row.csrf_token } : null;
    },
    logout(token, actor, requestId) {
      transaction(() => {
        db.prepare('DELETE FROM foundation_sessions WHERE token_hash=?').run(hash(token));
        audit({ actor, action: 'session.logout', requestId, message: 'Demo session ended.' });
      });
    },
    operations(actor) {
      return db.prepare('SELECT * FROM foundation_operations WHERE workspace_id=? ORDER BY created_at DESC,id DESC')
        .all(actor.workspaceId).map(operationRecord);
    },
    operation: findOperation,
    createOperation(actor, body, requestId) {
      requireRole(actor, 'operator');
      requireCondition(typeof body.title === 'string' && body.title.trim().length > 0 && body.title.trim().length <= 100,
        400, 'INVALID_TITLE', 'Title must contain 1–100 characters.');
      requireCondition(body.kind === undefined || body.kind === 'foundation_check', 400, 'INVALID_KIND', 'Only foundation_check is available in this foundation.');
      requireCondition(body.payload === undefined || (body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)),
        400, 'INVALID_PAYLOAD', 'Payload must be an object.');
      const note = body.payload?.note ?? '';
      requireCondition(typeof note === 'string' && note.length <= 1000, 400, 'INVALID_NOTE', 'Note must be text of at most 1000 characters.');
      // Do not accept client-supplied status, actor, workspace or execution result.
      requireCondition(Object.keys(body).every(key => ['title', 'payload', 'kind'].includes(key)) &&
        Object.keys(body.payload ?? {}).every(key => key === 'note'), 400, 'UNKNOWN_FIELD', 'This fixture only accepts title and payload.note.');
      const id = randomUUID(); const timestamp = now();
      return transaction(() => {
        db.prepare(`INSERT INTO foundation_operations
          (id,workspace_id,title,kind,status,payload,created_by,created_at,updated_at)
          VALUES (?,?,?,'foundation_check','draft',?,?,?,?)`)
          .run(id, actor.workspaceId, body.title.trim(), JSON.stringify({ note }), actor.id, timestamp, timestamp);
        audit({ actor, action: 'operation.created', operationId: id, requestId, statusCode: 201, message: 'Foundation draft created.' });
        return findOperation(id, actor);
      });
    },
    transition(actor, id, action, body, requestId) {
      return transaction(() => {
        const op = findOperation(id, actor);
        requireRole(actor, action === 'submit' ? 'operator' : 'reviewer');
        const requiredState = action === 'submit' ? 'draft' : 'pending_approval';
        requireCondition(op.status === requiredState, 409, 'INVALID_STATE', `This action requires ${requiredState}; current state is ${op.status}.`);
        requireCondition(Object.keys(body).every(key => action === 'reject' && key === 'reason'), 400, 'UNKNOWN_FIELD', 'Unexpected action field.');
        if (action === 'reject') requireCondition(body.reason === undefined || (typeof body.reason === 'string' && body.reason.length <= 500),
          400, 'INVALID_REASON', 'Rejection reason must be at most 500 characters.');
        const status = { submit: 'pending_approval', approve: 'approved', reject: 'rejected' }[action];
        db.prepare('UPDATE foundation_operations SET status=?,updated_at=? WHERE id=? AND status=?')
          .run(status, now(), id, requiredState);
        audit({ actor, action: `operation.${action}`, operationId: id, requestId,
          message: action === 'reject' ? `Rejected${body.reason?.trim() ? ': ' + body.reason.trim() : '.'}` : `Operation moved to ${status}.` });
        return findOperation(id, actor);
      });
    },
    execute(actor, id, body, requestId) {
      return transaction(() => {
        const op = findOperation(id, actor);
        requireRole(actor, 'reviewer');
        requireCondition(op.status === 'approved', 409, 'INVALID_STATE', `Only an approved operation can execute; current state is ${op.status}.`);
        requireCondition(Object.keys(body).every(key => key === 'simulateFailure') &&
          (body.simulateFailure === undefined || typeof body.simulateFailure === 'boolean'), 400, 'INVALID_EXECUTION', 'simulateFailure must be a boolean.');
        const outcome = runFoundationCheck(op, body);
        db.prepare('UPDATE foundation_operations SET attempts=attempts+1,updated_at=? WHERE id=?').run(now(), id);
        if (!outcome.ok) {
          // Commit the failed attempt and its audit record, but keep approval for retry.
          audit({ actor, action: 'connector.failed', outcome: 'failure', operationId: id, requestId, statusCode: 503, message: outcome.message });
          return { error: new HttpError(503, 'CONNECTOR_UNAVAILABLE', outcome.message), logged: true };
        }
        db.prepare("UPDATE foundation_operations SET status='executed',result=?,updated_at=? WHERE id=? AND status='approved'")
          .run(JSON.stringify(outcome.result), now(), id);
        audit({ actor, action: 'connector.executed', operationId: id, requestId, message: outcome.result.message });
        return { operation: findOperation(id, actor) };
      });
    },
    logs(actor, query) {
      const conditions = ['workspace_id=?']; const args = [actor.workspaceId];
      if (query.has('outcome')) {
        requireCondition(['success', 'failure', 'denied'].includes(query.get('outcome')), 400, 'INVALID_FILTER', 'Unknown log outcome.');
        conditions.push('outcome=?'); args.push(query.get('outcome'));
      }
      if (query.has('operationId')) { conditions.push('operation_id=?'); args.push(query.get('operationId')); }
      if (query.has('before')) {
        const before = Number(query.get('before'));
        requireCondition(Number.isSafeInteger(before) && before > 0, 400, 'INVALID_CURSOR', 'before must be a positive log ID.');
        conditions.push('id<?'); args.push(before);
      }
      return db.prepare(`SELECT * FROM foundation_audit_logs WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 100`).all(...args)
        .map(row => ({ id: row.id, workspaceId: row.workspace_id, actorId: row.actor_id, actorName: row.actor_name,
          action: row.action, outcome: row.outcome, operationId: row.operation_id, requestId: row.request_id,
          statusCode: row.status_code, message: row.message, createdAt: row.created_at }));
    }
  };
}
