import { randomBytes, randomUUID, createHash, createPublicKey, verify, timingSafeEqual } from 'node:crypto';

export const APP_ID = 'mini_agent';
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random = () => randomBytes(32).toString('base64url');

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validateIdToken(token, jwks, { clientId, nonce, now = Date.now() }) {
  if (typeof token !== 'string') throw new Error('Missing ID token.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid ID token.');
  const header = object(JSON.parse(Buffer.from(parts[0], 'base64url')), 'JWT header');
  const claims = object(JSON.parse(Buffer.from(parts[1], 'base64url')), 'JWT claims');
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit !== undefined) {
    throw new Error('Unsupported ID token signature.');
  }
  const key = jwks.keys?.find(key => key.kid === header.kid && key.kty === 'RSA' &&
    (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'));
  if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) {
    throw new Error('ID token signature verification failed.');
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audiences.includes(clientId) ||
      (audiences.length > 1 && claims.azp !== clientId) || !equal(claims.nonce, nonce) ||
      typeof claims.sub !== 'string' || !claims.sub || !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= now || (claims.nbf !== undefined &&
        (!Number.isFinite(claims.nbf) || claims.nbf * 1000 > now + 30000))) {
    throw new Error('ID token identity, nonce, or lifetime is invalid.');
  }
  return claims;
}

