import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin });
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
let initialized = false, acknowledged = false, prompts = new Map();
lines.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    initialized = true; send({ id: request.id, result: { userAgent: 'fixture', platformFamily: 'unix' } }); return;
  }
  if (request.method === 'initialized') { acknowledged = true; return; }
  if (!request.method && prompts.has(request.id)) {
    const turn = prompts.get(request.id); prompts.delete(request.id);
    send({ method: 'item/agentMessage/delta', params: { threadId: 'test-thread', turnId: turn, itemId: 'answer', delta: 'Approved reply' } });
    send({ method: 'turn/completed', params: { threadId: 'test-thread', turn: { id: turn, status: 'completed', items: [] } } }); return;
  }
  if (!initialized || !acknowledged) { send({ id: request.id, error: { code: -1, message: 'Handshake required' } }); return; }
  if (request.method === 'windowsSandbox/readiness') {
    send({ id: request.id, result: { status: process.argv.includes('--sandbox-ready') ? 'ready' : 'notConfigured' } });
  } else if (request.method === 'windowsSandbox/setupStart') {
    // Exercise completion arriving before the setup-start response.
    send({ method: 'windowsSandbox/setupCompleted', params: { mode: 'elevated', success: !process.argv.includes('--sandbox-fail'), error: process.argv.includes('--sandbox-fail') ? 'Approval declined' : null } });
    send({ id: request.id, result: { started: true } });
  } else if (request.method === 'thread/start') {
    send({ id: request.id, result: { thread: { id: 'test-thread', turns: [], status: { type: 'idle' } }, model: 'test-model' } });
  } else if (request.method === 'thread/resume') {
    send({ id: request.id, result: { thread: { id: 'test-thread', turns: [], status: { type: 'idle' } } } });
  } else if (request.method === 'turn/start') {
    const text = request.params.input[0].text;
    if (text === 'reject') { send({ id: request.id, error: { code: -1, message: 'Rejected input' } }); return; }
    send({ method: 'turn/started', params: { threadId: 'test-thread', turn: { id: 'test-turn', status: 'inProgress' } } });
    if (text === 'approval') {
      prompts.set('approval-id', 'test-turn');
      send({ method: 'item/commandExecution/requestApproval', id: 'approval-id', params: {
        threadId: 'test-thread', turnId: 'test-turn', itemId: 'command', command: 'echo hello', availableDecisions: ['accept', 'decline'] } });
    } else {
      send({ method: 'item/agentMessage/delta', params: { threadId: 'test-thread', turnId: 'test-turn', itemId: 'answer', delta: 'Reply' } });
      send({ method: 'turn/completed', params: { threadId: 'test-thread', turn: { id: 'test-turn', status: 'completed', items: [] } } });
    }
    // Deliberately notify completion before the request response.
    setTimeout(() => send({ id: request.id, result: { turn: { id: 'test-turn', status: 'inProgress', items: [] } } }), 10);
  } else if (request.method === 'turn/interrupt') {
    send({ id: request.id, result: {} });
    send({ method: 'turn/completed', params: { threadId: 'test-thread', turn: { id: 'test-turn', status: 'interrupted', items: [] } } });
  } else send({ id: request.id, error: { code: -32601, message: 'Unknown fixture operation' } });
});
