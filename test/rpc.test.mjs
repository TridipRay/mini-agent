import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Rpc } from '../rpc.mjs';
test('a dying owned process rejects pending requests as outcome unknown', async () => {
  const child = spawn(process.execPath, ['-e', "process.stdin.once('data', () => process.exit(3))"], { stdio: ['pipe', 'pipe', 'pipe'] });
  const rpc = new Rpc(child);
  await assert.rejects(rpc.request('turn/start', {}, 2000), error => error.outcomeUnknown === true && /exited/.test(error.message));
  assert.equal(rpc.pending.size, 0); assert.equal(rpc.closed, true);
});
