import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configure, childEnvironment } from '../claw/config.mjs';
import { invocation } from '../claw/cli.mjs';

test('fresh account profile is private and preserves operator settings on subsequent setup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'account-claw-test-'));
  try {
    const settings = await configure({ root, environment: { ACCOUNT_CLAW_PORT: '19987' } });
    const config = JSON.parse(await readFile(settings.configFile, 'utf8'));
    assert.equal(config.gateway.bind, 'loopback');
    assert.equal(config.tools.exec.ask, 'always');
    assert.equal(config.plugins.entries['memory-core'].config.dreaming.enabled, false);
    assert.equal(config.agents.entries.main.memory.search.fallback, 'none');
    if(process.platform !== 'win32') assert.equal((await stat(settings.stateDirectory)).mode & 0o777, 0o700);
    config.gateway.port = 19988;
    config.agents.defaults.model.primary = 'openai/operator-choice';
    await writeFile(settings.configFile, JSON.stringify(config));
    const again = await configure({ root, environment: { ACCOUNT_CLAW_PORT: '19989' } });
    assert.equal(again.port, 19988);
    assert.equal(again.hostId, settings.hostId);
    assert.equal(JSON.parse(await readFile(settings.configFile,'utf8')).agents.defaults.model.primary, 'openai/operator-choice');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('child account mode cannot inherit API-key billing or another agent directory', () => {
  const env=childEnvironment({OPENAI_API_KEY:'fixture',ANTHROPIC_API_KEY:'fixture',OPENCLAW_AGENT_DIR:'/unrelated',SLACK_BOT_TOKEN:'channel-fixture'},
    {stateDirectory:'/private-profile',configFile:'/private-profile/config.json'});
  assert.equal(env.OPENAI_API_KEY,undefined); assert.equal(env.ANTHROPIC_API_KEY,undefined);
  assert.equal(env.OPENCLAW_AGENT_DIR,undefined); assert.equal(env.OPENCLAW_STATE_DIR,'/private-profile');
  assert.equal(env.SLACK_BOT_TOKEN,'channel-fixture');
  assert.ok(invocation('login',[],18889).includes('siwc'));
  assert.throws(()=>invocation('unsupported',[],18889),/Usage/);
});
