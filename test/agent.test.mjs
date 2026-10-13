import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Agent } from '../agent.mjs';
import { Store } from '../store.mjs';
const fixturePath = fileURLToPath(new URL('./fixture-agent.mjs', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mini-agent-rpc-test-'));
  const events = [], store = new Store(directory);
  const auth = { token: async () => 'fixture-token', state: { selected: 'test-account' } };
  const agent = new Agent({ auth, store, binary: 'fixture', publish: (type, data) => events.push({ type, data }),
    spawnChild: (_binary, _args, options) => spawn(process.execPath, [fixturePath], options) });
  await agent.load();
  t.after(async () => { if (agent.rpc) await agent.rpc.close(); await rm(directory, { recursive: true, force: true }); });
  await agent.startThread({ model: 'test-model', cwd: directory, sandbox: 'read-only', instructions: 'Stay concise.' });
  return { agent, events, store };
}
test('real stdio framing handles completion-before-response and keeps the visible transcript', async t => {
  const { agent, store } = await fixture(t); await agent.send('hello');
  assert.equal(agent.busy, false); assert.equal(agent.turnId, null);
  assert.equal(agent.summary().items[0].text, 'Reply');
  const saved = await store.read('threads.json', []); assert.equal(saved[0].transcript[0].text, 'Reply');
});
test('a server approval waits for an explicit allowed answer and stale answers are rejected', async t => {
  const { agent } = await fixture(t); await agent.send('approval');
  assert.equal(agent.busy, true); assert.equal(agent.prompts.size, 1);
  assert.throws(() => agent.answer('approval-id', { decision: 'acceptForSession' }), /Invalid/);
  agent.answer('approval-id', { decision: 'accept' });
  await new Promise(resolve => {
    const listener = () => { if (!agent.busy) { clearInterval(timer); resolve(); } };
    const timer = setInterval(listener, 5); setTimeout(() => { clearInterval(timer); resolve(); }, 2000).unref();
  });
  assert.equal(agent.busy, false); assert.equal(agent.summary().items[0].text, 'Approved reply');
  assert.throws(() => agent.answer('approval-id', { decision: 'accept' }), /no longer pending/);
});
test('explicit RPC rejection releases busy state while account ownership limits resumption', async t => {
  const { agent } = await fixture(t);
  await assert.rejects(agent.send('reject'), /Rejected input/); assert.equal(agent.busy, false);
  agent.auth.state.selected = 'different-account';
  await assert.rejects(agent.resume('test-thread'), /does not belong/);
});
