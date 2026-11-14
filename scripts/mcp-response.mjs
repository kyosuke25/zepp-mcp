/** Read a single stateless MCP result in JSON or legacy SSE framing. */
export async function readMcpResponse(response) {
  const text = await response.text();
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return JSON.parse(text);
  for (const event of text.replaceAll('\r\n', '\n').split('\n\n')) {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    const message = JSON.parse(data);
    if ('result' in message || 'error' in message) return message;
  }
  throw new Error('Missing MCP result');
}
