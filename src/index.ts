import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { DecodeError, decodeWorkout } from './decoder';
import { ZeppClient, ZeppError, type ZeppConfig } from './zepp-client';

export interface Env extends ZeppConfig { MCP_AUTH_TOKEN?: string }
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const id = z.string().regex(/^\d{1,12}$/);
const sourceSchema = z.string().min(1).max(200);

export function createServer(client: ZeppClient) {
  const server = new McpServer({ name: 'zepp-mcp', version: '0.2.3' });
  const safeResult = async (fn: () => Promise<unknown>) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(client.redact(await fn())) }] }; }
    catch (error) {
      const safe = error instanceof ZeppError ? error.toJSON()
        : error instanceof DecodeError ? { stage: 'decode', reason: error.message }
        : { stage: 'internal', reason: 'unexpected_failure' };
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(client.redact({ ...safe, diagnostics: client.diagnostics() })) }] };
    }
  };
  server.registerTool('zepp_authenticate', {
    description: 'Authenticate the configured Zepp account. Returns success and account/routing diagnostics, including user_id and any returned display name for comparison with the Zepp app; never credentials or tokens. No automatic retry.',
    inputSchema: {}, annotations,
  }, () => safeResult(() => client.authenticate()));
  server.registerTool('list_workouts', {
    description: 'Fetch exactly one history page. Pass next_track_id as cursor_track_id only when another page is explicitly needed.',
    inputSchema: { cursor_track_id: id.optional() }, annotations,
  }, args => safeResult(() => client.listWorkouts(args.cursor_track_id)));
  server.registerTool('get_workout', {
    description: 'Fetch one workout using track_id and source from history; decode GPS, HR, altitude, gait and cadence into sparse time series.',
    inputSchema: { track_id: id, source: sourceSchema }, annotations,
  }, args => safeResult(async () => ({ track_id: args.track_id,
    ...decodeWorkout(await client.workoutDetail(args.track_id, args.source), args.track_id) })));
  server.registerTool('run_poc', {
    description: 'Run the minimal proof once: authenticate, fetch ONE history page and ONE workout detail, decode samples including cadence. Stop on first error; never paginate or retry.',
    inputSchema: {}, annotations,
  }, () => safeResult(async () => {
    await client.authenticate();
    const history = await client.listWorkouts();
    if (!history.items.length) return { authenticated: true, history, detail: null, reason: 'no_workouts', diagnostics: client.diagnostics() };
    const selected = history.items[0];
    if (!selected.trackid || typeof selected.source !== 'string') throw new ZeppError('history', 200, 'missing_trackid_or_source');
    const trackid = String(selected.trackid);
    const detail = await client.workoutDetail(trackid, selected.source);
    return { authenticated: true, history, diagnostics: client.diagnostics(), workout: { track_id: trackid, ...decodeWorkout(detail, trackid) } };
  }));
  return server;
}
async function bearerMatches(request: Request, expected: string): Promise<boolean> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([header.slice(7), expected].map(s => crypto.subtle.digest('SHA-256', encode.encode(s))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
// Factory also allows isolated tests. Session cache is memory-only, per isolate.
export function createWorker(fetcher: typeof fetch = fetch) {
  let client: ZeppClient | undefined;
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return Response.json({ ok: true });
      if (path !== '/mcp') return new Response('Not found', { status: 404 });
      // Personal health data must not be publicly callable. Fail closed.
      if (!env.MCP_AUTH_TOKEN || env.MCP_AUTH_TOKEN.length < 32) return new Response('MCP access secret missing or too short', { status: 503 });
      if (!await bearerMatches(request, env.MCP_AUTH_TOKEN)) return new Response('Unauthorized', {
        status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
      if (!client || !client.matches(env)) client = new ZeppClient(env, fetcher);
      const active = client;
      try {
        return await createMcpHandler(() => createServer(active), { corsOptions: false })(request, env, ctx);
      } catch { return new Response('MCP request failed', { status: 500 }); }
    },
  };
}
export default createWorker();
