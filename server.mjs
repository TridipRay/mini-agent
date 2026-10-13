import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Store } from './store.mjs';
import { Auth } from './auth.mjs';
import { Agent, findBinary } from './agent.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
export async function createApp({ auth, agent, defaultWorkspace }) {
  const clients = new Set(); let events = [], eventId = 0, queue = Promise.resolve();
  const cookieValue = randomBytes(32).toString('hex');
  let origin;
  function publish(type, data) {
    const event = { id: ++eventId, type, data }; events.push(event);
    if (events.length > 300) events = events.slice(-300);
    const message = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) if (!client.destroyed) client.write(message);
  }
  agent.publish = publish;
  const state = () => ({ eventId, auth: auth.summary(), agent: agent.summary(),
    defaultWorkspace, authPending: !!auth.pending, binary: agent.binary,
    requests: events.filter(event => event.type === 'request').slice(-20).map(event => event.data),
    activity: events.filter(event => ['agent', 'diagnostic', 'connection'].includes(event.type)).slice(-30)
      .map(({ type, data }) => ({ type, data })) });
  const json = (response, status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  function serial(operation) {
    const next = queue.then(operation); queue = next.catch(() => {}); return next;
  }
  function idle() {
    agent.assertIdle();
    if (auth.pending) throw new Error('Finish or cancel the pending sign-in first.');
  }
  async function body(request) {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON content.');
    let size = 0; const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('Request is too large.');
      chunks.push(chunk);
    }
    const value = JSON.parse(Buffer.concat(chunks));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
    return value;
  }
  async function handle(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.headers.host !== new URL(origin).host) { json(response, 403, { error: 'Invalid local host.' }); return; }
    const url = new URL(request.url, origin);
    if (url.pathname === '/auth/callback' && request.method === 'GET') {
      try {
        await serial(async () => { agent.assertIdle(); await agent.disconnect(); await auth.callback(url.searchParams); });
        publish('account', state());
        response.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' }); response.end();
      } catch (error) {
        publish('error', { message: error.message });
        response.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        response.end(`${error.message}\nReturn to Mini Agent and try sign-in again.`);
      }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store',
        'Set-Cookie': `mini_agent_session=${cookieValue}; HttpOnly; SameSite=Strict; Path=/`,
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      response.end(await readFile(path.join(directory, 'ui/index.html'))); return;
    }
    const cookies = request.headers.cookie?.split(';').map(value => value.trim()) ?? [];
    if (!cookies.includes(`mini_agent_session=${cookieValue}`) ||
        (request.headers.origin && request.headers.origin !== origin) ||
        (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) ||
        (request.method === 'POST' && request.headers.origin !== origin)) {
      json(response, 403, { error: 'Use this app from its own local window.' }); return;
    }
    if (request.method === 'GET' && ['/app.mjs', '/style.css'].includes(url.pathname)) {
      response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' });
      response.end(await readFile(path.join(directory, 'ui', url.pathname.slice(1)))); return;
    }
    if (request.method === 'GET' && url.pathname === '/api/state') { json(response, 200, state()); return; }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const last = Number(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? eventId);
      for (const event of events) if (event.id > last) response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
      clients.add(response);
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
      request.on('close', () => { clearInterval(heartbeat); clients.delete(response); }); return;
    }
    if (request.method === 'POST') {
      const value = await body(request);
      let result;
      switch (url.pathname) {
        case '/api/login': result = await serial(async () => { idle(); return { url: await auth.start(`${origin}/auth/callback`, value.addAccount === true) }; }); break;
        case '/api/login/cancel': auth.pending = null; result = {}; break;
        case '/api/logout': result = await serial(async () => { idle(); await agent.disconnect(); return auth.logout(); }); break;
        case '/api/account': result = await serial(async () => { idle(); await agent.disconnect(); await auth.select(value.key); return {}; }); break;
        case '/api/models': result = await serial(async () => { idle(); return { models: await auth.models() }; }); break;
        case '/api/thread': result = await serial(async () => { idle(); return agent.startThread(value); }); break;
        case '/api/resume': result = await serial(async () => { idle(); return agent.resume(value.threadId); }); break;
        case '/api/send': result = await serial(async () => { idle(); return agent.send(value.text); }); break;
        case '/api/interrupt': result = await agent.interrupt(); break;
        case '/api/answer': agent.answer(value.id, value); result = {}; break;
        default: json(response, 404, { error: 'Unknown operation.' }); return;
      }
      publish('state', state()); json(response, 200, result ?? {}); return;
    }
    json(response, 404, { error: 'Not found.' });
  }
  const server = http.createServer((request, response) => {
    handle(request, response).catch(error => {
      if (!response.headersSent) json(response, 400, { error: error.message });
      else response.destroy();
    });
  });
  return { server, publish, state,
    async listen(port = 0) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      origin = `http://127.0.0.1:${server.address().port}`; return origin;
    },
    async close() {
      for (const client of clients) client.end();
      if (agent.busy) { try { await agent.interrupt(); } catch { /* Closing the owned process still releases the connection. */ } }
      if (agent.rpc) await agent.rpc.close();
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    } };
}

export async function main() {
  const dataDirectory = process.env.MINI_AGENT_DATA_DIR || path.join(directory, '.state');
  const store = new Store(dataDirectory);
  const auth = new Auth({ store }); await auth.load();
  const agent = new Agent({ auth, store, binary: await findBinary(), publish: () => {} }); await agent.load();
  const defaultWorkspace = process.env.MINI_AGENT_WORKSPACE_DIR || path.join(directory, 'workspace'); await mkdir(defaultWorkspace, { recursive: true });
  const app = await createApp({ auth, agent, defaultWorkspace });
  const url = await app.listen(Number(process.env.MINI_AGENT_PORT || 0));
  console.log(`Mini Agent: ${url}\nOpen this address, then choose Continue with ChatGPT.\nCredentials: ${dataDirectory} (owner-only files).`);
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
