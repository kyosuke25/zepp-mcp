import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZeppClient, ZeppError } from '../src/zepp-client';
const config = { ZEPP_EMAIL: 'fixture@example.invalid', ZEPP_PASSWORD: 'fixture-password-only' };
function setup(reply: (url: URL, headers: Headers) => Response) {
  const calls: URL[] = []; let logins = 0;
  const client = new ZeppClient(config, (async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.pathname.endsWith('/tokens')) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access&region=eu-central-1' } });
    if (url.pathname.endsWith('/login')) { logins++; return Response.json({ token_info: { app_token: `fixture-token-${logins}`, user_id: logins === 1 ? 42 : 43 } }); }
    const headers = new Headers(init?.headers);
    assert.equal(url.hostname, 'api-mifit-de2.zepp.com');
    assert.equal(headers.get('appplatform'), (/\/(?:properties|gears)$/.test(url.pathname) || url.pathname === '/huami.health.getUserInfo.json') ? 'android_phone' : 'web');
    assert.equal(headers.get('appname'), (/\/(?:properties|gears)$/.test(url.pathname) || url.pathname === '/huami.health.getUserInfo.json') ? 'com.huami.midong' : 'com.xiaomi.hm.health');
    assert.equal(headers.has('x-hm-ekv'), false);
    assert.equal(init?.method, 'GET');
    return reply(url, headers);
  }) as typeof fetch);
  return { client, calls, logins: () => logins };
}
test('health tools use regional read-only endpoints and preserve every non-secret response field', async () => {
  const { client, calls } = setup(() => Response.json({ code: 1, data: [], items: [{ score: 7, token: 'fixture-private' }], future: false }));
  const daily = await client.dailyData('2026-01-01', '2026-01-02');
  await client.healthEvents('blood_oxygen', 0, 86400000);
  await client.healthEvents('PaiHealthInfo', 0, 86400000);
  await client.healthEvents('all_day_stress', 0, 86400000);
  await client.healthEvents('exertion', 0, 86400000, 'algo_result', 'v2', 10);
  await client.sportStatistics('SPORT_LOAD', '2026-01-01', '2026-01-02');
  await client.profile('profile');
  const device = await client.deviceSettings('7,8');
  assert.equal(calls.length, 10); // One login pair, eight single-page GETs.
  assert.equal(calls[2].pathname, '/v1/data/band_data.json');
  assert.equal(calls[2].searchParams.get('query_type'), 'detail');
  assert.equal(calls[2].searchParams.get('userid'), '42');
  assert.equal(calls[3].pathname, '/users/42/events');
  assert.equal(calls[3].searchParams.has('userid'), false);
  assert.equal(calls[6].pathname, '/v2/users/me/events');
  assert.equal(calls[6].searchParams.get('subType'), 'algo_result');
  assert.equal(calls[6].searchParams.get('limit'), '10');
  assert.equal(calls[7].pathname, '/v2/watch/users/42/WatchSportStatistics/SPORT_LOAD');
  assert.equal(calls[8].pathname, '/huami.health.getUserInfo.json');
  assert.equal(calls[9].searchParams.get('deviceSources'), '7,8');
  assert.equal((daily.upstream as any).future, false);
  assert.equal(JSON.stringify(device).includes('fixture-private'), false);
  assert.equal(device.diagnostics.upstream_http_status.device_settings, 200);
});
test('health query validation rejects unsafe paths and oversized ranges before logging in', async () => {
  const { client, calls } = setup(() => { throw Error('Unexpected request'); });
  for (const fn of [() => client.dailyData('2026-02-30', '2026-03-01'),
    () => client.dailyData('2026-01-01', '2026-02-01'), () => client.dailyData('2026-01-02', '2026-01-01'),
    () => client.healthEvents('../private', 0, 1000), () => client.healthEvents('stress', 0, 32 * 86400000),
    () => client.healthEvents('stress', 0, 1000, undefined, 'v1', 1001),
    () => client.sportStatistics('../private', '2026-01-01', '2026-01-01'),
    () => client.deviceSettings('https://example.invalid')]) await assert.rejects(fn(), ZeppError);
  assert.equal(calls.length, 0);
});
test('health 401 retries once, rebuilding a user-ID path after the new login', async () => {
  let gets = 0;
  const { client, calls, logins } = setup((url, headers) => {
    gets++;
    if (gets === 1) return Response.json({ code: -1 }, { status: 401 });
    assert.equal(url.pathname, '/users/43/events');
    assert.equal(headers.get('apptoken'), 'fixture-token-2');
    return Response.json({ items: [] });
  });
  const result = await client.healthEvents('PaiHealthInfo', 0, 1000);
  assert.deepEqual({ gets, logins: logins(), calls: calls.length }, { gets: 2, logins: 2, calls: 6 });
  assert.equal(result.diagnostics.retry_count, 1);
});

