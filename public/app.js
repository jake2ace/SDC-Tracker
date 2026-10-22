'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    users: [], session: null, csrfToken: null, operations: [], logs: [],
    busy: false, epoch: 0, operationsLoading: false, logsLoading: false, operationRequest: 0, logRequest: 0,
    operationsError: null, logsError: null, logOutcome: 'all', logOperation: '',
    hasOlderLogs: false, actionMessages: new Map(), demoFailure: new Map(), rejectReasons: new Map(),
  };
  const statusNames = { draft: 'Draft', pending_approval: 'Pending approval', approved: 'Approved', rejected: 'Rejected', executed: 'Executed' };
  const roleNames = { operator: 'Operator', reviewer: 'Reviewer', viewer: 'Viewer' };

  class RequestError extends Error {
    constructor(message, status, code, requestId) { super(message); this.status = status; this.code = code; this.requestId = requestId; }
  }

  async function api(path, { method = 'GET', body, csrfToken = state.csrfToken } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
    let response;
    try {
      response = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new RequestError('Could not reach the server. Check the connection and try again.', 0, 'NETWORK_ERROR', null);
    }
    let payload;
    try { payload = await response.json(); } catch {
      throw new RequestError('The server returned an unreadable response. Please retry.', response.status, 'INVALID_RESPONSE', response.headers.get('X-Request-Id'));
    }
    if (!response.ok) {
      const error = payload && payload.error ? payload.error : {};
      throw new RequestError(error.message || `Request failed (${response.status}).`, response.status, error.code || 'REQUEST_FAILED', error.requestId || response.headers.get('X-Request-Id'));
    }
    if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) throw new RequestError('The server response is missing its data.', response.status, 'INVALID_RESPONSE', null);
    return payload.data;
  }

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function readableError(error) {
    return `${error.message || 'Something went wrong.'}${error.requestId ? ` Request ID: ${error.requestId}` : ''}`;
  }

  function notice(message, isError = false) {
    const container = $('notice');
    container.replaceChildren();
    container.hidden = !message;
    container.className = isError ? 'notice error' : 'notice';
    if (!message) return;
    const close = node('button', '', '×');
    close.type = 'button'; close.setAttribute('aria-label', 'Dismiss notification');
    close.addEventListener('click', () => { container.hidden = true; });
    container.append(close, node('span', '', message));
  }

  function dateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || 'Time unavailable') : new Intl.DateTimeFormat('en-MY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur', hour12: false }).format(date) + ' MYT';
  }

  function demoSelection() {
    const selected = $('demoUserSelect').value;
    return state.users.find((user) => user.id === selected || String(user.id) === selected);
  }

  function renderUsers() {
    const select = $('demoUserSelect');
    const selected = state.session ? String(state.session.id) : select.value;
    select.replaceChildren();
    const groups = new Map();
    state.users.forEach((user) => {
      let group = groups.get(user.workspaceId);
      if (!group) { group = document.createElement('optgroup'); group.label = user.workspaceName; groups.set(user.workspaceId, group); select.append(group); }
      const option = document.createElement('option'); option.value = String(user.id); option.textContent = `${user.name} · ${roleNames[user.role] || user.role}`; group.append(option);
    });
    if (state.users.some((user) => String(user.id) === selected)) select.value = selected;
    renderControls();
  }

  function renderControls() {
    $('demoUserSelect').disabled = state.busy || state.users.length === 0;
    $('switchUserButton').disabled = state.busy || state.users.length === 0;
    $('switchUserButton').textContent = state.busy ? 'Please wait…' : state.session ? 'Switch identity' : 'Enter workspace';
    $('logoutButton').hidden = !state.session;
    $('logoutButton').disabled = state.busy;
    $('refreshOperationsButton').disabled = state.busy || state.operationsLoading;
    $('refreshLogsButton').disabled = state.busy || state.logsLoading;
    $('applyLogFiltersButton').disabled = state.busy || state.logsLoading;
    $('clearLogFiltersButton').disabled = state.busy || state.logsLoading;
    $('logOutcomeFilter').disabled = state.busy || state.logsLoading;
    $('logOperationFilter').disabled = state.busy || state.logsLoading;
    $('olderLogsButton').disabled = state.busy || state.logsLoading;
    const canCreate = state.session && state.session.role === 'operator';
    $('operationTitle').disabled = !canCreate || state.busy;
    $('operationNote').disabled = !canCreate || state.busy;
    $('createOperationButton').disabled = !canCreate || state.busy;
    $('createPermission').textContent = canCreate ? 'Your operator role can create and submit drafts. A reviewer must approve them.' : 'Read-only here: switch to an Operator identity in this workspace to create a draft.';
    $('createOperationButton').title = canCreate ? 'Save a draft in the current workspace' : 'Only an operator can create a draft';
  }

  function renderSession() {
    const user = state.session;
    $('authView').hidden = Boolean(user);
    $('workspaceView').hidden = !user;
    if (user) {
      $('workspaceHeading').textContent = user.workspaceName;
      $('workspaceDescription').textContent = 'A shared place for approvals and a dependable audit trail.';
      $('identityInitial').textContent = (user.name || '?').charAt(0).toUpperCase();
      $('identityName').textContent = user.name;
      $('identityRole').textContent = `${roleNames[user.role] || user.role} · demo identity`;
    }
    renderControls();
  }

  function setLoggedOut(message = 'Choose a demo identity above, then select “Enter workspace”.') {
    state.session = null; state.csrfToken = null; state.operations = []; state.logs = [];
    state.busy = false; state.operationsLoading = false; state.logsLoading = false;
    state.operationsError = null; state.logsError = null; state.actionMessages.clear(); state.demoFailure.clear(); state.rejectReasons.clear();
    $('authState').replaceChildren(node('span', '', message));
    $('operationTitle').value = ''; $('operationNote').value = '';
    renderSession(); renderOperations(); renderLogs();
  }

  function showState(id, { loading, error, empty, title, description, retry }) {
    const el = $(id); el.replaceChildren();
    el.hidden = !loading && !error && !empty;
    el.className = error ? 'state-message error' : 'state-message';
    if (loading) { el.append(node('span', '', 'Loading records…')); return; }
    if (error) {
      el.append(node('strong', '', 'Unable to load records'), node('p', '', readableError(error)));
      if (retry) { const button = node('button', 'button button-secondary', 'Retry'); button.type = 'button'; button.disabled = state.busy; button.addEventListener('click', retry); el.append(button); }
      return;
    }
    if (empty) el.append(node('strong', '', title), node('p', '', description));
  }

  function actionAccess(operation, action) {
    if (!state.session) return 'Enter a workspace first.';
    if (state.busy) return 'Another request is in progress.';
    if (state.operationsLoading || state.operationsError) return 'Refresh the queue before making changes.';
    const role = state.session.role;
    if (action === 'submit') {
      if (role !== 'operator') return 'Only an operator can submit a draft.';
      if (operation.status !== 'draft') return 'Only drafts can be submitted.';
    } else {
      if (role !== 'reviewer') return 'Only a reviewer can approve, reject, or execute.';
      if (action === 'execute' && operation.status !== 'approved') return operation.status === 'executed' ? 'Already executed. Duplicate execution is blocked.' : 'Approval is required before execution.';
      if (action !== 'execute' && operation.status !== 'pending_approval') return 'Only pending requests can be reviewed.';
    }
    return null;
  }

  function permissionSummary(operation) {
    const role = state.session ? state.session.role : '';
    if (operation.status === 'executed') return 'Completed. This operation cannot execute again.';
    if (operation.status === 'rejected') return 'Rejected. This operation cannot execute; create a new draft if needed.';
    if (role === 'viewer') return 'Viewer access is read-only. Switch to an operator or reviewer to continue.';
    if (operation.status === 'draft') return role === 'operator' ? 'Submit when ready. Execution stays blocked until a reviewer approves.' : 'Waiting for an operator to submit this draft.';
    if (operation.status === 'pending_approval') return role === 'reviewer' ? 'Review the request, then approve or reject it. Approval does not execute it.' : 'Waiting for a reviewer. Operators cannot approve their own workflow.';
    return role === 'reviewer' ? 'Approved. Run a simulated check, or test a connector failure and retry.' : 'Approved. A reviewer can execute this simulated check.';
  }

  function renderOperations() {
    const operations = state.operations;
    const healthy = !state.operationsError && !state.operationsLoading;
    $('statTotal').textContent = healthy ? operations.length : '—';
    $('statPending').textContent = healthy ? operations.filter((op) => op.status === 'pending_approval').length : '—';
    $('statApproved').textContent = healthy ? operations.filter((op) => op.status === 'approved').length : '—';
    $('statExecuted').textContent = healthy ? operations.filter((op) => op.status === 'executed').length : '—';
    $('navQueueCount').textContent = healthy && state.session ? operations.filter((op) => op.status === 'pending_approval').length : '—';
    $('operationCount').textContent = healthy ? operations.length : '—';
    const filter = $('operationStatusFilter').value;
    const filtered = filter === 'all' ? operations : operations.filter((op) => op.status === filter);
    showState('operationState', { loading: state.operationsLoading, error: state.operationsError, empty: healthy && filtered.length === 0, title: operations.length ? 'No checks in this status' : 'Your first check starts here', description: operations.length ? 'Choose another status to see more requests.' : 'Create a draft as an Operator, then switch to a Reviewer to complete the handoff.', retry: () => reloadOperations() });
    const list = $('operationList'); list.replaceChildren();
    if (!healthy) { renderControls(); return; }
    filtered.forEach((operation) => {
      const card = node('article', 'operation-card');
      card.setAttribute('aria-label', `${operation.title}, ${statusNames[operation.status] || operation.status}`);
      const top = node('div', 'operation-top');
      const heading = node('div'); heading.append(node('h4', '', operation.title));
      const user = state.users.find((item) => String(item.id) === String(operation.createdBy));
      heading.append(node('div', 'operation-meta', `Created by ${user ? user.name : operation.createdBy} · ${dateLabel(operation.createdAt)}`), node('div', 'operation-reference', operation.id));
      top.append(heading, node('span', `status-pill status-${operation.status}`, statusNames[operation.status] || operation.status));
      card.append(top);
      if (operation.payload && operation.payload.note) card.append(node('p', 'operation-note', operation.payload.note));
      if (operation.result) {
        const result = node('div', 'operation-result'); result.append(node('strong', '', 'SIMULATED RESULT'), node('p', '', operation.result.message), node('code', '', operation.result.reference)); card.append(result);
      }
      if (operation.status === 'pending_approval' && state.session.role === 'reviewer') {
        const reasonLabel = node('label', 'rejection-reason', 'Rejection reason (optional)');
        const reason = document.createElement('input'); reason.type = 'text'; reason.maxLength = 500; reason.placeholder = 'Explain what needs to change if rejecting'; reason.value = state.rejectReasons.get(operation.id) || ''; reason.disabled = state.busy;
        reason.addEventListener('input', () => state.rejectReasons.set(operation.id, reason.value)); reasonLabel.append(reason); card.append(reasonLabel);
      }
      const bottom = node('div', 'operation-bottom'); const actions = node('div', 'operation-actions');
      [['submit', 'Submit for approval', 'button-secondary'], ['approve', 'Approve', 'button-secondary'], ['reject', 'Reject', 'button-danger'], ['execute', 'Run check', 'button-dark']].forEach(([action, label, style]) => {
        const button = node('button', `button ${style}`, label); button.type = 'button';
        const reason = actionAccess(operation, action); button.disabled = Boolean(reason); button.title = reason || `${label}: ${operation.title}`;
        button.setAttribute('aria-label', `${label}: ${operation.title}`);
        button.addEventListener('click', () => performAction(operation, action)); actions.append(button);
      });
      bottom.append(actions);
      if (operation.status === 'approved') {
        const label = node('label', 'simulate-toggle'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = state.demoFailure.get(operation.id) || false; input.disabled = Boolean(actionAccess(operation, 'execute'));
        input.addEventListener('change', () => state.demoFailure.set(operation.id, input.checked)); label.append(input, document.createTextNode('Simulate connector failure')); bottom.append(label);
      }
      card.append(bottom, node('p', 'permission-help', permissionSummary(operation)));
      if (operation.attempts > 0) card.append(node('p', 'permission-help', `Execution attempts: ${operation.attempts} · Updated ${dateLabel(operation.updatedAt)}`));
      const message = state.actionMessages.get(operation.id);
      if (message) { const feedback = node('div', message.error ? 'action-error' : 'action-success', message.text); feedback.setAttribute('role', message.error ? 'alert' : 'status'); card.append(feedback); }
      list.append(card);
    });
    renderControls();
  }

  function renderLogs() {
    const healthy = !state.logsError && !state.logsLoading;
    showState('logState', { loading: state.logsLoading, error: state.logsError, empty: healthy && state.logs.length === 0, title: 'No activity matches these filters', description: 'Create a check or clear the filters to see the audit trail.', retry: () => reloadLogs() });
    const list = $('logList'); list.replaceChildren();
    if (healthy) state.logs.forEach((record) => {
      const item = node('article', 'log-item');
      const icon = node('span', `outcome-icon outcome-${record.outcome}`, record.outcome === 'success' ? '✓' : record.outcome === 'denied' ? '!' : '×'); icon.setAttribute('aria-hidden', 'true');
      const body = node('div'); body.append(node('p', 'log-message', record.message || record.action));
      const details = node('div', 'log-detail'); details.append(node('span', `outcome-label ${record.outcome}`, record.outcome), node('span', '', record.actorName || record.actorId || 'System'), node('code', '', record.action), node('span', '', `HTTP ${record.statusCode}`));
      if (record.operationId) details.append(node('code', '', `Operation: ${record.operationId}`));
      body.append(details, node('div', 'log-request', `Request ID: ${record.requestId || 'not recorded'}`));
      const time = node('time', 'log-time', dateLabel(record.createdAt)); if (record.createdAt) time.dateTime = record.createdAt;
      item.append(icon, body, time); list.append(item);
    });
    $('logCount').textContent = `${healthy ? state.logs.length : '—'} records`;
    $('olderLogsButton').hidden = !healthy || !state.hasOlderLogs;
    renderControls();
  }

  async function reloadOperations(epoch = state.epoch) {
    if (!state.session || epoch !== state.epoch) return;
    const request = ++state.operationRequest;
    state.operationsLoading = true; state.operationsError = null; renderOperations();
    try {
      const operations = await api('/api/operations');
      if (epoch !== state.epoch || request !== state.operationRequest) return;
      if (!Array.isArray(operations)) throw new RequestError('The request queue returned an invalid response.', 200, 'INVALID_RESPONSE', null);
      state.operations = operations;
    } catch (error) {
      if (epoch !== state.epoch || request !== state.operationRequest) return;
      if (error.status === 401) { state.epoch++; setLoggedOut('Your demo session ended. Choose an identity to enter again.'); return; }
      state.operationsError = error;
    } finally { if (epoch === state.epoch && request === state.operationRequest) { state.operationsLoading = false; renderOperations(); } }
  }

  async function reloadLogs(epoch = state.epoch, append = false) {
    if (!state.session || epoch !== state.epoch) return;
    const request = ++state.logRequest;
    state.logsLoading = true; state.logsError = null; renderLogs();
    const query = new URLSearchParams();
    if (state.logOutcome !== 'all') query.set('outcome', state.logOutcome);
    if (state.logOperation) query.set('operationId', state.logOperation);
    if (append && state.logs.length) query.set('before', state.logs[state.logs.length - 1].id);
    try {
      const logs = await api(`/api/logs${query.size ? `?${query}` : ''}`);
      if (epoch !== state.epoch || request !== state.logRequest) return;
      if (!Array.isArray(logs)) throw new RequestError('The activity log returned an invalid response.', 200, 'INVALID_RESPONSE', null);
      state.logs = append ? state.logs.concat(logs) : logs; state.hasOlderLogs = logs.length === 100;
    } catch (error) {
      if (epoch !== state.epoch || request !== state.logRequest) return;
      if (error.status === 401) { state.epoch++; setLoggedOut('Your demo session ended. Choose an identity to enter again.'); return; }
      state.logsError = error;
    } finally { if (epoch === state.epoch && request === state.logRequest) { state.logsLoading = false; renderLogs(); } }
  }

  async function refreshWorkspace(epoch = state.epoch) {
    await Promise.allSettled([reloadOperations(epoch), reloadLogs(epoch)]);
  }

  async function mutate(path, body, operationId, successMessage) {
    if (state.busy || !state.session) return false;
    const epoch = state.epoch; const csrfToken = state.csrfToken;
    state.busy = true; if (operationId) state.actionMessages.delete(operationId); notice(''); renderOperations();
    let succeeded = false;
    try {
      await api(path, { method: 'POST', body, csrfToken });
      if (epoch !== state.epoch) return false;
      succeeded = true;
      if (operationId) state.actionMessages.set(operationId, { error: false, text: successMessage });
      notice(successMessage);
    } catch (error) {
      if (epoch !== state.epoch) return false;
      const message = readableError(error);
      if (operationId) state.actionMessages.set(operationId, { error: true, text: message });
      notice(message, true);
    } finally {
      if (epoch === state.epoch) {
        await refreshWorkspace(epoch);
        state.busy = false; renderOperations(); renderLogs(); renderControls();
      }
    }
    return succeeded;
  }

  async function performAction(operation, action) {
    if (actionAccess(operation, action)) return;
    let body = {};
    if (action === 'reject') {
      body.reason = (state.rejectReasons.get(operation.id) || '').trim().slice(0, 500);
    }
    if (action === 'execute') body.simulateFailure = state.demoFailure.get(operation.id) || false;
    const messages = { submit: 'Request submitted. A reviewer must approve it before execution.', approve: 'Request approved. It has not executed yet.', reject: 'Request rejected. Execution is blocked.', execute: 'Simulated check completed. No real financial action was performed.' };
    const success = await mutate(`/api/operations/${encodeURIComponent(operation.id)}/${action}`, body, operation.id, messages[action]);
    if (success && action === 'execute') state.demoFailure.delete(operation.id);
  }

  async function switchIdentity() {
    const selected = demoSelection(); if (!selected || state.busy) return;
    state.busy = true; const epoch = ++state.epoch;
    state.csrfToken = null; state.session = null; state.operations = []; state.logs = [];
    state.operationsLoading = false; state.logsLoading = false; state.actionMessages.clear(); state.demoFailure.clear(); state.rejectReasons.clear();
    notice(''); renderSession(); $('authState').textContent = 'Opening the selected demo workspace…';
    try {
      const session = await api('/api/demo/session', { method: 'POST', body: { userId: selected.id }, csrfToken: null });
      if (epoch !== state.epoch) return;
      if (!session || !session.user || !session.csrfToken) throw new RequestError('The demo session response is incomplete.', 200, 'INVALID_RESPONSE', null);
      state.session = session.user; state.csrfToken = session.csrfToken;
      state.logOutcome = 'all'; state.logOperation = ''; $('logOutcomeFilter').value = 'all'; $('logOperationFilter').value = ''; $('operationStatusFilter').value = 'all';
      $('operationTitle').value = ''; $('operationNote').value = '';
      renderUsers(); renderSession(); await refreshWorkspace(epoch);
      if (epoch === state.epoch && state.session) notice(`Demo workspace opened as ${state.session.name}. Records are scoped to ${state.session.workspaceName}.`);
    } catch (error) {
      if (epoch !== state.epoch) return;
      setLoggedOut('Unable to open the demo session. Select an identity and try again.'); notice(readableError(error), true);
    } finally { if (epoch === state.epoch) { state.busy = false; renderSession(); renderOperations(); renderLogs(); } }
  }

  async function logout() {
    if (state.busy || !state.session) return;
    state.busy = true; const epoch = state.epoch; renderControls(); renderOperations();
    try {
      await api('/api/session', { method: 'DELETE' });
      if (epoch !== state.epoch) return;
      state.epoch++; setLoggedOut(); notice('Signed out of the demo workspace.');
    } catch (error) { if (epoch === state.epoch) { notice(readableError(error), true); await refreshWorkspace(epoch); } }
    finally { state.busy = false; renderControls(); renderOperations(); }
  }

  async function loadUsers() {
    try {
      const users = await api('/api/demo/users');
      if (!Array.isArray(users)) throw new RequestError('The demo identity list is invalid.', 200, 'INVALID_RESPONSE', null);
      state.users = users; renderUsers();
    } catch (error) {
      $('demoUserSelect').replaceChildren(node('option', '', 'Identities unavailable'));
      const retry = node('button', 'button button-secondary', 'Retry loading identities'); retry.type = 'button'; retry.addEventListener('click', () => { $('authState').textContent = 'Loading demo identities…'; loadUsers(); });
      $('authState').replaceChildren(node('span', '', readableError(error)), document.createElement('br'), retry); notice(readableError(error), true);
    }
  }

  async function restoreSession() {
    const epoch = state.epoch;
    try {
      const session = await api('/api/session');
      if (epoch !== state.epoch) return;
      if (!session || !session.user || !session.csrfToken) { setLoggedOut(); return; }
      state.session = session.user; state.csrfToken = session.csrfToken; renderUsers(); renderSession(); await refreshWorkspace();
    } catch (error) {
      if (epoch !== state.epoch) return;
      setLoggedOut(error.status === 401 ? undefined : 'Unable to check the previous session. You can select an identity to start a fresh demo session.');
      if (error.status !== 401) notice(readableError(error), true);
    }
  }

  $('switchUserButton').addEventListener('click', switchIdentity);
  $('logoutButton').addEventListener('click', logout);
  $('createOperationForm').addEventListener('submit', async (event) => {
    event.preventDefault(); if (state.busy || !state.session || state.session.role !== 'operator') return;
    const title = $('operationTitle').value.trim(); if (!title) { $('operationTitle').setCustomValidity('Enter a request title.'); $('operationTitle').reportValidity(); return; }
    const note = $('operationNote').value.trim();
    const succeeded = await mutate('/api/operations', { title, payload: { note } }, null, 'Draft saved. Submit it when ready for review.');
    if (succeeded) { $('operationTitle').value = ''; $('operationNote').value = ''; }
  });
  $('operationTitle').addEventListener('input', () => $('operationTitle').setCustomValidity(''));
  $('operationStatusFilter').addEventListener('change', renderOperations);
  $('refreshOperationsButton').addEventListener('click', () => reloadOperations());
  $('refreshLogsButton').addEventListener('click', () => reloadLogs());
  $('logFilterForm').addEventListener('submit', (event) => { event.preventDefault(); if (state.busy || state.logsLoading) return; state.logOutcome = $('logOutcomeFilter').value; state.logOperation = $('logOperationFilter').value.trim(); reloadLogs(); });
  $('clearLogFiltersButton').addEventListener('click', () => { state.logOutcome = 'all'; state.logOperation = ''; $('logOutcomeFilter').value = 'all'; $('logOperationFilter').value = ''; reloadLogs(); });
  $('olderLogsButton').addEventListener('click', () => reloadLogs(state.epoch, true));
  Promise.allSettled([loadUsers(), restoreSession()]);
})();
