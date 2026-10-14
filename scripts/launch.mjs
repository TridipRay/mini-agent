import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { claudeBinary, claudeEnvironment } from '../claude-runtime.mjs';
import { fileURLToPath } from 'node:url';
const command = process.argv[2] ?? 'start';
if (['claude-login', 'claude-status'].includes(command)) {
  const directory = process.env.MINI_AGENT_CLAUDE_CONFIG_DIR || path.join(process.env.MINI_AGENT_DATA_DIR || fileURLToPath(new URL('../.state', import.meta.url)), 'claude');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const child = spawn(claudeBinary(), ['auth', command === 'claude-login' ? 'login' : 'status', command === 'claude-login' ? '--claudeai' : '--json'], { stdio: 'inherit', env: claudeEnvironment(process.env, directory) });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  process.exit(code);
}
if (!['start', 'doctor'].includes(command)) throw new Error('Usage: mini-agent [start|doctor]');
const file = fileURLToPath(new URL(command === 'doctor' ? './probe.mjs' : '../server.mjs', import.meta.url));
const child = spawn(process.execPath, [file], { stdio: ['inherit', 'pipe', 'inherit'], env: process.env });
let pending = '', opened = false;
child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  pending += chunk.toString();
  const match = pending.match(/Mini Agent: (http:\/\/127\.0\.0\.1:\d+)/);
  if (command === 'start' && match && !opened && process.env.MINI_AGENT_NO_OPEN !== '1') {
    opened = true;
    // Windows uses its native URL opener. The only argument is our validated loopback URL.
    const executable = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', match[1]] : [match[1]];
    const opener = spawn(executable, args, { stdio: 'ignore' });
    opener.on('error', () => console.log(`Open ${match[1]} in your browser.`));
  }
  if (pending.length > 4096) pending = pending.slice(-4096);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