export class Auth {
  constructor({ store, fetch = globalThis.fetch, now = Date.now }) {
    this.store = store; this.fetch = fetch; this.now = now;
    this.pending = null; this.refreshQueue = Promise.resolve();
  }
  async load() {
    this.state = await this.store.read('accounts.json', { hostId: `urn:uuid:${randomUUID()}`, selected: null, accounts: {} });
    object(this.state.accounts, 'saved accounts');
    await this.store.write('accounts.json', this.state);
  }
  summary() {
    return { selected: this.state.selected, accounts: Object.entries(this.state.accounts).map(([key, account]) =>
      ({ key, label: `${account.email || 'ChatGPT account'} · ${account.clientId.slice(-6)}`, signedIn: !!account.accessToken })) };
  }
  active() { return this.state.accounts[this.state.selected] ?? null; }
  async discovery() {
    if (!this.discoveryDocument) {
      const document = await this.json(`${ISSUER}/.well-known/openid-configuration`);
      if (document.issuer !== ISSUER) throw new Error('Unexpected OpenAI identity issuer.');
      for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'revocation_endpoint']) {
        if (new URL(document[field]).origin !== ISSUER) throw new Error(`Unexpected ${field}.`);
      }
      this.discoveryDocument = document;
    }
    return this.discoveryDocument;
  }
  async json(url, options = {}) {
    const response = await this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      let code = 'request_failed';
      try { const body = await response.json(); if (typeof body.error === 'string') code = body.error; }
      catch { /* An HTTP error is still meaningful without a JSON body. */ }
      throw new Error(`OpenAI request failed (${response.status}, ${code}).`);
    }
    return object(await response.json(), 'OpenAI response');
  }
  async start(redirectUri, addAccount = false) {
    const discovery = await this.discovery();
    const retry = addAccount ? null : this.state.retryRegistration;
    const selected = retry ? this.state.accounts[retry.selectedKey] ?? null : addAccount ? null : this.active();
    const verifier = random();
    const pending = { state: random(), nonce: random(), verifier, redirectUri,
      expires: this.now() + 600000, selectedKey: retry ? retry.selectedKey : selected ? this.state.selected : null,
      clientId: retry?.clientId ?? selected?.clientId ?? 'dynamic_agent_client' };
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({ client_id: pending.clientId, ext_agent_host_id: this.state.hostId,
      response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE,
      state: pending.state, nonce: pending.nonce, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
    if (selected?.idToken) url.searchParams.set('id_token_hint', selected.idToken);
    if (pending.clientId === 'dynamic_agent_client') url.searchParams.set('agent_name_hint', APP_ID);
    this.pending = pending;
    return url.toString();
  }
  async callback(query) {
    const pending = this.pending;
    if (!pending || pending.expires <= this.now() || query.getAll('state').length !== 1 ||
        !equal(query.get('state'), pending.state)) throw new Error('Sign-in state is invalid or expired.');
    this.pending = null;
    if (query.has('error')) throw new Error('Sign-in was declined or could not be completed.');
    if (query.getAll('code').length !== 1 || !query.get('code')) throw new Error('Missing authorization code.');
    let clientId = pending.clientId;
    if (clientId === 'dynamic_agent_client') {
      clientId = query.get('client_id');
      if (!clientId || clientId === 'dynamic_agent_client' || query.getAll('client_id').length !== 1) {
        throw new Error('Registration did not return an issued client ID.');
      }
    } else if (query.has('client_id') && (query.getAll('client_id').length !== 1 || query.get('client_id') !== clientId)) {
      throw new Error('Sign-in returned a different client registration.');
    }
    const discovery = await this.discovery();
    // Registration already happened in the browser. Preserve its issued ID if exchange fails.
    this.state = { ...this.state, retryRegistration: { clientId, selectedKey: pending.selectedKey } };
    await this.store.write('accounts.json', this.state);
    const tokens = await this.json(discovery.token_endpoint, { method: 'POST', body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: clientId, code: query.get('code'),
      code_verifier: pending.verifier, redirect_uri: pending.redirectUri, resource: RESOURCE }) });
    const jwks = await this.json(discovery.jwks_uri);
    const claims = validateIdToken(tokens.id_token, jwks, { clientId, nonce: pending.nonce, now: this.now() });
    const previous = this.state.accounts[pending.selectedKey];
    if (previous && previous.subject !== claims.sub) throw new Error('Signed-in account does not match the selected account.');
    const account = this.tokenRecord(tokens, { clientId, subject: claims.sub, email: claims.email ?? null,
      issuer: claims.iss, idToken: tokens.id_token });
    const key = createHash('sha256').update(`${claims.iss}:${clientId}:${claims.sub}`).digest('hex');
    const next = { ...this.state, retryRegistration: null, selected: key, accounts: { ...this.state.accounts, [key]: account } };
    await this.store.write('accounts.json', next);
    this.state = next;
  }
  tokenRecord(tokens, previous) {
    const scopes = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : previous.scopes;
    if (!scopes?.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke') ||
        typeof tokens.access_token !== 'string' || !tokens.access_token ||
        !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || tokens.token_type?.toLowerCase() !== 'bearer') {
      throw new Error('ChatGPT plan usage permission or token lifetime is missing.');
    }
    return { ...previous, scopes, accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? previous.refreshToken ?? null,
      expiresAt: this.now() + tokens.expires_in * 1000 };
  }
  token() {
    const operation = this.refreshQueue.then(async () => {
      const account = this.active();
      if (!account?.accessToken) throw new Error('Continue with ChatGPT first.');
      if (account.expiresAt > this.now() + 60000) return account.accessToken;
      if (!account.refreshToken) throw new Error('Sign in again to renew your session.');
      const discovery = await this.discovery();
      const tokens = await this.json(discovery.token_endpoint, { method: 'POST', body: new URLSearchParams({
        grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken, resource: RESOURCE }) });
      const updated = this.tokenRecord(tokens, account);
      const next = { ...this.state, accounts: { ...this.state.accounts, [this.state.selected]: updated } };
      await this.store.write('accounts.json', next); this.state = next;
      return updated.accessToken;
    });
    this.refreshQueue = operation.catch(() => {});
    return operation;
  }
  async select(key) {
    if (!this.state.accounts[key]) throw new Error('Unknown saved account.');
    const next = { ...this.state, retryRegistration: null, selected: key };
    await this.store.write('accounts.json', next); this.state = next;
  }
  async logout() {
    const account = this.active(); let revoked = true;
    if (account?.refreshToken) {
      try {
        const discovery = await this.discovery();
        const response = await this.fetch(discovery.revocation_endpoint, { method: 'POST', redirect: 'error',
          signal: AbortSignal.timeout(30000), body: new URLSearchParams({ token: account.refreshToken,
            token_type_hint: 'refresh_token', client_id: account.clientId }) });
        revoked = response.status === 200;
      } catch { revoked = false; }
    }
    if (account) {
      const { accessToken, refreshToken, idToken, ...registration } = account;
      const next = { ...this.state, retryRegistration: null, accounts: { ...this.state.accounts, [this.state.selected]: registration } };
      await this.store.write('accounts.json', next); this.state = next;
    }
    this.pending = null;
    return { revoked };
  }
  async models() {
    const token = await this.token();
    const result = await this.json(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` } });
    if (!Array.isArray(result.models)) throw new Error('Unexpected ChatGPT model catalog.');
    return result.models.filter(model => model.visibility === 'list' && typeof model.slug === 'string')
      .map(model => ({ slug: model.slug, name: model.display_name ?? model.slug }));
  }
}
