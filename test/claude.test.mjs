import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ClaudeAuth } from '../claude-auth.mjs';
import { ClaudeAgent } from '../claude-agent.mjs';
import { claudeEnvironment, claudeBinary } from '../claude-runtime.mjs';
import { Store } from '../store.mjs';
import { createApp } from '../server.mjs';

const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Timed out waiting for runtime state.'); };
test('Claude subscription status excludes Console billing and filters inherited credentials', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'claude-auth-test-')); t.after(() => rm(directory, {recursive:true,force:true}));
  let status = {loggedIn:false, authMethod:'none'};
  const auth = new ClaudeAuth({binary:'fixture',directory,run:async()=>({stdout:JSON.stringify(status)})});
  await auth.load(); assert.equal(auth.state.selected,null);
  status = {loggedIn:true,authMethod:'api_key',email:'test@example.invalid'};
  await auth.load(); assert.equal(auth.state.selected,null);
  status.authMethod='claude.ai'; await auth.load(); const account=auth.state.selected;
  status.email='other@example.invalid'; await auth.load(); assert.notEqual(auth.state.selected,account);
  const env = claudeEnvironment({ANTHROPIC_API_KEY:'secret', ANTHROPIC_AUTH_TOKEN:'secret', ANTHROPIC_BASE_URL:'other', CLAUDE_CODE_USE_BEDROCK:'1', CLAUDE_CODE_OAUTH_TOKEN:'secret', ACCESS_TOKEN:'secret', CLAUDECODE:'nested', PATH:'/safe'}, directory);
  assert.deepEqual(env,{PATH:'/safe',CLAUDE_CONFIG_DIR:directory});
});

for (const decision of ['accept','decline']) test(`Claude adapter ${decision} controls a real file mutation and persists its transcript`, async t => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'claude-agent-test-')); t.after(()=>rm(directory,{recursive:true,force:true}));
  const auth={binary:'fixture', environment:{}, state:{selected:'claude:one'},load:async()=>{}};
  const observed=[]; let target;
  const query=({options})=>{
    const stream=(async function*(){
      yield {type:'system',subtype:'init'};
      yield {type:'assistant',uuid:'tool-message',message:{content:[{type:'tool_use',id:'tool1',name:'Write',input:{file_path:target,content:'approved'}}]}};
      const response=await options.canUseTool('Write',{file_path:target,content:'approved'},{signal:options.abortController.signal});
      if(response.behavior==='allow') await writeFile(target,response.updatedInput.content);
      yield {type:'assistant',uuid:'response',message:{content:[{type:'text',text:response.behavior}]}};
      yield {type:'result',subtype:'success',is_error:false};
    })(); stream.close=()=>{}; return stream;
  };
  const store=new Store(directory); const agent=new ClaudeAgent({auth,store,query,publish:(type,data)=>observed.push({type,data})}); await agent.load();
  await agent.startThread({cwd:directory,model:'sonnet',sandbox:'read-only'}); target=path.join(directory,'output.txt');
  await agent.send('Create output.txt'); await waitFor(()=>agent.prompts.size===1);
  await assert.rejects(readFile(target),{code:'ENOENT'});
  const id=[...agent.prompts.keys()][0]; agent.answer(id,{decision}); await agent.running;
  if(decision==='accept') assert.equal(await readFile(target,'utf8'),'approved'); else await assert.rejects(readFile(target),{code:'ENOENT'});
  assert.equal(agent.busy,false); assert.equal(agent.prompts.size,0);
  assert.throws(()=>agent.answer(id,{decision:'accept'}),/no longer pending/);
  const saved=await store.read('claude-threads.json',[]); assert.equal(saved[0].started,true);
  assert.ok(saved[0].transcript.some(item=>item.type==='agentMessage'&&item.text===(decision==='accept'?'allow':'deny')));
  const restored=new ClaudeAgent({auth,store,query}); await restored.load(); await restored.resume(saved[0].id);
  assert.equal(restored.items.size,saved[0].transcript.length);
  auth.state.selected='claude:other'; await assert.rejects(restored.resume(saved[0].id),/does not belong/);
});

test('local provider switch rejects unknown providers and running turns', async t=>{
  const make=()=>({auth:{summary:()=>({selected:null,accounts:[]}),load:async()=>{}},agent:{binary:'fixture',busy:false,assertIdle(){if(this.busy)throw new Error('busy');},disconnect:async()=>{},summary:()=>({prompts:[],threads:[],items:[]})}});
  const openai=make(),claude=make(); const app=await createApp({...openai,defaultWorkspace:'/fixture',providers:{openai,claude}}); const origin=await app.listen(); t.after(()=>app.close());
  const cookie=(await fetch(origin)).headers.get('set-cookie').split(';')[0];
  const post=provider=>fetch(origin+'/api/provider',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({provider})});
  assert.equal((await post('invalid')).status,400); openai.agent.busy=true; assert.equal((await post('claude')).status,400); openai.agent.busy=false;
  assert.equal((await post('claude')).status,200); const state=await (await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json(); assert.equal(state.provider,'claude');
});

test('private Claude runtime reports signed-out state without reading token storage', async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'claude-native-test-')); t.after(()=>rm(directory,{recursive:true,force:true}));
  const auth=new ClaudeAuth({binary:claudeBinary(),directory}); await auth.load(); assert.deepEqual(auth.summary().accounts,[]);
});

test('Claude questions reach the host and interrupt cancels a pending tool approval', async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'claude-interrupt-test-')); t.after(()=>rm(directory,{recursive:true,force:true}));
  const auth={binary:'fixture',environment:{},state:{selected:'claude:one'},load:async()=>{}};
  let answer,mutation;
  const query=({options})=>{
    const stream=(async function*(){
      yield {type:'system',subtype:'init'};
      answer=await options.canUseTool('AskUserQuestion',{questions:[{question:'Which file?',options:[]}]},{signal:options.abortController.signal});
      mutation=await options.canUseTool('Write',{file_path:'target.txt'},{signal:options.abortController.signal});
      yield {type:'result',subtype:'success'};
    })(); stream.close=()=>{}; return stream;
  };
  const agent=new ClaudeAgent({auth,store:new Store(directory),query}); await agent.load();
  await agent.startThread({cwd:directory,model:'sonnet',sandbox:'read-only'}); await agent.send('Ask then write');
  await waitFor(()=>agent.prompts.size===1); const question=[...agent.prompts.values()][0];
  assert.equal(question.method,'item/tool/requestUserInput'); agent.answer(question.id,{answers:{'0':'example.txt'}});
  await waitFor(()=>[...agent.prompts.values()].some(p=>p.params.tool==='Write'));
  await agent.interrupt(); assert.equal(answer.updatedInput.answers['Which file?'],'example.txt');
  assert.equal(mutation.behavior,'deny'); assert.equal(agent.busy,false); assert.equal(agent.prompts.size,0);
});
