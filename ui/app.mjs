const $ = id => document.getElementById(id);
let state, models = [], items = new Map(), approvals = new Map(), requestLog = [], activity = [], lastEvent = 0, visibleThread = null;
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
async function api(route, body = {}) {
  const response = await fetch(`/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}
async function refresh() {
  const snapshot = await (await fetch('/api/state')).json();
  if (snapshot.eventId < lastEvent) return;
  state = snapshot; lastEvent = snapshot.eventId; renderState();
}
function renderState() {
  const selected = state.auth.selected;
  const claude = state.provider === 'claude';
  $('provider').value = state.provider ?? 'openai';
  $('login').textContent = claude ? 'Continue with Claude' : 'Continue with ChatGPT';
  $('add-account').hidden = claude; $('claude-status').hidden = !claude;
  $('sandbox').options[0].textContent = claude ? 'Claude permissions · ask before changes' : 'Read-only · request approval for changes';
  $('sandbox').options[1].hidden = claude;
  if (claude) $('sandbox').value = 'read-only';
  $('accounts').replaceChildren(...state.auth.accounts.map(account => {
    const option = document.createElement('option'); option.value = account.key; option.textContent = account.label; return option;
  }));
  if (!state.auth.accounts.length) { const option = document.createElement('option'); option.textContent = 'No account connected'; $('accounts').append(option); }
  $('accounts').value = selected ?? '';
  const signedIn = state.auth.accounts.some(account => account.key === selected && account.signedIn);
  const busy = state.agent.busy;
  requestLog = state.requests ?? requestLog; $('requests').textContent = JSON.stringify(requestLog, null, 2);
  activity = state.activity ?? activity; $('activity').textContent = JSON.stringify(activity, null, 2);
  if (visibleThread !== state.agent.threadId) { visibleThread = state.agent.threadId; $('messages').replaceChildren(); items.clear(); }
  for (const item of state.agent.items ?? []) threadItem(item);
  $('send').disabled = !signedIn || !state.agent.threadId || busy || state.authPending;
  $('stop').disabled = !busy || !state.agent.turnId;
  for (const id of ['new-thread', 'accounts', 'login', 'add-account', 'logout', 'reload-models', 'provider', 'claude-status']) $(id).disabled = busy || state.authPending;
  $('cancel-login').hidden = !state.authPending;
  $('status').textContent = state.authPending ? 'Waiting for browser sign-in…' : busy ? 'Agent is working · approvals appear below' : signedIn ? 'Connected account · ready' : `Continue with ${claude ? 'Claude' : 'ChatGPT'} to begin`;
  if (!$('workspace').value) $('workspace').value = state.defaultWorkspace;
  $('context').textContent = state.agent.threadId ? `Thread ${state.agent.threadId.slice(0, 10)}` : 'No conversation selected';
  $('threads').replaceChildren(...state.agent.threads.map(thread => {
    const button = document.createElement('button'); button.textContent = thread.title; button.disabled = busy;
    button.onclick = () => task(async () => { await api('resume', { threadId: thread.id }); await refresh(); }); return button;
  }));
  for (const prompt of state.agent.prompts) if (!approvals.has(JSON.stringify(prompt.id))) approval(prompt);
  const pending = new Set(state.agent.prompts.map(prompt => JSON.stringify(prompt.id)));
  for (const [id, node] of approvals) if (!pending.has(id)) { node.remove(); approvals.delete(id); }
}
async function loadModels() {
  const result = await api('models'); models = result.models;
  $('model').replaceChildren(...models.map(model => {
    const option = document.createElement('option'); option.value = model.slug; option.textContent = model.name; return option;
  }));
  if (!models.length) throw new Error('No models are currently listed for this account.');
}
async function task(operation) {
  showError('');
  try { await operation(); } catch (error) { showError(error.message); await refresh().catch(() => {}); }
}
function message(id, role, text) {
  let entry = items.get(id);
  if (!entry) {
    const welcome = $('messages').querySelector('.welcome'); if (welcome) welcome.remove();
    const node = document.createElement('article'); node.className = `message ${role}`;
    const title = document.createElement('div'); title.className = 'role'; title.textContent = role;
    const content = document.createElement('div'); content.className = 'content'; content.textContent = text;
    node.append(title, content); $('messages').append(node); entry = { node, content }; items.set(id, entry);
  } else entry.content.textContent = text;
  $('messages').scrollTop = $('messages').scrollHeight; return entry;
}
function threadItem(item) {
  if (item.type === 'agentMessage') message(item.id, 'agent', item.text ?? '');
  else if (item.type === 'userMessage') message(item.id, 'user', (item.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n'));
  else if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall'].includes(item.type)) {
    message(item.id, 'tool', `${item.type} · ${item.status ?? ''}\n${item.command ?? item.tool ?? ''}\n${item.aggregatedOutput ?? ''}`);
  }
}
function approval(request) {
  const key = JSON.stringify(request.id); if (approvals.has(key)) return;
  const node = document.createElement('div'); node.className = 'approval';
  const title = document.createElement('h3'); title.textContent = request.method.includes('requestUserInput') ? 'The agent needs your input' : 'Approval requested';
  const detail = document.createElement('pre'); detail.textContent = JSON.stringify(request.params, null, 2);
  const buttons = document.createElement('div'); buttons.className = 'buttons'; const inputs = new Map();
  node.append(title, detail);
  if (request.method === 'item/tool/requestUserInput') {
    for (const question of request.params.questions) {
      const label = document.createElement('label'); label.textContent = question.question;
      const input = document.createElement('input'); input.type = question.isSecret ? 'password' : 'text';
      if (question.options?.length) { const hint = document.createElement('p'); hint.className = 'muted'; hint.textContent = question.options.map(option => option.label).join(' · '); node.append(hint); }
      label.append(input); node.append(label); inputs.set(question.id, input);
    }
    const submit = document.createElement('button'); submit.textContent = 'Send answers';
    submit.onclick = () => task(async () => { await api('answer', { id: request.id, answers: Object.fromEntries([...inputs].map(([id, input]) => [id, input.value])) }); await refresh(); }); buttons.append(submit);
  } else {
    const offered = request.params.availableDecisions;
    const choices = request.method === 'mcpServer/elicitation/request' ? ['decline'] : ['accept', 'decline'];
    for (const decision of choices) {
      if (offered && !offered.includes(decision)) continue;
      const button = document.createElement('button'); button.textContent = decision === 'accept' ?
        (request.method === 'item/permissions/requestApproval' ? 'Allow for this turn' : 'Allow once') : 'Decline';
      button.onclick = () => task(async () => { await api('answer', { id: request.id, decision }); await refresh(); }); buttons.append(button);
    }
  }
  node.append(buttons); $('approvals').append(node); approvals.set(key, node);
}
function event(event) {
  if (event.id <= lastEvent) return;
  lastEvent = event.id;
  const { type, data } = event;
  if (type === 'state') { refresh().catch(error => showError(error.message)); return; }
  if (type === 'account') { task(async () => { await refresh(); await loadModels(); }); return; }
  if (type === 'approval') { approval(data); return; }
  if (type === 'approval-resolved') { const key = JSON.stringify(data.id); approvals.get(key)?.remove(); approvals.delete(key); return; }
  if (type === 'thread') {
    $('messages').replaceChildren(); items.clear();
    for (const turn of data.thread.turns ?? []) for (const item of turn.items ?? []) threadItem(item);
    $('workspace').value = data.settings.cwd; $('sandbox').value = data.settings.sandbox; $('instructions').value = data.settings.instructions;
    $('model').value = data.settings.model;
    if (data.instructionSources) { requestLog.push({ instructionSources: data.instructionSources }); $('requests').textContent = JSON.stringify(requestLog.slice(-20), null, 2); }
    refresh().catch(error => showError(error.message)); return;
  }
  if (type === 'request') { requestLog.push(data); requestLog = requestLog.slice(-20); $('requests').textContent = JSON.stringify(requestLog, null, 2); return; }
  if (type === 'agent') {
    const params = data.params;
    if (data.method === 'item/agentMessage/delta') {
      const previous = items.get(params.itemId)?.content.textContent ?? '';
      message(params.itemId, 'agent', previous + params.delta);
    } else if (data.method === 'item/started' || data.method === 'item/completed') threadItem(params.item);
    else if (data.method === 'turn/completed') {
      if (params.turn.status !== 'completed') showError(`Turn ${params.turn.status}: ${params.turn.error?.message ?? 'Generation did not complete.'}`);
      refresh().catch(error => showError(error.message));
    } else if (data.method === 'error') showError(params.error?.message ?? 'Agent error.');
  }
  activity.push({ type, data }); activity = activity.slice(-50); $('activity').textContent = JSON.stringify(activity, null, 2);
  if (type === 'error') showError(data.message);
}
$('login').onclick = () => task(async () => { const result = await api('login'); if (result.url) window.location.assign(result.url); else await refresh(); });
$('add-account').onclick = () => task(async () => { const result = await api('login', { addAccount: true }); if (result.url) window.location.assign(result.url); else await refresh(); });
$('cancel-login').onclick = () => task(async () => { await api('login/cancel'); await refresh(); });
$('logout').onclick = () => task(async () => { const result = await api('logout'); await refresh(); if (!result.revoked && !result.nativeLogout) showError('Signed out locally. Remote revocation was not confirmed; disconnect this app in ChatGPT Settings.'); });
$('accounts').onchange = () => task(async () => { await api('account', { key: $('accounts').value }); await refresh(); await loadModels(); });
$('provider').onchange = () => task(async () => { await api('provider', { provider: $('provider').value }); $('model').replaceChildren(); await refresh(); if (state.auth.selected) await loadModels(); });
$('claude-status').onclick = () => task(async () => { await api('claude/status'); await refresh(); if (state.auth.selected) await loadModels(); });
$('reload-models').onclick = () => task(loadModels);
$('new-thread').onclick = () => task(async () => { await api('thread', { model: $('model').value, cwd: $('workspace').value, sandbox: $('sandbox').value, instructions: $('instructions').value }); await refresh(); });
$('stop').onclick = () => task(() => api('interrupt'));
$('composer').onsubmit = event => {
  event.preventDefault();
  task(async () => { const text = $('prompt').value; $('send').disabled = true; await api('send', { text }); $('prompt').value = ''; await refresh(); });
};
await refresh();
const stream = new EventSource(`/api/events?after=${lastEvent}`); stream.onmessage = incoming => event(JSON.parse(incoming.data));
stream.onerror = () => { $('status').textContent = 'Local connection interrupted · reconnecting…'; };
if (state.auth.accounts.some(account => account.key === state.auth.selected && account.signedIn)) task(loadModels);
