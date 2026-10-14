import { mkdir, mkdtemp, readFile, writeFile, copyFile, chmod, rm, lstat, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const source = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] || path.join(source, 'dist'));
const { version } = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a numeric release version.');
// Explicit allowlist prevents credentials, histories and research captures entering a release.
const files = ['package-lock.json', 'OPENCLAW-LICENSE.txt', 'package.json', 'server.mjs', 'store.mjs', 'auth.mjs', 'agent.mjs', 'rpc.mjs',
  'ui/index.html', 'ui/style.css', 'ui/app.mjs', 'scripts/probe.mjs', 'scripts/launch.mjs', 'claw/config.mjs', 'claw/cli.mjs', 'claw/patch-openclaw.mjs', 'claw/install-manifest.mjs'];
const temporary = await mkdtemp(path.join(os.tmpdir(), 'mini-agent-package-'));
const name = `Account-Claw-${version}`;
const root = path.join(temporary, name);
const manifest = { version, files: {} };
try {
  await mkdir(path.join(root, 'payload'), { recursive: true });
  for (const file of files) {
    const original = path.join(source, file);
    if (!(await lstat(original)).isFile()) throw new Error(`Not a regular release file: ${file}`);
    const destination = path.join(root, 'payload', file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(original, destination); await chmod(destination, 0o644);
    manifest.files[file] = createHash('sha256').update(await readFile(original)).digest('hex');
  }
  for (const file of ['install.sh', 'Install.command', 'account-claw', 'verify.mjs',
    'install.ps1', 'launch.ps1', 'Install Windows.cmd', 'Launch Account Claw.cmd']) {
    await copyFile(path.join(source, 'installer', file), path.join(root, file));
    if (/\.(cmd|ps1)$/.test(file)) {
      const script = await readFile(path.join(root, file), 'utf8');
      await writeFile(path.join(root, file), script.replace(/\r?\n/g, '\r\n'));
    }
    await chmod(path.join(root, file), file.endsWith('.mjs') ? 0o644 : 0o755);
  }
  await copyFile(path.join(source, 'installer', 'README.md'), path.join(root, 'README.md'));
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(output, { recursive: true });
  const archive = path.join(output, `${name}.zip`);
  // zip updates old archives, so build at a fresh temporary path instead.
  const stagedArchive = path.join(temporary, `${name}.zip`);
  execFileSync('zip', ['-q', '-r', stagedArchive, name], { cwd: temporary });
  await copyFile(stagedArchive, archive);
  const checksum = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${archive}.sha256`, `${checksum}  ${path.basename(archive)}\n`);
  console.log(archive);
  const platformFiles = {
    macOS: ['install.sh', 'Install.command', 'account-claw', 'verify.mjs'],
    Linux: ['install.sh', 'account-claw', 'verify.mjs'],
    Windows: ['install.ps1', 'launch.ps1', 'Install Windows.cmd', 'Launch Account Claw.cmd', 'verify.mjs'],
  };
  const checksums = [`${checksum}  ${path.basename(archive)}`];
  for (const [platform, scripts] of Object.entries(platformFiles)) {
    const platformRoot = path.join(temporary, platform, name);
    await mkdir(platformRoot, { recursive: true });
    // Copy only the public, allowlisted bundle; never the working tree.
    await cp(path.join(root, 'payload'), path.join(platformRoot, 'payload'), { recursive: true });
    for (const file of [...scripts, 'manifest.json', 'README.md']) {
      await copyFile(path.join(root, file), path.join(platformRoot, file));
      if (scripts.includes(file) && !file.endsWith('.mjs')) await chmod(path.join(platformRoot, file), 0o755);
    }
    const filename = `${name}-${platform}.zip`;
    const staged = path.join(temporary, filename);
    execFileSync('zip', ['-q', '-r', staged, name], { cwd: path.dirname(platformRoot) });
    await copyFile(staged, path.join(output, filename));
    checksums.push(`${createHash('sha256').update(await readFile(staged)).digest('hex')}  ${filename}`);
    console.log(path.join(output, filename));
  }
  await writeFile(path.join(output, 'SHA256SUMS'), checksums.join('\n') + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
