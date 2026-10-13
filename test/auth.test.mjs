import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Auth, validateIdToken } from '../auth.mjs';
import { Store } from '../store.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] };
function idToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
async function fixture(t, { scope = 'openid resource.invoke chatgpt.tokens.use.direct', expires = 3600 } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mini-agent-auth-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let currentTime = Date.now(), transaction, refreshCount = 0, tokensExchanged = 0;
  const fetch = async (url, options = {}) => {
    if (url.endsWith('openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com',
      authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
      token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
      jwks_uri: 'https://auth.openai.com/.well-known/jwks.json', revocation_endpoint: 'https://auth.openai.com/revoke' });
    if (url.endsWith('jwks.json')) return Response.json(jwks);
    if (url.endsWith('oauth/token')) {
      const form = options.body;
      if (form.get('grant_type') === 'refresh_token') {
        refreshCount++; await new Promise(resolve => setTimeout(resolve, 10));
        return Response.json({ access_token: 'renewed-token', refresh_token: 'rotated-refresh', expires_in: 3600, token_type: 'Bearer', scope });
      }
      tokensExchanged++;
      assert.equal(form.get('client_id'), 'oaiapp_test');
      assert.equal(form.get('redirect_uri'), transaction.get('redirect_uri'));
      assert.equal(form.get('resource'), 'https://api.openai.com/v1');
      return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'Bearer', expires_in: expires, scope,
        id_token: idToken({ iss: 'https://auth.openai.com', sub: 'test-user', aud: 'oaiapp_test',
          nonce: transaction.get('nonce'), exp: currentTime / 1000 + 3600, email: 'test@example.invalid' }) });
    }
    throw new Error('Unexpected fixture endpoint.');
  };
  const store = new Store(directory), auth = new Auth({ store, fetch, now: () => currentTime }); await auth.load();
  const url = new URL(await auth.start('http://127.0.0.1:54321/auth/callback'));
  transaction = url.searchParams;
  const callback = new URLSearchParams({ state: transaction.get('state'), code: 'test-code', client_id: 'oaiapp_test' });
  return { auth, store, callback, transaction, directory, counts: () => ({ refreshCount, tokensExchanged }), advance: ms => currentTime += ms };
}
test('dynamic registration exchanges issued client ID, verifies identity and stores owner-only credentials', async t => {
  const f = await fixture(t); await f.auth.callback(f.callback);
  assert.equal(f.transaction.get('client_id'), 'dynamic_agent_client');
  assert.equal(f.auth.active().subject, 'test-user');
  assert.equal((await stat(path.join(f.directory, 'accounts.json'))).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(f.auth.summary()).includes('test-access'));
  await assert.rejects(f.auth.callback(f.callback), /state/);
});
test('unmatched and expired callbacks cannot redeem an authorization code', async t => {
  const f = await fixture(t); const wrong = new URLSearchParams(f.callback); wrong.set('state', 'attacker-state');
  await assert.rejects(f.auth.callback(wrong), /state/);
  f.advance(600001); await assert.rejects(f.auth.callback(f.callback), /expired/);
  assert.equal(f.counts().tokensExchanged, 0);
});
test('an identity grant without ChatGPT plan permission does not become an active credential', async t => {
  const f = await fixture(t, { scope: 'openid email' });
  await assert.rejects(f.auth.callback(f.callback), /permission/);
  assert.equal(f.auth.active(), null);
});
test('ID token validation rejects tampering, wrong audience and nonce, expired claims and unsigned tokens', () => {
  const valid = { iss: 'https://auth.openai.com', sub: 'user', aud: 'client', nonce: 'nonce', exp: Date.now() / 1000 + 100 };
  const context = { clientId: 'client', nonce: 'nonce' };
  assert.equal(validateIdToken(idToken(valid), jwks, context).sub, 'user');
  for (const invalid of [{ ...valid, aud: 'other' }, { ...valid, nonce: 'other' }, { ...valid, exp: 1 }, { ...valid, iss: 'https://evil.invalid' }]) {
    assert.throws(() => validateIdToken(idToken(invalid), jwks, context));
  }
  const parts = idToken(valid).split('.'); parts[1] = Buffer.from(JSON.stringify({ ...valid, sub: 'attacker' })).toString('base64url');
  assert.throws(() => validateIdToken(parts.join('.'), jwks, context), /signature/);
  const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(valid)).toString('base64url')}.`;
  assert.throws(() => validateIdToken(unsigned, jwks, context), /signature/);
});
test('concurrent refreshes rotate credentials only once and reuse the same host ID', async t => {
  const f = await fixture(t, { expires: 1 }); await f.auth.callback(f.callback);
  const host = f.auth.state.hostId;
  assert.deepEqual(await Promise.all([f.auth.token(), f.auth.token()]), ['renewed-token', 'renewed-token']);
  assert.equal(f.counts().refreshCount, 1);
  const saved = JSON.parse(await readFile(path.join(f.directory, 'accounts.json')));
  assert.equal(saved.accounts[saved.selected].refreshToken, 'rotated-refresh'); assert.equal(saved.hostId, host);
});
