import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Rpc } from '../rpc.mjs';
import { findBinary, providerArguments } from '../agent.mjs';
import { APP_ID } from '../auth.mjs';

// Metadata only: no account, thread, model-list or inference request is made.
const binary = await findBinary();
const child = spawn(binary, providerArguments(), { stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ACCESS_TOKEN: 'metadata-probe-placeholder' } });
const rpc = new Rpc(child);
const diagnostics = []; rpc.on('diagnostic', text => diagnostics.push(text));
try {
  const result = await rpc.request('initialize', { clientInfo: { name: APP_ID, title: 'Mini Agent', version: '0.1.0' },
    capabilities: { experimentalApi: false, requestAttestation: false } }, 15000);
  rpc.send({ method: 'initialized', params: {} });
  const output = { binary, handshake: 'passed', userAgent: result.userAgent,
    platformFamily: result.platformFamily, platformOs: result.platformOs,
    inferenceTested: false, accountAuthenticationTested: false, diagnostics };
  const directory = fileURLToPath(new URL('../test-artifacts/', import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/live-probe.json`, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ binary, handshake: 'passed', inferenceTested: false }));
} finally { await rpc.close(); }
