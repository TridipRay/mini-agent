import { promisify } from 'node:util';
import { spawn, execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configure, childEnvironment } from './config.mjs';

export function invocation(command, args, port) {
  switch (command) {
    case 'setup': return ['config', 'validate'];
    case 'login': return ['models', 'auth', 'login', '--provider', 'openai', '--method', 'siwc', '--profile-id', 'chatgpt-account', '--set-default'];
    case 'login-claude': return ['models', 'auth', 'login', '--provider', 'anthropic', '--method', 'cli', '--set-default'];
    case 'login-codex': return ['models', 'auth', 'login', '--provider', 'openai', '--method', 'oauth', '--profile-id', 'chatgpt-account', '--set-default'];
    case 'start': return ['gateway', 'run', '--bind', 'loopback', '--port', String(port)];
    case 'dashboard': return ['dashboard'];
    case 'doctor': return ['config', 'validate'];
    case 'service-install': return ['gateway', 'install', '--port', String(port)];
    case 'claw': return args;
    default: throw new Error('Usage: account-claw setup|login|login-claude|claude-status|login-codex|start|dashboard|doctor|service-install|claw <OpenClaw arguments>');
  }
}
export async function main(argv = process.argv.slice(2)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const [command = 'start', ...args] = argv;
  const settings = await configure({ root });
  const binary = process.env.ACCOUNT_CLAW_OPENCLAW || path.join(root, 'node_modules', 'openclaw', 'openclaw.mjs');
  await access(binary);
  const environment = childEnvironment(process.env, settings);
  const dependencyRoot = path.resolve(path.dirname(binary), '..');
  environment.PATH = `${path.join(dependencyRoot, '.bin')}${path.delimiter}${environment.PATH ?? ''}`;
  const nativeClaude = path.join(dependencyRoot, '@anthropic-ai', `claude-code-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'claude.exe' : 'claude');
  if (command === 'doctor' || command === 'setup') {
    const { stdout } = await promisify(execFile)(nativeClaude, ['--version'], { env: environment, timeout: 15000 });
    if (!stdout.includes('Claude Code')) throw new Error('Private Claude runtime version check failed.');
    console.log(`Private Claude runtime: ${stdout.trim()}`);
  }
  if (command === 'login-claude' || command === 'claude-status') {
    await access(nativeClaude);
    const login = spawn(nativeClaude, command === 'login-claude' ? ['auth', 'login', '--claudeai'] : ['auth', 'status', '--json'],
      { stdio: 'inherit', env: environment, cwd: settings.workspace });
    const code = await new Promise((resolve, reject) => { login.once('error', reject); login.once('exit', code => resolve(code ?? 1)); });
    if (code !== 0 || command === 'claude-status') { process.exitCode = code; return; }
  }
  const params = invocation(command, args, settings.port);
  const child = spawn(process.execPath, [binary, ...params], { stdio: 'inherit',
    env: environment, cwd: settings.workspace });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))); });
  if (code !== 0) { process.exitCode = code; return; }
  if (command === 'setup') console.log('Configuration ready. Run account-claw login to authorize ChatGPT, then account-claw start and account-claw dashboard.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
