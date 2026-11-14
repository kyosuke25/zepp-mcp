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
  const server = new McpServer({ name: 'zepp-mcp', version: '0.2.14' });
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
    description: 'Fetch exactly one history page, preserving every upstream summary field except authentication material, including gearId when present (no shoe-name lookup). Pass next_track_id as cursor_track_id only when another page is explicitly needed.',
    inputSchema: { cursor_track_id: id.optional() }, annotations,
  }, args => safeResult(() => client.listWorkouts(args.cursor_track_id)));
  server.registerTool('get_workout', {
    description: 'Fetch one workout using track_id and source from history; decode GPS, HR, altitude, gait, cadence, power and running dynamics into sparse time series, with all remaining detail fields under metadata and a complete field inventory; undecoded strings/arrays retain raw values and record counts.',
    inputSchema: { track_id: id, source: sourceSchema }, annotations,
  }, args => safeResult(async () => {
    const detail = await client.workoutDetail(args.track_id, args.source);
    return { track_id: args.track_id, ...decodeWorkout(detail, args.track_id), diagnostics: client.diagnostics() };
  }));
  server.registerTool('run_poc', {
    description: 'Run the minimal proof once: authenticate, fetch ONE history page and ONE workout detail, decode samples including cadence. Never paginate. History/detail HTTP 401/403 triggers reauthentication and at most one retry per data request.',
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
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const limit = z.number().int().min(1).max(1000).default(200);
  server.registerTool('get_daily_data', {
    description: 'Read up to 31 inclusive dates of daily sleep, HR, steps and activity. Preserve all upstream fields; decode JSON/base64 JSON and minute HR. Binary activity stays raw. Query previous date for sleep crossing midnight; no inferred timezone.',
    inputSchema: { from_date: date, to_date: date, query_type: z.enum(['summary', 'detail']).default('detail') }, annotations,
  }, args => safeResult(() => client.dailyData(args.from_date, args.to_date, args.query_type)));
  server.registerTool('get_health_events', {
    description: 'Read ONE health-event page (up to 31 days, Unix milliseconds). v1 examples: all_day_stress, blood_oxygen, PaiHealthInfo. v2 examples: exertion/algo_result, phn/daily_analysis. Return every non-secret field plus parsed JSON. Availability depends on device/account; empty results are not proof of no measurements. Never probe other endpoints automatically.',
    inputSchema: { event_type: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/), sub_type: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/).optional(),
      from_ms: z.number().int().nonnegative(), to_ms: z.number().int().nonnegative(), version: z.enum(['v1', 'v2']).default('v1'), limit }, annotations,
  }, args => safeResult(() => client.healthEvents(args.event_type, args.from_ms, args.to_ms, args.sub_type, args.version, args.limit)));
  server.registerTool('get_sport_statistics', {
    description: 'Read up to 31 inclusive dates of WatchSportStatistics (documented metrics: SPORT_LOAD, VO2_MAX). Return all upstream fields; other metric names may be rejected by Zepp. One page only.',
    inputSchema: { metric: z.string().regex(/^[A-Z_]{1,64}$/), from_date: date, to_date: date, limit }, annotations,
  }, args => safeResult(() => client.sportStatistics(args.metric, args.from_date, args.to_date, args.limit)));
  server.registerTool('get_profile', {
    description: 'Read the complete Zepp profile or properties, excluding authentication material. May contain personal information. One upstream GET.',
    inputSchema: { section: z.enum(['profile', 'properties']).default('profile') }, annotations,
  }, args => safeResult(() => client.profile(args.section)));
  server.registerTool('get_device_settings', {
    description: 'Read device settings metadata for known deviceSources (obtain source from daily data). This is not a paired-device inventory. One upstream GET; never changes settings.',
    inputSchema: { device_sources: z.string().regex(/^[A-Za-z0-9_,.-]{1,200}$/) }, annotations,
  }, args => safeResult(() => client.deviceSettings(args.device_sources)));
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
      if (path === '/health' && request.method === 'GET') return Response.json({ ok: true, implementation_version: '0.2.14' });
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
