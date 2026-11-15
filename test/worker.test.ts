import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { readMcpResponse } from '../scripts/mcp-response.mjs';
import fixture from './fixtures/workout.json';

// Public synthetic credentials only; outboundService intercepts EVERY subrequest.
const bearer = 'fixture-mcp-bearer-000000000000000000';
function runtime(withSecret = true, emptyHistory = false, detail: Record<string, unknown> = fixture) {
  const calls: { path: string; method: string }[] = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/index.js',
    compatibilityDate: '2026-11-14', compatibilityFlags: ['nodejs_compat'],
    bindings: { ZEPP_EMAIL: 'fixture@example.invalid', ZEPP_PASSWORD: 'fixture-password-only',
      ...(withSecret ? { MCP_AUTH_TOKEN: bearer } : {}) },
    outboundService: async request => {
      const url = new URL(request.url);
      calls.push({ path: url.pathname, method: request.method });
      if (url.pathname === '/v2/registrations/tokens') return new MFResponse(null, {
        status: 303, headers: { location: 'https://example.invalid/?access=fixture-access&region=eu-central-1&country_code=JP' } });
      if (url.pathname === '/v2/client/login') return MFResponse.json({ region: 'JP', token_info: { app_token: 'fixture-app-token', user_id: '42' }, thirdparty_info: { nickname: 'Fixture+Runner', third_id: 'fixture-private-provider-id' } });
      if (url.pathname === '/v1/sport/run/history.json') {
        assert.equal(url.hostname, 'api-mifit-de2.zepp.com');
        assert.equal(url.searchParams.has('trackid'), false);
        assert.equal(url.searchParams.has('type'), false);
        return MFResponse.json({ code: 1,
          data: { summary: emptyHistory ? [] : [{ trackid: String(fixture.trackid), source: 'watch', gearId: 'fixture-gear-a' }], next: -1 } });
      }
      if (url.pathname === '/v1/sport/run/detail.json') return MFResponse.json({ code: 1, data: detail });
      if (url.pathname === '/v1/data/band_data.json') return MFResponse.json({ code: 1, data: [{
        summary: Buffer.from(JSON.stringify({ slp: { ss: 80 }, stp: { ttl: 900 }, newScore: 7 })).toString('base64'),
        data_hr: Buffer.from([60, 61, 255]).toString('base64') }] });
      if (url.pathname.endsWith('/events')) return MFResponse.json({ items: [{ data: JSON.stringify({ value: 7, token: 'fixture-private' }) }] });
      if (url.pathname.includes('/WatchSportStatistics/')) return MFResponse.json({ items: [{ future: 9 }] });
      if (url.pathname === '/huami.health.getUserInfo.json') return MFResponse.json({ nickname: 'Fixture Runner', token: 'fixture-private' });
      if (url.pathname === '/users/42/gears') return MFResponse.json({ code: 1, data: {
        items: [{ id: 7, gearId: 'fixture-gear-a', gearType: 0, nickname: 'Fixture Swift', brandModel: 'Fixture Model', totalDistanceM: 1234, initialDistanceM: 100, token: 'fixture-private' }], next: -1 } });
      if (url.pathname === '/users/42/properties') return MFResponse.json({ 'fixture.setting': JSON.stringify({ enabled: true, token: 'fixture-private' }) });
      if (url.pathname === '/device/settings/meta') return MFResponse.json({ future: true });
      throw Error('Unexpected outbound request');
    },
  }));
  return { mf, calls };
}
async function rpc(mf: Miniflare, method: string, params: Record<string, unknown> = {}) {
  return mf.dispatchFetch('http://localhost/mcp', { method: 'POST', headers: {
    authorization: `Bearer ${bearer}`, 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
}
test('workerd serves MCP initialization, tools and complete PoC with four mocked upstream requests', async () => {
  const { mf, calls } = runtime();
  try {
    const init = await rpc(mf, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture-test', version: '1' } });
    assert.equal(init.status, 200);
    const initialized = await readMcpResponse(init) as any;
    assert.equal(initialized.result.serverInfo.name, 'zepp-mcp');
    const list = await rpc(mf, 'tools/list');
    const listed = await readMcpResponse(list) as any;
    assert.equal(listed.result.tools.length, 10);
    assert.equal(calls.length, 0); // Discovery never contacts Zepp.
    const response = await rpc(mf, 'tools/call', { name: 'run_poc', arguments: {} });
    assert.equal(response.status, 200);
    const envelope = await readMcpResponse(response);
    const body = JSON.stringify(envelope);
    for (const secret of [bearer, 'fixture-password-only', 'fixture-app-token', 'fixture-access', 'fixture-private-provider-id']) assert.ok(!body.includes(secret));
    const result = JSON.parse(envelope.result.content[0].text);
    assert.equal(result.authenticated, true, JSON.stringify({ result, calls }));
    assert.equal(result.workout.timeline.length, 5);
    assert.equal(result.history.items[0].gearId, 'fixture-gear-a');
    assert.equal(result.diagnostics.resolved_region, 'de2');
    assert.equal(result.diagnostics.user_id, '42');
    assert.equal(result.diagnostics.account_profile.display_name, 'Fixture Runner');
    assert.equal(result.diagnostics.implementation_version, '0.2.16');
    assert.equal(result.diagnostics.retry_count, 0);
    assert.equal(result.diagnostics.last_retry, null);
    assert.equal(result.diagnostics.auth_country, 'JP');
    assert.deepEqual(result.diagnostics.routing_warnings, ['unrecognized_login_region']);
    assert.equal(result.diagnostics.upstream_http_status.history, 200);
    assert.equal(result.diagnostics.upstream_http_status.detail, 200);
    assert.equal(result.workout.streams.gait[1].cadence_spm, 180);
    assert.deepEqual(calls.map(c => c.method), ['POST', 'POST', 'GET', 'GET']);
    const auth = await rpc(mf, 'tools/call', { name: 'zepp_authenticate', arguments: {} });
    assert.equal(auth.status, 200);
    const authEnvelope = await readMcpResponse(auth);
    assert.equal(JSON.parse(authEnvelope.result.content[0].text).diagnostics.user_id, '42');
    assert.equal(JSON.parse(authEnvelope.result.content[0].text).diagnostics.account_profile.display_name, 'Fixture Runner');
    assert.equal(calls.length, 4); // Cached, no additional Zepp requests.
  } finally { await mf.dispose(); }
});
test('MCP missing/wrong bearer fails closed and health never calls upstream', async () => {
  for (const withSecret of [false, true]) {
    const { mf, calls } = runtime(withSecret);
    try {
      const health = await mf.dispatchFetch('http://localhost/health');
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true, implementation_version: '0.2.16' });
      const response = await mf.dispatchFetch('http://localhost/mcp', { method: 'POST' });
      assert.equal(response.status, withSecret ? 401 : 503);
      assert.equal(calls.length, 0);
    } finally { await mf.dispose(); }
  }
});

test('empty-history run_poc still includes routing diagnostics and stops before detail', async () => {
  const { mf, calls } = runtime(true, true);
  try {
    const response = await rpc(mf, 'tools/call', { name: 'run_poc', arguments: {} });
    const envelope = await readMcpResponse(response);
    const result = JSON.parse(envelope.result.content[0].text);
    assert.equal(result.reason, 'no_workouts');
    assert.equal(result.diagnostics.user_id, '42');
    assert.equal(result.diagnostics.account_profile.display_name, 'Fixture Runner');
    assert.equal(result.diagnostics.history_host, 'api-mifit-de2.zepp.com');
    assert.equal(result.diagnostics.route_source, 'token_redirect.region');
    assert.equal(result.diagnostics.upstream_http_status.history, 200);
    assert.equal(result.diagnostics.upstream_http_status.detail, null);
    assert.equal(calls.length, 3);
  } finally { await mf.dispose(); }
});

test('get_workout returns power and posture in both streams and timeline, with the temporary debug tool removed', async () => {
  const { mf } = runtime(true, false, { ...fixture,
    gearId: 'fixture-gear-a', shoe: { id: 7, name: 'Fixture shoe' }, gearToken: 'fixture-private',
    power_meter: '1,210;1,220;1,230;',
    runPosture: '0,240,70,65;1,250,75,70;1,65535,65535,255;1,260,80,75;' });
  try {
    const listed = await readMcpResponse(await rpc(mf, 'tools/list'));
    assert.ok(!listed.result.tools.some((t: { name: string }) => t.name === 'debug_raw_streams'));
    const envelope = await readMcpResponse(await rpc(mf, 'tools/call', {
      name: 'get_workout', arguments: { track_id: String(fixture.trackid), source: 'watch' } }));
    assert.equal(envelope.result.isError, undefined);
    assert.equal(JSON.parse(envelope.result.content[0].text).metadata.gearId, 'fixture-gear-a');
    assert.deepEqual(JSON.parse(envelope.result.content[0].text).metadata.shoe, { id: 7, name: 'Fixture shoe' });
    assert.equal(JSON.parse(envelope.result.content[0].text).metadata.gearToken, undefined);
    assert.equal(JSON.parse(envelope.result.content[0].text).diagnostics.implementation_version, '0.2.16');
    const result = JSON.parse(envelope.result.content[0].text);
    assert.equal(result.streams.power_meter[1].power_w, 220);
    assert.equal(result.streams.runPosture[1].stance_time_ms, 250);
    const at2 = result.timeline.find((v: { offset_s: number }) => v.offset_s === 1);
    assert.equal(at2.power_w, 210);
    assert.equal(result.sample_alignment.power_meter.mode, 'delta_seconds');
    assert.equal(result.sample_alignment.power_meter.time_offset_s, 0);
    assert.equal(result.sample_alignment.runPosture.time_offset_s, 0);
    assert.equal(result.sample_alignment.power_meter.input_samples, 3);
    assert.equal(result.sample_alignment.runPosture.input_samples, 4);
    assert.equal(at2.stance_time_ms, 250);
    assert.equal(at2.vertical_oscillation_mm, 75);
    assert.equal(at2.vertical_ratio_pct, 7);
    const at5 = result.timeline.find((v: { offset_s: number }) => v.offset_s === 2);
    assert.equal(at5.stance_time_ms, null);
    assert.ok(!result.warnings.some((w: string) => w.includes('Unsupported streams')));
  } finally { await mf.dispose(); }
});

test('removed debug_raw_streams cannot be called and makes no Zepp requests', async () => {
  const { mf, calls } = runtime();
  try {
    const envelope = await readMcpResponse(await rpc(mf, 'tools/call', {
      name: 'debug_raw_streams', arguments: { track_id: String(fixture.trackid), source: 'watch' } }));
    assert.ok(envelope.error || envelope.result?.isError);
    assert.equal(calls.length, 0);
  } finally { await mf.dispose(); }
});

test('new health tools execute through authenticated MCP and preserve complete sanitized data', async () => {
  const { mf, calls } = runtime();
  try {
    const requests = [
      { name: 'get_daily_data', arguments: { from_date: '2026-01-01', to_date: '2026-01-01' } },
      { name: 'get_health_events', arguments: { event_type: 'PaiHealthInfo', from_ms: 0, to_ms: 1000 } },
      { name: 'get_sport_statistics', arguments: { metric: 'SPORT_LOAD', from_date: '2026-01-01', to_date: '2026-01-01' } },
      { name: 'get_profile', arguments: {} },
      { name: 'get_device_settings', arguments: { device_sources: '7' } },
    ];
    for (const request of requests) {
      const response = await readMcpResponse(await rpc(mf, 'tools/call', request));
      assert.equal(response.result.isError, undefined);
      const text = response.result.content[0].text;
      assert.equal(text.includes('fixture-private'), false);
      const result = JSON.parse(text);
      assert.equal(result.diagnostics.implementation_version, '0.2.16');
      assert.ok(result.upstream);
      if (request.name === 'get_daily_data') {
        assert.equal(result.days[0].decoded.summary.newScore, 7);
        assert.equal(result.days[0].summary.newScore, 7);
        assert.equal(result.upstream.data[0].summary.newScore, 7);
        assert.equal(typeof result.encoded_upstream.data[0].summary, 'string');
        assert.equal(result.days[0].heart_rate_minutes[2].heart_rate_bpm, null);
      }
    }
    assert.deepEqual(calls.map(c => c.method), ['POST', 'POST', 'GET', 'GET', 'GET', 'GET', 'GET']);
  } finally { await mf.dispose(); }
});

test('properties and gear tools execute through authenticated MCP with complete sanitized data', async () => {
  const { mf, calls } = runtime();
  try {
    const result = await readMcpResponse(await rpc(mf, 'tools/call', { name: 'get_profile', arguments: {
      section: 'properties', property_names: ['fixture.setting'] } }));
    assert.equal(result.result.isError, undefined);
    const properties = JSON.parse(result.result.content[0].text);
    assert.deepEqual(properties.decoded, { 'fixture.setting': { enabled: true } });
    assert.equal(properties.property_mode, 'BATCH');
    const envelope = await readMcpResponse(await rpc(mf, 'tools/call', { name: 'list_gear', arguments: { gear_type: 0 } }));
    assert.equal(envelope.result.isError, undefined);
    const gear = JSON.parse(envelope.result.content[0].text);
    assert.equal(gear.gear_by_id['fixture-gear-a'][0].name, 'Fixture Swift');
    assert.equal(gear.gear_by_id['fixture-gear-a'][0].total_distance_m, 1234);
    assert.equal(gear.items[0].initialDistanceM, 100);
    assert.equal(JSON.stringify({ properties, gear }).includes('fixture-private'), false);
    assert.equal(gear.diagnostics.implementation_version, '0.2.16');
    assert.deepEqual(calls.map(c => c.method), ['POST', 'POST', 'GET', 'GET']);
  } finally { await mf.dispose(); }
});
