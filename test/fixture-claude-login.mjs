const url = new URL('https://claude.com/cai/oauth/authorize');
url.search = new URLSearchParams({ response_type: 'code', client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', code_challenge: 'A'.repeat(43), state: 'B'.repeat(32) });
process.stdout.write(`Opening browser…\n${url}\nPaste code here if prompted > `);
process.stdin.on('data', chunk => { process.exit(chunk.toString().trim() === 'test-authorization-code#state' ? 0 : 1); });
