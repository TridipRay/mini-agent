import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Rpc } from '../rpc.mjs';
import { findBinary, providerArguments } from '../agent.mjs';

export async function prepareWindowsSandbox(rpc, cwd, timeoutMs = 180000) {
  const readiness = await rpc.request('windowsSandbox/readiness', {});
  if (readiness.status === 'ready') return { ready: true, setupRequired: false };
  if (!['notConfigured', 'updateRequired'].includes(readiness.status)) throw new Error('Unrecognized Windows sandbox readiness.');
  let finish, fail;
  const completion = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const listener = message => {
    if (message.method === 'windowsSandbox/setupCompleted' && message.params?.mode === 'elevated') {
      if (message.params.success === true) finish();
      else fail(new Error(`Windows sandbox setup failed: ${JSON.stringify(message.params.error ?? 'unspecified error')}`));
    }
  };
  rpc.on('notification', listener);
  const onClosed = message => fail(new Error(`Windows sandbox setup connection closed: ${message}`));
  rpc.on('closed', onClosed);
  const timer = setTimeout(() => fail(new Error('Windows sandbox setup timed out; check the Windows setup prompt before retrying.')), timeoutMs);
  // Handle an early setup failure even while the start request is still outstanding.
  completion.catch(() => {});
  try {
    const result = await rpc.request('windowsSandbox/setupStart', { mode: 'elevated', cwd });
    if (result.started !== true) throw new Error('Backend did not start Windows sandbox setup.');
    await completion;
    return { ready: true, setupRequired: true };
  } finally { clearTimeout(timer); rpc.off('notification', listener); rpc.off('closed', onClosed); }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows sandbox setup must run on Windows.');
  const child = spawn(await findBinary(), providerArguments(), { stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ACCESS_TOKEN: 'windows-setup-placeholder' } });
  const rpc = new Rpc(child);
  rpc.on('request', request => rpc.unsupported(request.id));
  try {
    await rpc.request('initialize', { clientInfo: { name: 'mini_agent', title: 'Mini Agent', version: '0.1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false } });
    rpc.send({ method: 'initialized', params: {} });
    console.log('Checking Windows sandbox readiness. If setup is needed, Windows may ask for administrator approval.');
    console.log(JSON.stringify(await prepareWindowsSandbox(rpc, process.env.MINI_AGENT_WORKSPACE_DIR || process.cwd())));
  } finally { await rpc.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
