import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

export class Rpc extends EventEmitter {
  constructor(child, redact = value => value) {
    super(); this.child = child; this.redact = redact; this.nextId = 1; this.pending = new Map(); this.closed = false;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try { this.receive(JSON.parse(line)); }
      catch { this.emit('diagnostic', 'The agent returned an invalid protocol message.'); }
    });
    child.stderr.on('data', chunk => this.emit('diagnostic', redact(chunk.toString()).slice(-4000)));
    child.stdin.on('error', error => this.terminate(`Agent input connection failed: ${error.code ?? 'write error'}.`));
    child.stdout.on('error', error => this.terminate(`Agent output connection failed: ${error.code ?? 'read error'}.`));
    child.on('error', error => this.terminate(`Could not launch Codex: ${error.message}`));
    child.on('exit', (code, signal) => this.terminate(`Agent process exited (${code ?? signal}).`));
  }
  receive(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid RPC envelope.');
    if (typeof message.method === 'string') {
      if (Object.hasOwn(message, 'id')) this.emit('request', message);
      else this.emit('notification', message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (!Object.hasOwn(message, 'result') && !message.error) throw new Error('Missing RPC result.');
    this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(this.redact(`${pending.method}: ${message.error.message ?? 'request failed'}`)));
    else pending.resolve(message.result);
  }
  send(message) {
    if (this.closed || !this.child.stdin.writable) throw new Error('Agent connection is closed.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request(method, params = {}, timeout = 60000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`${method} timed out; its outcome may be unknown. Do not blindly retry a mutation.`);
        error.outcomeUnknown = true; reject(error);
      }, timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  reply(id, result) { this.send({ id, result }); }
  unsupported(id) { this.send({ id, error: { code: -32601, message: 'This local client does not implement this request.' } }); }
  terminate(message) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer); const error = new Error(message); error.outcomeUnknown = true; pending.reject(error);
    }
    this.pending.clear(); this.emit('closed', message);
  }
  async close() {
    if (this.closed) return;
    this.child.stdin.end();
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.child.kill('SIGTERM'); resolve(); }, 2000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