test('known secrets are redacted inside base64 JSON values without leaking the original encoding', async () => {
  const summary = Buffer.from(JSON.stringify({ note: 'fixture-token-1', future: 7 })).toString('base64');
  const { client } = setup(() => Response.json({ data: [{ summary }] }));
  const result = client.redact(await client.dailyData('2026-01-01', '2026-01-01')) as any;
  assert.deepEqual(JSON.parse(Buffer.from(result.encoded_upstream.data[0].summary, 'base64').toString()), { note: '[REDACTED]', future: 7 });
  assert.deepEqual(result.upstream.data[0].summary, { note: '[REDACTED]', future: 7 });
  assert.equal(JSON.stringify(result).includes(summary), false);
});

test('profile uses documented mobile getUserInfo path with userid and no OAuth-host guessing', async () => {
  const { client, calls } = setup((url, headers) => {
    assert.equal(url.pathname, '/huami.health.getUserInfo.json');
    assert.equal(url.searchParams.get('userid'), '42');
    assert.equal(headers.get('apptoken'), 'fixture-token-1');
    return Response.json({ code: 1, data: { nickname: 'Fixture Runner', height: 170, future: false, app_token: 'fixture-private' } });
  });
  const result = await client.profile();
  assert.deepEqual(result.upstream, { code: 1, data: { nickname: 'Fixture Runner', height: 170, future: false } });
  assert.equal(calls.length, 3);
});
test('properties uses numeric account path and BATCH propertyName without extra userid query', async () => {
  const { client, calls } = setup(url => {
    assert.equal(url.pathname, '/users/42/properties');
    assert.deepEqual(Object.fromEntries(url.searchParams), { propertyName: 'fixture.setting,fixture.goal', mode: 'BATCH' });
    return Response.json({ 'fixture.setting': JSON.stringify({ enabled: true, app_token: 'fixture-private' }), 'fixture.goal': '7' });
  });
  const result = await client.profile('properties', ['fixture.setting', 'fixture.goal']);
  assert.deepEqual(result.decoded, { 'fixture.setting': { enabled: true }, 'fixture.goal': '7' });
  assert.equal(calls.length, 3);
});

test('profile replacement reports upstream rejection without probing alternate endpoints', async () => {
  const { client, calls } = setup(() => Response.json({ code: -1, message: 'fixture-private' }, { status: 404 }));
  await assert.rejects(client.profile(), e => e instanceof ZeppError && e.stage === 'profile' && e.http_status === 404 && e.reason === 'upstream_rejected');
  assert.equal(calls.length, 3);
  assert.equal(client.diagnostics().upstream_http_status.profile, 404);
});

test('default properties mirrors the observed app RANGE scope and accepts an empty property object', async () => {
  const { client, calls } = setup(url => {
    assert.equal(url.pathname, '/users/42/properties');
    assert.equal(url.searchParams.get('propertyName'), 'huami.watch');
    assert.equal(url.searchParams.get('mode'), 'RANGE');
    return Response.json({});
  });
  const result = await client.profile('properties');
  assert.deepEqual(result.upstream, {});
  assert.deepEqual(result.decoded, {});
  assert.equal(result.property_mode, 'RANGE');
  assert.equal(calls.length, 3);
});
test('properties RANGE selectors and invalid queries are checked before authentication', async () => {
  const { client, calls } = setup(() => { throw Error('Unexpected request'); });
  for (const fn of [() => client.profile('properties', []),
    () => client.profile('properties', ['fixture.a', 'fixture.b'], 'RANGE'),
    () => client.profile('properties', ['fixture&mode=other']),
    () => client.profile('profile', ['fixture.a'])]) await assert.rejects(fn(), ZeppError);
  assert.equal(calls.length, 0);
});
test('properties rejects non-object responses and preserves retry behavior with the new account path', async () => {
  let gets = 0;
  const { client, calls, logins } = setup(url => {
    if (++gets === 1) return Response.json({ code: -1 }, { status: 401 });
    assert.equal(url.pathname, '/users/43/properties');
    assert.equal(url.searchParams.get('mode'), 'RANGE');
    assert.equal(url.searchParams.get('propertyName'), 'fixture.watch');
    return Response.json({ 'fixture.watch.setting': 7 });
  });
  const result = await client.profile('properties', ['fixture.watch'], 'RANGE');
  assert.deepEqual(result.upstream, { 'fixture.watch.setting': 7 });
  assert.deepEqual({ gets, logins: logins(), calls: calls.length }, { gets: 2, logins: 2, calls: 6 });
  const invalid = setup(() => Response.json([]));
  await assert.rejects(invalid.client.profile('properties'), e => e instanceof ZeppError && e.reason === 'invalid_json_shape');
});
