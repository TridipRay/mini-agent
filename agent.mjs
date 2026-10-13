import path from 'node:path';
import os from 'node:os';
import { realpath, stat, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Rpc } from './rpc.mjs';
import { APP_ID } from './auth.mjs';

export function providerArguments() {
  return ['app-server', '--listen', 'stdio://',
    '-c', 'model_provider="openai_chatgpt_plan"',
    '-c', 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
    '-c', 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
    '-c', 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
    '-c', 'model_providers.openai_chatgpt_plan.wire_api="responses"',
    '-c', 'model_providers.openai_chatgpt_plan.requires_openai_auth=false',
    '-c', 'model_providers.openai_chatgpt_plan.supports_websockets=false',
    '-c', 'analytics.enabled=false', '-c', 'features.apps=false', '-c', 'features.plugins=false',
    '-c', 'web_search="disabled"'];
}
export async function findBinary() {
  if (process.env.MINI_AGENT_CODEX_BIN) return process.env.MINI_AGENT_CODEX_BIN;
  const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex';
  try { await access(bundled); return bundled; } catch { return 'codex'; }
}
export async function workspacePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a workspace directory.');
  const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  const resolved = await realpath(path.resolve(expanded));
  if (!(await stat(resolved)).isDirectory()) throw new Error('Workspace must be a directory.');
  return resolved;
}
const keyFor = id => JSON.stringify(id);
const promptMethods = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
  'item/permissions/requestApproval', 'item/tool/requestUserInput', 'mcpServer/elicitation/request']);

