import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {patchOpenClaw} from '../claw/patch-openclaw.mjs';

test('pinned compatibility patch is repeatable and the real provider constructs a compliant request', async () => {
 const directory=fileURLToPath(new URL('../node_modules/openclaw/',import.meta.url));
 await patchOpenClaw(directory); await patchOpenClaw(directory);
 const program=`
 import {loginTokenSharing} from './node_modules/openclaw/dist/extensions/openai/token-sharing-oauth.runtime.js';
 const controller=new AbortController();let result;
 try {await loginTokenSharing({signal:controller.signal,existingProfiles:[],isRemote:false,
  openUrl:async value=>{const p=new URL(value).searchParams;result={callback:p.get('redirect_uri'),host:p.get('ext_agent_host_id'),name:p.get('agent_name_hint'),client:p.get('client_id'),resource:p.get('resource'),hasNonce:!!p.get('nonce'),hasPkce:!!p.get('code_challenge')};controller.abort(new Error('test completed'));},
  prompter:{note:async()=>{},select:async()=>{throw Error('unexpected selector');}}});}
 catch(error){if(!controller.signal.aborted)throw error;}
 console.log(JSON.stringify(result));`;
 const child=spawn(process.execPath,['--input-type=module','-e',program],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:['ignore','pipe','pipe'],
  env:{...process.env,ACCOUNT_CLAW_HOST_ID:'urn:uuid:11111111-1111-4111-8111-111111111111'}});
 let output='',error='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 assert.equal(code,0,error);const result=JSON.parse(output.trim());
 assert.equal(result.callback,'http://127.0.0.1:8080/auth/callback');
 assert.equal(result.host,'urn:uuid:11111111-1111-4111-8111-111111111111');
 assert.equal(result.name,'Account Claw');assert.equal(result.client,'dynamic_agent_client');
 assert.equal(result.resource,'https://api.openai.com/v1');assert.equal(result.hasNonce,true);assert.equal(result.hasPkce,true);
});
