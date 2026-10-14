import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const execute = promisify(execFile);
export function nativeEnvironment(environment) {
  const result = { ...environment };
  for (const key of Object.keys(result)) {
    if (/^ANTHROPIC_|^CLAUDE_CODE_(?:USE_|OAUTH_|API_KEY|CUSTOM_)/.test(key)) delete result[key];
  }
  delete result.CLAUDECODE;
  // The dashboard opens the destination; the CLI must not open a second browser.
  result.BROWSER = 'false';
  return result;
}
export function authorizationUrl(output) {
  for (const text of output.match(/https:\/\/[^\s\x1b\x07]+(?=[\s\x1b\x07])/g) ?? []) {
    const url = new URL(text);
    if (['claude.com', 'claude.ai'].includes(url.hostname) && ['/cai/oauth/authorize', '/oauth/authorize'].includes(url.pathname)
        && !url.username && !url.password && !url.port && url.searchParams.get('response_type') === 'code'
        && url.searchParams.get('client_id') === '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
        && /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge') ?? '')
        && /^[A-Za-z0-9_-]{16,128}$/.test(url.searchParams.get('state') ?? '')) return url.href;
  }
}
async function status(binary, environment, run) {
  let stdout;
  try { ({ stdout } = await run(binary, ['auth', 'status', '--json'], { env: environment, timeout: 15000, maxBuffer: 65536 })); }
  catch (error) { if (error.code !== 1 || !error.stdout) throw error; stdout = error.stdout; }
  const value = JSON.parse(stdout);
  if (typeof value.loggedIn !== 'boolean') throw new Error('Claude Code returned an invalid sign-in status.');
  return value;
}
export async function nativeClaudeLogin(context, { binary, run = execute, spawnChild = spawn, timeoutMs = 600000 } = {}) {
  const check = () => { context.signal?.throwIfAborted(); context.assertCurrent?.(); };
  check();
  if (!binary) {
    const require = createRequire(import.meta.url);
    binary = require.resolve(`@anthropic-ai/claude-code-${process.platform}-${process.arch}/${process.platform === 'win32' ? 'claude.exe' : 'claude'}`);
  }
  const environment = nativeEnvironment(context.env ?? process.env);
  const existing = await status(binary, environment, run); check();
  if (existing.loggedIn && existing.authMethod === 'claude.ai' && await context.prompter.confirm({
    message: `Use the signed-in Claude account${typeof existing.email === 'string' ? ` (${existing.email})` : ''}?`, initialValue: true,
  })) { check(); return; }
  await context.prompter.note('Sign in with the Claude subscription account you want this Gateway to use. If Claude shows an authorization code, paste it into the next field.', 'Claude subscription');
  check();
  const controller = new AbortController();
  const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
  const child = spawnChild(binary, ['auth', 'login', '--claudeai'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'], signal });
  let settled = false, output = '', prompted = false;
  let resolveExit, rejectExit;
  const exit = new Promise((resolve, reject) => { resolveExit = resolve; rejectExit = reject; });
  const fail = () => rejectExit(new Error('Claude sign-in did not complete. Cancel and retry with a subscribed Claude account.'));
  const prompt = async url => {
    check(); await context.openUrl(url); check();
    if (settled) return;
    const code = await context.prompter.text({ message: 'Claude authorization code', sensitive: true, signal,
      placeholder: 'Paste the code shown by Claude', validate: text => /^\S{10,4096}$/.test(text.trim()) ? undefined : 'Paste the complete authorization code.' });
    if (settled) return;
    check(); child.stdin.write(`${code.trim()}\n`);
  };
  const consume = chunk => {
    output = (output + chunk.toString()).slice(-32768);
    const url = !prompted && authorizationUrl(output);
    if (url) { prompted = true; void prompt(url).catch(() => { if (!settled) fail(); }); }
  };
  child.stdin.on('error', fail);
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  child.once('error', fail);
  child.once('exit', code => { settled = true; code === 0 ? resolveExit() : fail(); });
  const timer = setTimeout(fail, timeoutMs); timer.unref();
  try {
    await exit; check();
    const current = await status(binary, environment, run); check();
    if (!current.loggedIn || current.authMethod !== 'claude.ai') throw new Error('Claude subscription sign-in was not confirmed. API or Console credentials were not selected.');
  } finally {
    clearTimeout(timer); controller.abort(); if (!settled) child.kill(); output = '';
  }
}
