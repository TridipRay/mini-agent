import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, chmod } from 'node:fs/promises';
import { Store } from '../store.mjs';

export const OPENCLAW_VERSION = '2026.10.3';
export function childEnvironment(environment, { stateDirectory, configFile, hostId }) {
  const result = { ...environment, OPENCLAW_STATE_DIR: stateDirectory, OPENCLAW_CONFIG_PATH: configFile,
    OPENCLAW_PROFILE: 'account-claw', ACCOUNT_CLAW_HOST_ID: hostId };
  // Account mode must not accidentally fall back to an API key inherited from a shell.
  for (const key of Object.keys(result)) {
    if (/(?:API_KEY|API_TOKEN)$/.test(key) || ['OPENCLAW_AGENT_DIR', 'PI_CODING_AGENT_DIR', 'OPENCLAW_GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_PASSWORD'].includes(key)) delete result[key];
  }
  return result;
}
export async function configure({ root, environment = process.env }) {
  const dataDirectory = path.resolve(environment.ACCOUNT_CLAW_DATA_DIR || path.join(root, '.state'));
  const stateDirectory = path.join(dataDirectory, 'openclaw');
  const workspace = path.resolve(environment.ACCOUNT_CLAW_WORKSPACE_DIR || path.join(root, 'workspace'));
  const requestedPort = Number(environment.ACCOUNT_CLAW_PORT || 18889);
  if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) throw new Error('ACCOUNT_CLAW_PORT must be an integer from 1024 to 65535.');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await chmod(dataDirectory, 0o700); await chmod(stateDirectory, 0o700);
  await mkdir(workspace, { recursive: true });
  const store = new Store(stateDirectory);
  let host = await store.read('account-claw-host.json', null);
  if (!host) { host = { id: `urn:uuid:${randomUUID()}` }; await store.write('account-claw-host.json', host); }
  if (typeof host.id !== 'string' || !/^urn:uuid:[0-9a-f-]{36}$/i.test(host.id)) throw new Error('Invalid Account Claw host identity.');
  let config = await store.read('openclaw.json', null);
  if (!config) {
    config = {
      gateway: { mode: 'local', bind: 'loopback', port: requestedPort, auth: { mode: 'token', token: randomBytes(32).toString('hex') } },
      agents: { defaults: { workspace, model: { primary: 'openai/gpt-6.1-sol', fallbacks: [] },
        userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, heartbeat: { every: '0m' } },
        entries: { main: { memory: { search: { provider: 'local', fallback: 'none' } } } } },
      auth: { order: { openai: ['chatgpt-account'] } },
      tools: { profile: 'full', exec: { host: 'gateway', security: 'allowlist', ask: 'always' }, fs: { workspaceOnly: true } },
      cron: { enabled: true },
      plugins: { entries: { 'memory-core': { config: { dreaming: { enabled: false } } } } },
      discovery: { mdns: { mode: 'off' } },
      skills: { workshop: { autonomous: { mode: 'off' } } },
    };
    await store.write('openclaw.json', config);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) || !config.gateway) throw new Error('Invalid Account Claw configuration.');
  return { dataDirectory, stateDirectory, hostId: host.id, workspace: config.agents?.defaults?.workspace ?? workspace,
    port: config.gateway.port, configFile: path.join(stateDirectory, 'openclaw.json') };
}
