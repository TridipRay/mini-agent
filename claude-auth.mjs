import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { claudeEnvironment } from './claude-runtime.mjs';

const execute = promisify(execFile);
export class ClaudeAuth {
  constructor({ binary, directory, publish = () => {}, run = execute, spawnChild = spawn }) {
    this.binary = binary; this.directory = directory; this.publish = publish; this.run = run; this.spawnChild = spawnChild;
    this.state = { selected: null }; this.account = null; this.pending = null;
    this.environment = claudeEnvironment(process.env, directory);
  }
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let stdout;
    try { ({ stdout } = await this.run(this.binary, ['auth', 'status', '--json'], { env: this.environment, timeout: 15000, maxBuffer: 65536 })); }
    catch (error) { if (error.code !== 1 || !error.stdout) throw error; stdout = error.stdout; }
    const status = JSON.parse(stdout);
    if (typeof status.loggedIn !== 'boolean') throw new Error('Claude Code returned an invalid authentication status.');
    // A Console or cloud login is not subscription access. Never silently bill it.
    if (status.loggedIn && status.authMethod === 'claude.ai' && typeof status.email === 'string') {
      const key = `claude:${createHash('sha256').update(`${status.email}:${status.organizationId ?? ''}`).digest('hex')}`;
      this.account = { key, label: `Claude · ${status.email}`, signedIn: true }; this.state.selected = key;
    } else { this.account = null; this.state.selected = null; }
  }
  summary() { return { selected: this.state.selected, accounts: this.account ? [this.account] : [], provider: 'claude' }; }
  async start() {
    if (this.pending) throw new Error('Claude sign-in is already running.');
    const child = this.spawnChild(this.binary, ['auth', 'login', '--claudeai'], { env: this.environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const pending = { child }; this.pending = pending;
    // Claude Code opens its own browser and owns the callback, token storage and refresh.
    // Consume output without forwarding OAuth URLs, codes or credentials to diagnostics.
    child.stdout.resume(); child.stderr.resume();
    const finish = async (message) => {
      if (this.pending !== pending) return;
      clearTimeout(pending.timer);
      try { await this.load(); if (this.pending !== pending) return; this.pending = null; this.publish('account', this.summary()); }
      catch { if (this.pending !== pending) return; this.pending = null; this.publish('error', { message: 'Could not verify Claude sign-in. Refresh Claude account status.' }); }
      if (message) this.publish('error', { message });
    };
    child.once('error', () => { void finish('Could not start Claude Code sign-in.'); });
    child.once('exit', code => { void finish(code === 0 ? null : 'Claude sign-in did not complete. Try again.'); });
    pending.timer = setTimeout(() => { this.cancel(); this.publish('error', { message: 'Claude sign-in timed out. Try again.' }); }, 300000);
    pending.timer.unref();
    return { externalLogin: true };
  }
  cancel() { if (this.pending) { const { child, timer } = this.pending; this.pending = null; clearTimeout(timer); child.kill(); } }
  async logout() { this.cancel(); await this.run(this.binary, ['auth', 'logout'], { env: this.environment, timeout: 15000 }); await this.load(); return { nativeLogout: true }; }
  async select(key) { if (key !== this.state.selected) throw new Error('Use Claude Code sign-in to change the Claude account.'); }
}
