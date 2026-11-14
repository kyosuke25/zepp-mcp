// Invoke exactly one combined PoC. Never print request headers or exceptions.
import { readMcpResponse } from './mcp-response.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const token = process.env.MCP_AUTH_TOKEN;
const url = process.env.MCP_URL || 'http://127.0.0.1:8787/mcp';
if (!token) { console.error('MCP_AUTH_TOKEN is required'); process.exit(1); }
try {
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_poc', arguments: {} } }),
  signal: AbortSignal.timeout(90000) });
  if (!response.ok) { console.error(`MCP HTTP ${response.status}; stopped without retry`); process.exitCode = 1; }
  else {
    const reply = await readMcpResponse(response);
    if (!reply.result?.content?.[0]?.text) throw Error();
    const value = JSON.parse(reply.result.content[0].text);
    // Defense in depth for local artifact/output; server already filters Zepp credentials.
    let serialized = JSON.stringify(value, null, 2);
    for (const secret of [token, process.env.ZEPP_EMAIL, process.env.ZEPP_PASSWORD]) {
      if (secret) serialized = serialized.split(secret).join('[REDACTED]');
    }
    await mkdir('output', { recursive: true, mode: 0o700 });
    await writeFile('output/poc-result.json', serialized + '\n', { mode: 0o600 });
    console.log(reply.result.isError ? 'PoC failed; sanitized diagnostics: output/poc-result.json' : 'PoC result: output/poc-result.json');
    if (reply.result.isError) process.exitCode = 1;
  }
} catch { console.error('MCP request failed; stopped without retry'); process.exitCode = 1; }
