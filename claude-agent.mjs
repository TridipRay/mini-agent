import { randomUUID } from 'node:crypto';
import { workspacePath } from './agent.mjs';

export class ClaudeAgent {
  constructor({ auth, store, query, publish = () => {} }) {
    this.auth = auth; this.store = store; this.query = query; this.publish = publish; this.binary = auth.binary;
    this.busy = false; this.threadId = null; this.turnId = null; this.items = new Map(); this.prompts = new Map(); this.pendingAnswers = new Map();
  }
  async load() { this.threads = await this.store.read('claude-threads.json', []); }
  summary() { return { busy: this.busy, threadId: this.threadId, turnId: this.turnId, items: [...this.items.values()], prompts: [...this.prompts.values()],
    threads: this.threads.filter(t => t.accountKey === this.auth.state.selected).map(({ transcript, ...metadata }) => metadata) }; }
  assertIdle() { if (this.busy) throw new Error('A Claude turn is running. Stop it before changing the conversation.'); }
  async signedIn() { await this.auth.load(); if (this.threadId && !this.threads.some(t => t.id === this.threadId && t.accountKey === this.auth.state.selected)) await this.disconnect(); if (!this.auth.state.selected) throw new Error('Sign in to a Claude subscription account first.'); }
  options(record = {}) { return { cwd: record.cwd, env: this.auth.environment, pathToClaudeCodeExecutable: this.binary,
    settingSources: [], permissionMode: 'default', tools: ['Read', 'Glob', 'Grep', 'Bash', ...(process.platform === 'win32' ? ['PowerShell'] : []), 'Write', 'Edit', 'AskUserQuestion'],
    systemPrompt: { type: 'preset', preset: 'claude_code', ...(record.instructions ? { append: record.instructions } : {}) } }; }
  async models() {
    await this.signedIn();
    const stream = this.query({ prompt: (async function* () {})(), options: this.options() });
    try { return (await stream.supportedModels()).map(model => ({ slug: model.value, name: model.displayName })); }
    finally { stream.close(); }
  }
  async startThread(settings) {
    this.assertIdle(); await this.signedIn();
    if (typeof settings.model !== 'string' || !settings.model || !['read-only','workspace-write'].includes(settings.sandbox)) throw new Error('Choose a model and permission mode.');
    if (settings.instructions !== undefined && typeof settings.instructions !== 'string') throw new Error('Instructions must be text.');
    const record = { id: randomUUID(), accountKey: this.auth.state.selected, cwd: await workspacePath(settings.cwd), model: settings.model,
      sandbox: settings.sandbox, instructions: settings.instructions || '', title: 'New conversation', createdAt: Date.now(), transcript: [], started: false };
    this.threads.unshift(record); this.threadId = record.id; this.items.clear(); await this.save();
    this.publish('thread', { thread: { id: record.id, turns: [] }, settings: record }); return { thread: { id: record.id } };
  }
  async resume(id) {
    this.assertIdle(); await this.signedIn();
    const record = this.threads.find(t => t.id === id && t.accountKey === this.auth.state.selected);
    if (!record) throw new Error('This Claude conversation does not belong to the signed-in account.');
    this.threadId = id; this.items = new Map(record.transcript.map(item => [item.id, item]));
    this.publish('thread', { thread: { id, turns: [] }, settings: record }); return { thread: { id } };
  }
  async save() { await this.store.write('claude-threads.json', this.threads); }
  item(item) { this.items.set(item.id, item); this.publish('agent', { method: 'item/completed', params: { threadId: this.threadId, item } }); }
  async send(text) {
    this.assertIdle(); await this.signedIn();
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new Error('Enter a prompt of at most 100,000 characters.');
    const record = this.threads.find(t => t.id === this.threadId && t.accountKey === this.auth.state.selected);
    if (!record) throw new Error('Start a Claude conversation first.');
    this.busy = true; this.turnId = randomUUID(); this.abort = new AbortController();
    this.item({ id: randomUUID(), type: 'userMessage', content: [{ type: 'text', text }] });
    if (record.title === 'New conversation') record.title = text.slice(0,70);
    const options = { ...this.options(record), model: record.model,
      ...(record.started ? { resume: record.id } : { sessionId: record.id }),
      canUseTool: (tool, input, context) => this.permission(tool, input, context), abortController: this.abort };
    const controller = this.abort;
    const prompt = (async function* () {
      yield { type: 'user', session_id: record.id, message: { role: 'user', content: text }, parent_tool_use_id: null };
      if (!controller.signal.aborted) await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }));
    })();
    try { this.stream = this.query({ prompt, options }); }
    catch (error) { this.busy = false; this.turnId = null; controller.abort(); throw error; }
    this.publish('request', { method: 'claude/query', params: { threadId: record.id, model: record.model, cwd: record.cwd, permissionMode: 'default', instructions: record.instructions } });
    const turnId = this.turnId; this.running = this.consume(this.stream, record, turnId);
    return { turn: { id: turnId } };
  }
  async consume(stream, record, turnId) {
    let status = 'failed', error;
    try {
      for await (const message of stream) {
        if (message.type === 'system' && message.subtype === 'init') { record.started = true; await this.save(); }
        if (message.type === 'assistant') for (const block of message.message?.content ?? []) {
          if (block.type === 'text') this.item({ id: `${message.uuid}:${message.message.content.indexOf(block)}`, type: 'agentMessage', text: block.text });
          if (block.type === 'tool_use') this.item({ id: block.id, type: 'dynamicToolCall', tool: block.name, status: 'started', aggregatedOutput: JSON.stringify(block.input) });
        }
        if (message.type === 'user') for (const block of Array.isArray(message.message?.content) ? message.message.content : []) {
          if (block.type === 'tool_result') this.item({ ...(this.items.get(block.tool_use_id) ?? { id: block.tool_use_id, type: 'dynamicToolCall' }), status: block.is_error ? 'failed' : 'completed', aggregatedOutput: typeof block.content === 'string' ? block.content : JSON.stringify(block.content) });
        }
        if (message.type === 'result') { status = message.subtype === 'success' && !message.is_error ? 'completed' : 'failed'; error = message.errors?.join('\n') || (message.is_error ? message.result : undefined); break; }
      }
    } catch (failure) { error = failure.message; }
    finally {
      this.abort.abort(); stream.close(); this.clearPrompts(); this.stream = null; this.busy = false; this.turnId = null;
      record.transcript = [...this.items.values()];
      try { await this.save(); } catch (failure) { error = `Could not save Claude transcript: ${failure.message}`; status = 'failed'; }
      this.publish('agent', { method: 'turn/completed', params: { threadId: record.id, turn: { id: turnId, status, error: error ? { message: error } : null } } });
      this.publish('state', this.summary());
    }
  }
  permission(tool, input, { signal }) {
    if (signal.aborted) return Promise.resolve({ behavior: 'deny', message: 'Request cancelled.' });
    const id = randomUUID();
    const questions = tool === 'AskUserQuestion' && Array.isArray(input.questions) ? input.questions.map((question, index) => ({ id: String(index), question: question.question, options: question.options })) : null;
    const request = { id, method: questions ? 'item/tool/requestUserInput' : 'claude/tool/requestApproval', params: { threadId: this.threadId, tool, input, ...(questions ? { questions } : { availableDecisions: ['accept','decline'] }) } };
    return new Promise(resolve => {
      const finish = result => { signal.removeEventListener('abort', cancel); this.prompts.delete(id); this.pendingAnswers.delete(id); this.publish('approval-resolved', { id }); resolve(result); };
      const cancel = () => finish({ behavior: 'deny', message: 'Request cancelled.' });
      this.pendingAnswers.set(id, { finish, input, questions }); this.prompts.set(id, request);
      signal.addEventListener('abort', cancel, { once: true }); this.publish('approval', request);
    });
  }
  answer(id, response) {
    const pending = this.pendingAnswers.get(id);
    if (!pending) throw new Error('This Claude approval is no longer pending.');
    if (pending.questions) {
      const answers = {};
      for (const question of pending.questions) {
        if (typeof response.answers?.[question.id] !== 'string') throw new Error('Answer each Claude question.');
        answers[question.question] = response.answers[question.id];
      }
      pending.finish({ behavior: 'allow', updatedInput: { ...pending.input, answers } }); return;
    }
    if (!['accept','decline'].includes(response.decision)) throw new Error('Invalid approval decision.');
    pending.finish(response.decision === 'accept' ? { behavior: 'allow', updatedInput: pending.input } : { behavior: 'deny', message: 'User declined this tool call.' });
  }
  clearPrompts() { for (const pending of [...this.pendingAnswers.values()]) pending.finish({ behavior: 'deny', message: 'Turn ended.' }); }
  async interrupt() { if (!this.stream) throw new Error('No active Claude turn.'); this.abort.abort(); this.clearPrompts(); this.stream.close(); await this.running; return {}; }
  async disconnect() { this.assertIdle(); this.threadId = null; this.items.clear(); this.clearPrompts(); }
}
