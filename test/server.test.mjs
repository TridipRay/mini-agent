import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
test('local HTTP boundary rejects unbound, cross-origin and arbitrary RPC requests', async t => {
  const auth = { summary: () => ({ selected: null, accounts: [] }), pending: null };
  const agent = { summary: () => ({ busy: false, prompts: [], threads: [], items: [] }), binary: 'fixture', busy: false };
  const app = await createApp({ auth, agent, defaultWorkspace: '/fixture' });
  const origin = await app.listen(); t.after(() => app.close());
  const page = await fetch(origin); const cookie = page.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${origin}/api/state`)).status, 403);
  assert.equal((await fetch(`${origin}/api/state`, { headers: { Cookie: cookie, Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).status, 200);
  const response = await fetch(`${origin}/api/command/exec`, { method: 'POST', headers: {
    Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 404);
  assert.equal((await fetch(`${origin}/.state/accounts.json`, { headers: { Cookie: cookie } })).status, 404);
});
