import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Rpc } from '../rpc.mjs';
import { prepareWindowsSandbox } from '../scripts/windows-setup.mjs';

async function withBackend(option, run) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixture-agent.mjs', import.meta.url)), option], { stdio: ['pipe', 'pipe', 'pipe'] });
  const rpc = new Rpc(child);
  try {
    await rpc.request('initialize', { clientInfo: { name: 'mini_agent', version: '0.1.0' } });
    rpc.send({ method: 'initialized', params: {} });
    await run(rpc);
  } finally { await rpc.close(); }
}
test('Windows setup keeps an already ready sandbox without running setup', async () => {
  await withBackend('--sandbox-ready', async rpc => {
    assert.deepEqual(await prepareWindowsSandbox(rpc, process.cwd(), 1000), { ready: true, setupRequired: false });
  });
});
test('Windows setup handles completion before the start response over real stdio', async () => {
  await withBackend('--sandbox-new', async rpc => {
    assert.deepEqual(await prepareWindowsSandbox(rpc, process.cwd(), 1000), { ready: true, setupRequired: true });
  });
});
test('declined Windows setup propagates failure instead of declaring readiness', async () => {
  await withBackend('--sandbox-fail', async rpc => {
    await assert.rejects(prepareWindowsSandbox(rpc, process.cwd(), 1000), /Approval declined/);
  });
});