export class Agent {
  constructor({ auth, store, binary, publish, spawnChild = spawn }) {
    this.auth = auth; this.store = store; this.binary = binary; this.publish = publish; this.spawnChild = spawnChild;
    this.rpc = null; this.tokenUsed = null; this.prompts = new Map(); this.busy = false;
    this.threadId = null; this.turnId = null; this.completed = new Set(); this.items = new Map();
  }
  async load() { this.threads = await this.store.read('threads.json', []); }
  summary() {
    return { busy: this.busy, threadId: this.threadId, turnId: this.turnId, items: [...this.items.values()],
      prompts: [...this.prompts.values()],
      threads: this.threads.filter(thread => thread.accountKey === this.auth.state.selected)
        .map(({ transcript, ...metadata }) => metadata) };
  }
  async connect() {
    const token = await this.auth.token();
    if (this.rpc && !this.rpc.closed && token === this.tokenUsed) return this.rpc;
    if (this.busy) throw new Error('Wait for or stop the current turn before reconnecting.');
    if (this.rpc) await this.rpc.close();
    const args = providerArguments();
    const child = this.spawnChild(this.binary, args, { stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ACCESS_TOKEN: token } });
    const rpc = new Rpc(child, text => text.split(token).join('[redacted credential]'));
    this.rpc = rpc; this.tokenUsed = token; this.prompts.clear();
    rpc.on('notification', message => this.notification(message));
    rpc.on('request', message => this.serverRequest(message));
    rpc.on('diagnostic', message => this.publish('diagnostic', { message }));
    rpc.on('closed', message => {
      if (this.rpc !== rpc) return;
      this.busy = false; this.turnId = null; this.prompts.clear();
      this.publish('connection', { connected: false, message });
    });
    try {
      const info = await rpc.request('initialize', { clientInfo: { name: APP_ID, title: 'Mini Agent', version: '0.1.0' },
        capabilities: { experimentalApi: false, requestAttestation: false } });
      rpc.send({ method: 'initialized', params: {} });
      this.publish('connection', { connected: true, info });
      return rpc;
    } catch (error) { await rpc.close(); throw error; }
  }
  notification(message) {
    const params = message.params ?? {};
    if (params.threadId && params.threadId !== this.threadId) return;
    if (message.method === 'turn/started' && params.turn?.id) this.turnId = params.turn.id;
    if (['item/started', 'item/completed'].includes(message.method) && params.item?.id) this.items.set(params.item.id, params.item);
    if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      const item = this.items.get(params.itemId) ?? { id: params.itemId, type: 'agentMessage', text: '' };
      this.items.set(params.itemId, { ...item, text: (item.text ?? '') + params.delta });
    }
    if (message.method === 'turn/completed' && params.turn?.id) {
      this.completed.add(params.turn.id); this.busy = false; this.turnId = null; this.prompts.clear();
      const record = this.threads.find(thread => thread.id === this.threadId);
      if (record) {
        record.transcript = [...this.items.values()];
        this.store.write('threads.json', this.threads).catch(error => this.publish('error', { message: `Could not save local transcript: ${error.message}` }));
      }
      this.publish('state', this.summary());
    }
    // Only subscribed thread events are exposed; no raw auth/token messages reach the page.
    if (params.threadId || message.method.startsWith('thread/')) this.publish('agent', message);
  }
  serverRequest(message) {
    if (!promptMethods.has(message.method)) { this.rpc.unsupported(message.id); return; }
    if (message.params?.threadId && message.params.threadId !== this.threadId) { this.rpc.unsupported(message.id); return; }
    this.prompts.set(keyFor(message.id), message); this.publish('approval', message);
  }
  assertIdle() { if (this.busy) throw new Error('A turn is running. Stop it before changing the conversation.'); }
  async startThread(settings) {
    this.assertIdle();
    if (typeof settings.model !== 'string' || !settings.model) throw new Error('Choose an available model.');
    if (!['read-only', 'workspace-write'].includes(settings.sandbox)) throw new Error('Unknown permission mode.');
    const cwd = await workspacePath(settings.cwd);
    if (settings.instructions !== undefined && typeof settings.instructions !== 'string') throw new Error('Instructions must be text.');
    const rpc = await this.connect();
    const params = { model: settings.model, cwd, sandbox: settings.sandbox, approvalPolicy: 'on-request',
      approvalsReviewer: 'user', developerInstructions: settings.instructions || null };
    this.publish('request', { method: 'thread/start', params });
    const result = await rpc.request('thread/start', params);
    if (typeof result.thread?.id !== 'string') throw new Error('Agent did not return a thread ID.');
    this.threadId = result.thread.id;
    this.items.clear();
    this.reconnectedThread = this.threadId; this.reconnectedRpc = rpc;
    const record = { id: this.threadId, accountKey: this.auth.state.selected, cwd, model: result.model ?? settings.model,
      sandbox: settings.sandbox, instructions: settings.instructions || '', title: 'New conversation', createdAt: Date.now(), transcript: [] };
    this.threads.unshift(record); await this.store.write('threads.json', this.threads);
    this.publish('thread', { thread: result.thread, settings: record, instructionSources: result.instructionSources ?? [] });
    return result;
  }
  async resume(threadId) {
    this.assertIdle();
    const record = this.threads.find(thread => thread.id === threadId && thread.accountKey === this.auth.state.selected);
    if (!record) throw new Error('This conversation does not belong to the selected account in this app.');
    const rpc = await this.connect();
    const params = { threadId, modelProvider: 'openai_chatgpt_plan', model: record.model,
      cwd: record.cwd, sandbox: record.sandbox, approvalPolicy: 'on-request', approvalsReviewer: 'user' };
    this.publish('request', { method: 'thread/resume', params });
    const result = await rpc.request('thread/resume', params);
    this.threadId = threadId;
    this.items = new Map((record.transcript ?? []).map(item => [item.id, item]));
    for (const turn of result.thread?.turns ?? []) for (const item of turn.items ?? []) this.items.set(item.id, item);
    this.reconnectedThread = threadId; this.reconnectedRpc = rpc;
    this.busy = result.thread?.status?.type === 'active';
    this.turnId = result.thread?.turns?.findLast(turn => turn.status === 'inProgress')?.id ?? null;
    this.publish('thread', { thread: result.thread, settings: record });
    return result;
  }
  async send(text) {
    this.assertIdle();
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new Error('Enter a prompt of at most 100,000 characters.');
    if (!this.threadId) throw new Error('Start a conversation first.');
    const rpc = await this.connect();
    // Refreshed env-key tokens require a fresh process and explicit thread resumption.
    if (this.reconnectedThread !== this.threadId || this.reconnectedRpc !== rpc) {
      await rpc.request('thread/resume', { threadId: this.threadId, modelProvider: 'openai_chatgpt_plan' });
      this.reconnectedThread = this.threadId; this.reconnectedRpc = rpc;
    }
    const params = { threadId: this.threadId, input: [{ type: 'text', text, text_elements: [] }] };
    this.publish('request', { method: 'turn/start', params });
    this.busy = true;
    try {
      const result = await rpc.request('turn/start', params);
      if (typeof result.turn?.id !== 'string') throw new Error('Agent did not return a turn ID.');
      if (!this.completed.has(result.turn.id)) this.turnId = result.turn.id;
      const record = this.threads.find(thread => thread.id === this.threadId);
      if (record?.title === 'New conversation') { record.title = text.slice(0, 70); await this.store.write('threads.json', this.threads); }
      this.publish('state', this.summary()); return result;
    } catch (error) {
      // A dispatched mutation might still run. Keep busy until completion/interrupt or disconnect.
      if (!error.outcomeUnknown) this.busy = false;
      this.publish('state', this.summary()); throw error;
    }
  }
  async interrupt() {
    if (!this.turnId || !this.rpc) throw new Error('No active turn ID is available yet; wait for turn/started.');
    return this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
  }
  answer(id, response) {
    const key = keyFor(id), request = this.prompts.get(key);
    if (!request) throw new Error('This approval/input request is no longer pending.');
    let result;
    if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(request.method)) {
      if (!['accept', 'decline', 'cancel'].includes(response.decision)) throw new Error('Invalid approval decision.');
      const choices = request.params?.availableDecisions;
      if (choices && !choices.includes(response.decision)) throw new Error('That decision was not offered by the agent.');
      result = { decision: response.decision };
    } else if (request.method === 'item/permissions/requestApproval') {
      if (!['accept', 'decline'].includes(response.decision)) throw new Error('Invalid permission decision.');
      result = { permissions: response.decision === 'accept' ? request.params.permissions : {}, scope: 'turn' };
    } else if (request.method === 'item/tool/requestUserInput') {
      const answers = {};
      for (const question of request.params.questions) {
        const answer = response.answers?.[question.id];
        if (typeof answer !== 'string') throw new Error('Answer each question.');
        answers[question.id] = { answers: [answer] };
      }
      result = { answers };
    } else {
      if (response.decision !== 'decline') throw new Error('MCP elicitation is not implemented; decline or stop the turn.');
      result = { action: 'decline', content: null, _meta: null };
    }
    this.rpc.reply(id, result); this.prompts.delete(key); this.publish('approval-resolved', { id });
  }
  async disconnect() {
    this.assertIdle();
    if (this.rpc) await this.rpc.close();
    this.rpc = null; this.tokenUsed = null; this.threadId = null; this.turnId = null; this.prompts.clear(); this.items.clear();
  }
}
