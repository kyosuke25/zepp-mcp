import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gearData } from '../src/gear-data';
import { ZeppClient, ZeppError } from '../src/zepp-client';

// Entirely synthetic records; field names and units are protocol facts, not APK fixtures.
const payload = { code: 1, data: { items: [
  { id: 7, gearId: 'fixture-gear-a', nickname: 'Fixture Swift', brandModel: 'Fixture Model', totalDistanceM: 1234, initialDistanceM: 100, future: { enabled: true, token: 'fixture-private' } },
  { id: 8, gearId: 'fixture-gear-b', nickname: '', brandModel: 'Fixture Model B', totalDistanceM: 0 },
], next: -1 }, future: false };
test('gear preserves complete sanitized fields and maps IDs to names and meter values without summing distances', () => {
  const r = gearData(payload);
  assert.equal(r.gear_by_id['fixture-gear-a'][0].name, 'Fixture Swift');
  assert.equal(r.gear_by_id['fixture-gear-a'][0].name_source, 'nickname');
  assert.equal(r.gear_by_id['fixture-gear-a'][0].total_distance_m, 1234);
  assert.equal(r.gear_by_id['fixture-gear-a'][0].initial_distance_m, 100);
  assert.equal(r.gear_by_id['fixture-gear-b'][0].name, 'Fixture Model B');
  assert.equal(r.gear_by_id['fixture-gear-b'][0].total_distance_m, 0);
  assert.deepEqual((r.items![0] as any).future, { enabled: true });
  assert.equal(r.upstream.future, false);
  assert.equal(JSON.stringify(r).includes('fixture-private'), false);
});
test('gear preserves duplicate ID associations, missing names and unknown response shapes explicitly', () => {
  const r = gearData({ data: { items: [{ gearId: 'fixture-a' }, { gearId: 'fixture-a', nickname: 'Fixture Second' }, { custom: true }] } });
  assert.equal(r.gear_by_id['fixture-a'].length, 2);
  assert.equal(r.gear_by_id['fixture-a'][0].name, null);
  assert.equal(r.gear_by_id['fixture-a'][0].total_distance_m, null);
  assert.equal(r.items!.length, 3);
  assert.deepEqual(gearData({ data: { items: [] } }).gear_by_id, {});
  const unknown = gearData({ data: { future: [1, 2] } });
  assert.equal(unknown.items, null);
  assert.equal(unknown.warnings.length, 1);
  assert.deepEqual(unknown.upstream, { data: { future: [1, 2] } });
});
function setup(reply: (url: URL) => Response) {
  const calls: URL[] = []; let logins = 0;
  const client = new ZeppClient({ ZEPP_EMAIL: 'fixture@example.invalid', ZEPP_PASSWORD: 'fixture-password-only' }, (async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.pathname.endsWith('/tokens')) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access&region=eu-central-1' } });
    if (url.pathname.endsWith('/login')) { logins++; return Response.json({ token_info: { app_token: `fixture-token-${logins}`, user_id: logins === 1 ? 42 : 43 } }); }
    assert.equal(init?.method, 'GET');
    assert.equal(url.hostname, 'api-mifit-de2.zepp.com');
    assert.equal(new Headers(init?.headers).get('appplatform'), 'android_phone');
    assert.equal(new Headers(init?.headers).get('apptoken'), `fixture-token-${logins}`);
    return reply(url);
  }) as typeof fetch);
  return { client, calls, logins: () => logins };
}
test('gear GET exactly matches enabled and per-type app queries on the resolved host', async () => {
  const { client, calls } = setup(() => Response.json(payload));
  const enabled = await client.listGear();
  const shoes = await client.listGear(0);
  assert.equal(calls[2].pathname, '/users/42/gears');
  assert.deepEqual(Object.fromEntries(calls[2].searchParams), { status: '1', limit: '100' });
  assert.deepEqual(Object.fromEntries(calls[3].searchParams), { gearType: '0', limit: '100' });
  assert.equal(enabled.request.scope, 'enabled');
  assert.equal(shoes.request.scope, 'gear_type');
  assert.equal(shoes.pages_requested, 1);
  assert.equal(calls.length, 4);
});
test('gear 401 retries only once and rebuilds the numeric user path after reauthentication', async () => {
  let gets = 0;
  const { client, calls, logins } = setup(url => {
    if (++gets === 1) return Response.json({ code: -1 }, { status: 401 });
    assert.equal(url.pathname, '/users/43/gears');
    assert.equal(url.searchParams.get('gearType'), '0');
    return Response.json(payload);
  });
  const result = await client.listGear(0);
  assert.equal(result.gear_by_id['fixture-gear-a'][0].total_distance_m, 1234);
  assert.deepEqual({ gets, calls: calls.length, logins: logins() }, { gets: 2, calls: 6, logins: 2 });
});
test('invalid gear types fail before login', async () => {
  const { client, calls } = setup(() => { throw Error('Unexpected request'); });
  for (const type of [-1, 0.5, NaN, 2147483648]) await assert.rejects(client.listGear(type), ZeppError);
  assert.equal(calls.length, 0);
});
