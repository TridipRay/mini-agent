import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const hostPreparation = `\t// Account Claw SIWC compatibility: stable per-installation host identity.
\tconst accountClawHostId = process.env.ACCOUNT_CLAW_HOST_ID ?? JSON.parse(await (await import("node:fs/promises")).readFile((await import("node:path")).join(process.env.OPENCLAW_STATE_DIR, "account-claw-host.json"), "utf8")).id;
\tif (typeof accountClawHostId !== "string" || !/^urn:uuid:[0-9a-f-]{36}$/i.test(accountClawHostId)) throw new Error("Account Claw host identity is missing or invalid.");
\tconst url = new URL(\`${'${TOKEN_SHARING_ISSUER}'}/api/accounts/authorize\`);`;
const nativeChoice = choice => choice.provider === 'anthropic' && choice.method === 'cli';
export const patches = [
  { file: 'dist/extensions/anthropic/openclaw.plugin.json', originalHash: '9f0a3f432a41aa588a54a152169d6389ed9af72072a7235f5c8e10f08b1cff97',
    transform: text => {
      const manifest = JSON.parse(text);
      const choice = manifest.providerAuthChoices.find(nativeChoice);
      if (!choice) throw new Error('Native Claude auth metadata is missing.');
      Object.assign(choice, { credentialOnly: true, appGuidedAuth: 'oauth', choiceLabel: 'Claude subscription (Claude Code)', choiceHint: 'Sign in through the native Claude Code runtime; no API key required' });
      return JSON.stringify(manifest, null, 2) + '\n';
    } },
  { file: 'dist/register.runtime-D0iE-zLV.mjs', originalHash: '48fc34a9c5898fb765512519c7fa8a6afd4adf6f563012d8037d30cb613129be',
    transform: text => 'import { nativeClaudeLogin } from "./extensions/anthropic/account-claw-native-login.mjs";\n' + text.replace(
      'run: async (ctx) => await (await loadAuthRuntime()).runAnthropicCliMigration(ctx),',
      'run: async (ctx) => { if (ctx.isRemote) await nativeClaudeLogin(ctx); return await (await loadAuthRuntime()).runAnthropicCliMigration(ctx); },') },
  { file: 'dist/models-auth-login-CKv9Nvo3.mjs', originalHash: '40814dc6e36d5f8ecb133f2bac5158b3660308bc85c20f55c252b121259db018',
    transform: text => text.replace('credentialOnly: true,', 'credentialOnly: !(choice.pluginId === "anthropic" && choice.providerId === "anthropic" && choice.methodId === "cli"),')
      .replace('if (result.profiles.length === 0) throw', 'if (result.profiles.length === 0 && !(choice.pluginId === "anthropic" && choice.providerId === "anthropic" && choice.methodId === "cli")) throw') },
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
  await copyFile(new URL('./native-claude-login.mjs', import.meta.url), path.join(directory, 'dist/extensions/anthropic/account-claw-native-login.mjs'));
  await writeFile(path.join(directory, '.account-claw-patches.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('OpenClaw account compatibility patches verified (ChatGPT and native Claude UI login).');
}
if(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if(!process.argv[2]) throw new Error('Usage: node claw/patch-openclaw.mjs /path/to/openclaw');
  await patchOpenClaw(path.resolve(process.argv[2]));
}
