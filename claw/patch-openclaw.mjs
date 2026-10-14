import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const hostPreparation = `\t// Account Claw SIWC compatibility: stable per-installation host identity.
\tconst accountClawHostId = process.env.ACCOUNT_CLAW_HOST_ID ?? JSON.parse(await (await import("node:fs/promises")).readFile((await import("node:path")).join(process.env.OPENCLAW_STATE_DIR, "account-claw-host.json"), "utf8")).id;
\tif (typeof accountClawHostId !== "string" || !/^urn:uuid:[0-9a-f-]{36}$/i.test(accountClawHostId)) throw new Error("Account Claw host identity is missing or invalid.");
\tconst url = new URL(\`${'${TOKEN_SHARING_ISSUER}'}/api/accounts/authorize\`);`;
export const patches = [
  { file: 'dist/token-sharing-CmBELw8t.mjs', originalHash: '7a33f2b89b495379545bef015caf0c7378c1c4401e5c4180967c1ccd562e8e08',
    transform: text => text.replace('http://localhost:8080/auth/callback', 'http://127.0.0.1:8080/auth/callback') },
  { file: 'dist/extensions/openai/token-sharing-oauth.runtime.js', originalHash: '373bd3962b578df138e13f853fbf290909dbb1d9c3995b3429e29a5745802470',
    transform: text => text
      .replace('\tconst url = new URL(`${TOKEN_SHARING_ISSUER}/api/accounts/authorize`);', hostPreparation)
      .replace('\t\tnonce,\n\t\t...registering ? { agent_name_hint: "OpenClaw" } : {}',
        '\t\tnonce,\n\t\text_agent_host_id: accountClawHostId,\n\t\t...!registering && existingProfile?.credential.idToken ? { id_token_hint: existingProfile.credential.idToken } : {},\n\t\t...registering ? { agent_name_hint: "Account Claw" } : {}') },
];
const digest = text => createHash('sha256').update(text).digest('hex');
export async function patchOpenClaw(directory) {
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (pkg.name !== 'openclaw' || pkg.version !== '2026.10.3') throw new Error('SIWC compatibility patch requires exactly OpenClaw 2026.10.3.');
  let previous;
  try { previous = JSON.parse(await readFile(path.join(directory, '.account-claw-patches.json'), 'utf8')); }
  catch(error) { if(error.code !== 'ENOENT') throw error; }
  const changes = [];
  for (const patch of patches) {
    const original = await readFile(path.join(directory, patch.file), 'utf8');
    if (previous?.[patch.file] === digest(original)) { changes.push({ file: patch.file, text: original }); continue; }
    if (digest(original) !== patch.originalHash) throw new Error(`Unexpected upstream bytes: ${patch.file}. Refusing to patch an unreviewed build.`);
    const text = patch.transform(original);
    if (text === original) throw new Error(`Compatibility patch did not apply: ${patch.file}`);
    changes.push({ file: patch.file, text });
  }
  const manifest = {};
  for (const change of changes) { await writeFile(path.join(directory, change.file), change.text); manifest[change.file] = digest(change.text); }
  await writeFile(path.join(directory, '.account-claw-patches.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('OpenClaw SIWC compatibility patch verified (loopback callback and stable host identity).');
}
if(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if(!process.argv[2]) throw new Error('Usage: node claw/patch-openclaw.mjs /path/to/openclaw');
  await patchOpenClaw(path.resolve(process.argv[2]));
}
