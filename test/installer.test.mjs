import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const source = fileURLToPath(new URL('../', import.meta.url));
test('release packaging excludes private state and verifies the shipped production files', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'mini-agent-distribution-test-'));
  try {
    execFileSync(process.execPath, [path.join(source, 'scripts/build-installer.mjs'), temporary]);
    const archive = path.join(temporary, 'Account-Claw-0.2.0.zip');
    const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(entries.every(name => !/\.state|test-artifacts|prompt-investigation|node_modules|accounts\.json|threads\.json/.test(name)));
    for (const [platform, expected, excluded] of [
      ['macOS', 'Install.command', 'Install Windows.cmd'],
      ['Linux', 'install.sh', 'Install.command'],
      ['Windows', 'Install Windows.cmd', 'install.sh'],
    ]) {
      const filename = `Account-Claw-0.2.0-${platform}.zip`;
      const platformArchive = path.join(temporary, filename);
      const contents = execFileSync('unzip', ['-Z1', platformArchive], { encoding: 'utf8' }).split('\n');
      assert.ok(contents.includes(`Account-Claw-0.2.0/${expected}`));
      assert.ok(!contents.includes(`Account-Claw-0.2.0/${excluded}`));
      const sums = await readFile(path.join(temporary, 'SHA256SUMS'), 'utf8');
      assert.ok(sums.includes(`${createHash('sha256').update(await readFile(platformArchive)).digest('hex')}  ${filename}`));
    }
    execFileSync('unzip', ['-q', archive, '-d', temporary]);
    const bundle = path.join(temporary, 'Account-Claw-0.2.0');
    const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8'));
    assert.equal(Object.keys(manifest.files).length, 17);
    for (const file of ['Install Windows.cmd', 'install.ps1', 'Launch Account Claw.cmd', 'launch.ps1']) {
      assert.ok(entries.includes(`Account-Claw-0.2.0/${file}`));
    }
    for (const [name, hash] of Object.entries(manifest.files)) {
      assert.equal(createHash('sha256').update(await readFile(path.join(bundle, 'payload', name))).digest('hex'), hash);
    }
    execFileSync(process.execPath, [path.join(bundle, 'verify.mjs'), path.join(bundle, 'payload'), path.join(bundle, 'manifest.json')]);
    await writeFile(path.join(bundle, 'payload/server.mjs'), 'tampered');
    const verification = spawnSync(process.execPath, [path.join(bundle, 'verify.mjs'), path.join(bundle, 'payload'), path.join(bundle, 'manifest.json')]);
    assert.notEqual(verification.status, 0);
    assert.match(verification.stderr.toString(), /checksum mismatch/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('installer refuses an unrelated existing directory before downloading or overwriting', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'mini-agent-install-guard-'));
  try {
    await mkdir(path.join(temporary, 'payload'));
    const installer = path.join(source, 'installer/install.sh');
    const script = await readFile(installer);
    await writeFile(path.join(temporary, 'install.sh'), script);
    const target = path.join(temporary, 'unrelated');
    await mkdir(target); await writeFile(path.join(target, 'sentinel'), 'keep');
    const result = spawnSync('sh', [path.join(temporary, 'install.sh'), '--prefix', target]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr.toString(), /existing unmarked directory/);
    assert.equal(await readFile(path.join(target, 'sentinel'), 'utf8'), 'keep');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
