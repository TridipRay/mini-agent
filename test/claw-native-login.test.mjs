import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nativeClaudeLogin, authorizationUrl, nativeEnvironment } from '../claw/native-claude-login.mjs';
const fixture = fileURLToPath(new URL('./fixture-claude-login.mjs', import.meta.url));
const nativeUrl = 'https://claude.com/cai/oauth/authorize?' + new URLSearchParams({response_type:'code',client_id:'9d1c250a-e61b-44d9-88ed-5944d1962f5e',code_challenge:'A'.repeat(43),state:'B'.repeat(32)});

test('native CLI output only opens complete vendor authorization URLs',()=>{
 assert.equal(authorizationUrl(nativeUrl),undefined);
 assert.equal(authorizationUrl(nativeUrl+'\n'),nativeUrl);
 assert.equal(authorizationUrl(nativeUrl.replace('claude.com','attacker.invalid')+'\n'),undefined);
 assert.equal(authorizationUrl(nativeUrl.replace('code_challenge='+ 'A'.repeat(43),'code_challenge=short')+'\n'),undefined);
 assert.equal(nativeEnvironment({ANTHROPIC_API_KEY:'secret',CLAUDE_CODE_OAUTH_TOKEN:'secret',CLAUDE_CONFIG_DIR:'/private',PATH:'/safe'}).ANTHROPIC_API_KEY,undefined);
});
test('dashboard sign-in feeds a masked code to the native process and confirms subscription status', async()=>{
 let status={loggedIn:false,authMethod:'none'}; const opened=[]; let input;
 const ctx={env:{CLAUDE_CONFIG_DIR:'/private'},assertCurrent(){},openUrl:async url=>opened.push(url),prompter:{note:async()=>{},text:async params=>{input=params;return 'test-authorization-code#state';}}};
 await nativeClaudeLogin(ctx,{binary:'fixture',run:async()=>({stdout:JSON.stringify(status)}),spawnChild:(_binary,args,options)=>{
   assert.deepEqual(args,['auth','login','--claudeai']);
   const child=spawn(process.execPath,[fixture],options);
   child.on('exit',code=>{if(code===0)status={loggedIn:true,authMethod:'claude.ai'};});return child;
 }});
 assert.deepEqual(opened,[nativeUrl]);assert.equal(input.sensitive,true);assert.equal(input.validate('short'),'Paste the complete authorization code.');
});
test('cancelling the dashboard flow terminates the native login without writing a code',async()=>{
 const controller=new AbortController(); let child;
 const ctx={signal:controller.signal,assertCurrent(){},openUrl:async()=>{},prompter:{note:async()=>{},text:async({signal})=>{controller.abort(); throw signal.reason;}}};
 await assert.rejects(nativeClaudeLogin(ctx,{binary:'fixture',run:async()=>({stdout:'{"loggedIn":false}'}),spawnChild:(_binary,_args,options)=>(child=spawn(process.execPath,[fixture],options))}),/did not complete/);
 assert.equal(child.killed,true);
});
test('existing subscription reuse avoids launching another login; Console status is rejected after login',async()=>{
 const ctx={assertCurrent(){},prompter:{confirm:async()=>true}};
 await nativeClaudeLogin(ctx,{binary:'fixture',run:async()=>({stdout:'{"loggedIn":true,"authMethod":"claude.ai"}'}),spawnChild:()=>{throw new Error('Unexpected login');}});
 const loginCtx={...ctx,env:{},openUrl:async()=>{},prompter:{note:async()=>{},text:async()=> 'test-authorization-code#state'}};
 await assert.rejects(nativeClaudeLogin(loginCtx,{binary:'fixture',run:async()=>({stdout:'{"loggedIn":true,"authMethod":"api_key"}'}),spawnChild:(_binary,_args,options)=>spawn(process.execPath,[fixture],options)}),/subscription sign-in was not confirmed/);
});

test('the production gateway requires administrator scope for native Claude sign-in',async()=>{
 const {modelsAuthLoginHandlers}=await import('../node_modules/openclaw/dist/models-auth-login-CKv9Nvo3.mjs');
 let response;
 await modelsAuthLoginHandlers['models.authLogin']({params:{sessionId:'native-login-test',agentId:'main',authChoice:'anthropic/anthropic-cli'},
   client:{connect:{scopes:['operator.read']}},context:{getRuntimeConfig(){throw new Error('Unauthorized context was reached');}},
   respond:(success,_value,error)=>{response={success,error};}});
 assert.equal(response.success,false);assert.match(response.error.message,/administrator connection/);
});
