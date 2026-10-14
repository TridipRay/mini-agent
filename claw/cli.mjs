import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configure, childEnvironment } from './config.mjs';

export function invocation(command, args, port) {
  switch (command) {
    case 'setup': return ['config', 'validate'];
    case 'login': return ['models', 'auth', 'login', '--provider', 'openai', '--method', 'siwc', '--profile-id', 'chatgpt-account', '--set-default'];
    case 'login-codex': return ['models', 'auth', 'login', '--provider', 'openai', '--method', 'oauth', '--profile-id', 'chatgpt-account', '--set-default'];
    case 'start': return ['gateway', 'run', '--bind', 'loopback', '--port', String(port)];
    case 'dashboard': return ['dashboard'];
    case 'doctor': return ['config', 'validate'];
    case 'service-install': return ['gateway', 'install', '--port', String(port)];
    case 'claw': return args;
    default: throw new Error('Usage: account-claw setup|login|login-codex|start|dashboard|doctor|service-install|claw <OpenClaw arguments>');
  }
}
export async function main(argv = process.argv.slice(2)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const [command = 'start', ...args] = argv;
  const settings = await configure({ root });
  const binary = process.env.ACCOUNT_CLAW_OPENCLAW || path.join(root, 'node_modules', 'openclaw', 'openclaw.mjs');
  await access(binary);
  const params = invocation(command, args, settings.port);
  const child = spawn(process.execPath, [binary, ...params], { stdio: 'inherit',
    env: childEnvironment(process.env, settings), cwd: settings.workspace });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))); });
  if (code !== 0) { process.exitCode = code; return; }
  if (command === 'setup') console.log('Configuration ready. Run account-claw login to authorize ChatGPT, then account-claw start and account-claw dashboard.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
