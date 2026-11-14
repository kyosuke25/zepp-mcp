import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { readMcpResponse } from '../scripts/mcp-response.mjs';
import fixture from './fixtures/workout.json';

// Public synthetic credentials only; outboundService intercepts EVERY subrequest.
const bearer = 'fixture-mcp-bearer-000000000000000000';
function runtime(withSecret = true, emptyHistory = false) {
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
          data: { summary: emptyHistory ? [] : [{ trackid: String(fixture.trackid), source: 'watch' }], next: -1 } });
      }
      if (url.pathname === '/v1/sport/run/detail.json') return MFResponse.json({ code: 1, data: fixture });
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
    assert.equal(listed.result.tools.length, 4);
    assert.equal(calls.length, 0); // Discovery never contacts Zepp.
    const response = await rpc(mf, 'tools/call', { name: 'run_poc', arguments: {} });
    assert.equal(response.status, 200);
    const envelope = await readMcpResponse(response);
    const body = JSON.stringify(envelope);
    for (const secret of [bearer, 'fixture-password-only', 'fixture-app-token', 'fixture-access', 'fixture-private-provider-id']) assert.ok(!body.includes(secret));
    const result = JSON.parse(envelope.result.content[0].text);
    assert.equal(result.authenticated, true, JSON.stringify({ result, calls }));
    assert.equal(result.workout.timeline.length, 5);
    assert.equal(result.diagnostics.resolved_region, 'de2');
    assert.equal(result.diagnostics.user_id, '42');
    assert.equal(result.diagnostics.account_profile.display_name, 'Fixture Runner');
    assert.equal(result.diagnostics.implementation_version, '0.2.3');
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
      assert.equal((await mf.dispatchFetch('http://localhost/health')).status, 200);
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
