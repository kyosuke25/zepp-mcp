import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import { ZeppClient, ZeppError, encryptCredentials } from '../src/zepp-client';

const config = { ZEPP_EMAIL: 'fixture@example.invalid', ZEPP_PASSWORD: 'fixture-password-only' };
const json = (body: unknown, status = 200) => Response.json(body, { status });
const mock = (fn: (url: string, init: RequestInit) => Response | Promise<Response>) =>
  ((input: string | URL | Request, init?: RequestInit) => fn(String(input), init!)) as typeof fetch;

test('encrypted credential wire format is interoperable AES-CBC/PKCS7', async () => {
  const form = new URLSearchParams({ password: 'p+a&ss=✓', emailOrPhone: 'fixture@example.invalid' });
  form.append('token', 'access'); form.append('token', 'refresh');
  const bytes = await encryptCredentials(form);
  const decipher = createDecipheriv('aes-128-cbc', Buffer.from('xeNtBVqzDc6tuNTh'), Buffer.from('MAAAYAAAAAAAAABg'));
  const plain = Buffer.concat([decipher.update(Buffer.from(bytes)), decipher.final()]).toString();
  assert.equal(plain, form.toString());
});
test('two auth POSTs + one history GET + one detail GET, cursor/source propagated; no extra login', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = new ZeppClient(config, mock((url, init) => {
    calls.push({ url, init });
    assert.equal(init.redirect, 'manual');
    if (calls.length === 1) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access&refresh=fixture-refresh' } });
    if (calls.length === 2) return json({ token_info: { app_token: 'fixture-app-token', user_id: '42', login_token: 'fixture-login' } });
    assert.equal((init.headers as Record<string, string>).apptoken, 'fixture-app-token');
    assert.equal(new URL(url).searchParams.get('userid'), '42');
    if (calls.length === 3) {
      assert.equal(new URL(url).searchParams.get('trackid'), '1700000001');
      return json({ code: 1, data: { summary: [{ trackid: '1700000000', source: 'watch', app_token: 'must-not-return' }], next: 1699999999 } });
    }
    assert.equal(new URL(url).searchParams.get('source'), 'watch');
    return json({ code: 1, data: { trackid: 1700000000, heart_rate: '0,80' } });
  }));
  const authenticated = await Promise.all([client.authenticate(), client.authenticate()]);
  assert.equal(authenticated[0].diagnostics.user_id, '42');
  assert.equal(authenticated[1].diagnostics.user_id, '42');
  const history = await client.listWorkouts('1700000001');
  await client.workoutDetail(String(history.items[0].trackid), String(history.items[0].source));
  assert.deepEqual(calls.map(c => c.init.method), ['POST', 'POST', 'GET', 'GET']);
  assert.equal(history.pages_requested, 1);
  assert.equal(history.next_track_id, '1699999999');
  assert.equal(history.items[0].app_token, undefined);
  assert.deepEqual(client.redact([config.ZEPP_EMAIL, config.ZEPP_PASSWORD, 'fixture-app-token', 'fixture-access']), Array(4).fill('[REDACTED]'));
});
test('auth HTTP rejection stops once; cooldown retains only numeric code and safe reason', async () => {
  let count = 0;
  const client = new ZeppClient(config, mock(() => { count++; return json({ error_code: '0125', message: config.ZEPP_PASSWORD, access: 'DO-NOT-EMIT' }, 429); }));
  for (let n = 0; n < 2; n++) {
    await assert.rejects(client.authenticate(), error => {
      assert.ok(error instanceof ZeppError);
      assert.deepEqual(error.toJSON(), { stage: 'auth_tokens', http_status: 429, reason: 'upstream_rejected', api_code: '0125' });
      return true;
    });
  }
  assert.equal(count, 1);
});
test('non-JSON/network failures do not leak upstream secrets or retry', async () => {
  for (const response of [() => new Response(config.ZEPP_PASSWORD, { status: 500 }), () => { throw new Error(config.ZEPP_PASSWORD); }]) {
    let count = 0;
    const client = new ZeppClient(config, mock(() => { count++; return response(); }));
    await assert.rejects(client.authenticate(), error => {
      assert.ok(error instanceof ZeppError);
      assert.ok(!JSON.stringify(error).includes(config.ZEPP_PASSWORD));
      return true;
    });
    assert.equal(count, 1);
  }
});
test('missing secrets or invalid region make zero network requests', async () => {
  let count = 0;
  for (const c of [{}, { ...config, ZEPP_REGION: 'https://attacker.invalid' }]) {
    const client = new ZeppClient(c, mock(() => { count++; throw Error(); }));
    await assert.rejects(client.authenticate(), ZeppError);
  }
  assert.equal(count, 0);
});
test('empty history is valid, error code over HTTP 200 is rejected', async () => {
  let n = 0;
  const client = new ZeppClient(config, mock(() => {
    n++;
    if (n === 1) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access' } });
    if (n === 2) return json({ token_info: { app_token: 'fixture-token', user_id: 42 } });
    if (n === 3) return json({ code: 1, data: { summary: [], next: -1 } });
    return json({ code: -1, message: config.ZEPP_PASSWORD });
  }));
  assert.equal((await client.listWorkouts()).count, 0);
  await assert.rejects(client.listWorkouts(), ZeppError);
  assert.equal(n, 4);
});

test('token redirect account region and country override configured global data route', async () => {
  const calls: string[] = [];
  const client = new ZeppClient({ ...config, ZEPP_REGION: 'us2', ZEPP_COUNTRY: 'US', ZEPP_DATA_REGION: 'global' }, mock((url, init) => {
    calls.push(url);
    if (calls.length === 1) return new Response(null, { status: 303, headers: {
      location: 'https://example.invalid/?access=fixture-access&region=eu-central-1&country_code=DE&refresh=fixture-refresh' } });
    if (calls.length === 2) {
      assert.equal(new URL(url).hostname, 'api-mifit-de2.zepp.com');
      const form = init.body as URLSearchParams;
      assert.equal(form.get('country_code'), 'DE');
      assert.equal(form.has('countryState'), false);
      return json({ token_info: { app_token: 'fixture-app', user_id: 42 } });
    }
    assert.equal(new URL(url).hostname, 'api-mifit-de2.zepp.com');
    if (calls.length === 3) {
      assert.deepEqual([...new URL(url).searchParams.keys()], ['userid']); // no initial trackid/type/count/source
      return json({ code: 1, data: { summary: [{ trackid: '1700000000', source: 'watch' }], next: -1 } });
    }
    return json({ data: { trackid: 1700000000 } });
  }));
  const history = await client.listWorkouts();
  await client.workoutDetail('1700000000', 'watch');
  assert.equal(calls.length, 4);
  assert.equal(history.diagnostics.resolved_region, 'de2');
  assert.equal(history.diagnostics.route_source, 'token_redirect.region');
  assert.equal(history.diagnostics.auth_country, 'DE');
  assert.equal(history.diagnostics.upstream_http_status.history, 200);
  assert.equal(client.diagnostics().upstream_http_status.detail, 200);
  const serialized = JSON.stringify(history.diagnostics);
  for (const secret of ['fixture-access', 'fixture-refresh', 'fixture-app', config.ZEPP_EMAIL, config.ZEPP_PASSWORD]) assert.ok(!serialized.includes(secret));
});

test('login routing hints take priority over redirect and configuration for BOTH history and detail', async () => {
  for (const routing of [
    { r: { 'api-mifit.zepp.com': 'api-mifit-de2.zepp.com' } },
    { r: { 'api-mifit.huami.com': 'https://api-mifit-de2.huami.com/' } },
    { region: 'eu-central-1' },
    { regist_info: { region: 'eu-central-1' } },
  ]) {
    let n = 0;
    const client = new ZeppClient({ ...config, ZEPP_DATA_REGION: 'global' }, mock(url => {
      n++;
      if (n === 1) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access&region=us-west-2' } });
      if (n === 2) return json({ ...routing, token_info: { app_token: 'fixture-token', user_id: 42 } });
      assert.ok(new URL(url).hostname.startsWith('api-mifit-de2.'));
      return n === 3 ? json({ data: { summary: [], next: -1 } }) : json({ data: { trackid: 1700000000 } });
    }));
    const history = await client.listWorkouts();
    await client.workoutDetail('1700000000', 'watch');
    assert.equal(n, 4);
    assert.equal(history.diagnostics.resolved_region, 'de2');
    assert.ok(history.diagnostics.route_source.startsWith('login_response.'));
  }
});

test('no routing hints uses explicit fallback, or auth region for auto; never probes shards', async () => {
  for (const fallback of ['auto', 'global', undefined]) {
    let n = 0;
    const client = new ZeppClient({ ...config, ZEPP_DATA_REGION: fallback }, mock(url => {
      n++;
      if (n === 1) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access' } });
      if (n === 2) return json({ token_info: { app_token: 'fixture-token', user_id: 42 } });
      assert.equal(new URL(url).hostname, fallback === 'global' ? 'api-mifit.zepp.com' : 'api-mifit-us2.zepp.com');
      return json({ data: { summary: [], next: -1 } });
    }));
    assert.equal((await client.listWorkouts()).count, 0);
    assert.equal(n, 3);
  }
});

test('reject unknown/unsafe upstream routing without sending a token to it or emitting raw values', async () => {
  for (const malicious of ['https://api-mifit-de2.zepp.com.attacker.invalid', 'https://fixture-token' + '@' + 'api-mifit-de2.zepp.com',
    'https://api-mifit-de2.zepp.com/path?access=fixture-token', 'https://api-mifit-de2.zepp.com:8443', 'api-mifit-constructor.zepp.com', 'api-mifit-__proto__.zepp.com', 'fixture-token']) {
    let n = 0;
    const client = new ZeppClient(config, mock(() => {
      n++;
      if (n === 1) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access' } });
      return json({ r: { 'api-mifit.zepp.com': malicious }, token_info: { app_token: 'fixture-token', user_id: 42 } });
    }));
    await assert.rejects(client.listWorkouts(), error => {
      assert.ok(error instanceof ZeppError);
      assert.equal(error.reason, 'unsupported_account_routing');
      assert.ok(!JSON.stringify({ error, diagnostics: client.diagnostics() }).includes(malicious));
      return true;
    });
    assert.equal(n, 2);
  }
});

test('unknown redirect region stops before token exchange and cursor is validated before any call', async () => {
  let n = 0;
  const client = new ZeppClient(config, mock(() => {
    n++; return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access&region=fixture-secret-region' } });
  }));
  await assert.rejects(client.listWorkouts('not-a-cursor'), ZeppError);
  assert.equal(n, 0);
  await assert.rejects(client.listWorkouts(), error => error instanceof ZeppError && error.reason === 'unsupported_account_region');
  assert.equal(n, 1);
  assert.equal(client.diagnostics().redirect_region_present, true);
  assert.ok(!JSON.stringify(client.diagnostics()).includes('fixture-secret-region'));
});

test('non-numeric account identifiers are rejected without exposing arbitrary upstream text', async () => {
  let n = 0;
  const client = new ZeppClient(config, mock(() => {
    n++;
    if (n === 1) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access' } });
    return json({ token_info: { app_token: 'fixture-token', user_id: 'fixture-upstream-secret' } });
  }));
  await assert.rejects(client.authenticate(), ZeppError);
  assert.equal(client.diagnostics().user_id, null);
  assert.ok(!JSON.stringify(client.diagnostics()).includes('fixture-upstream-secret'));
  assert.equal(n, 2);
});

test('auth display-name hints do not add API calls or disclose response tokens and other profile fields', async () => {
  for (const nickname of ['Fixture Runner', 'fixture-app', 'fixture-access', 'fixture-refresh', 'fixture-login', config.ZEPP_EMAIL, config.ZEPP_PASSWORD]) {
    let n = 0;
    const client = new ZeppClient(config, mock(() => {
      n++;
      if (n === 1) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access&refresh=fixture-refresh' } });
      return json({ token_info: { app_token: 'fixture-app', user_id: 42, login_token: 'fixture-login' },
        user_info: { nickname, email: 'fixture@example.invalid', height: 180, avatar: 'fixture-private-avatar' } });
    }));
    const auth = await client.authenticate();
    assert.equal(n, 2);
    assert.equal(auth.diagnostics.account_profile.display_name, nickname === 'Fixture Runner' ? nickname : null);
    assert.equal(auth.diagnostics.account_profile.authentication_method, 'email_password');
    for (const secret of ['fixture-app', 'fixture-access', 'fixture-refresh', 'fixture-login', config.ZEPP_EMAIL, config.ZEPP_PASSWORD, 'fixture-private-avatar']) {
      assert.ok(!JSON.stringify(auth).includes(secret));
    }
  }
});

test('JP account: unrecognized login metadata cannot veto a validated non-us2 redirect', async () => {
  for (const region of ['JP', { country: 'JP' }, null, 123]) {
    let n = 0;
    const client = new ZeppClient({ ...config, ZEPP_REGION: 'us2', ZEPP_DATA_REGION: 'auto', ZEPP_COUNTRY: 'US' }, mock((url, init) => {
      n++;
      if (n === 1) return new Response(null, { status: 303, headers: {
        location: 'https://example.invalid/?access=fixture-access&region=eu-central-1&country_code=JP' } });
      if (n === 2) {
        assert.equal(new URL(url).hostname, 'api-mifit-de2.zepp.com');
        assert.equal((init.body as URLSearchParams).get('country_code'), 'JP');
        return json({ region, token_info: { app_token: 'fixture-token', user_id: 42 } });
      }
      assert.equal(new URL(url).hostname, 'api-mifit-de2.zepp.com');
      return n === 3 ? json({ data: { summary: [{ trackid: 1700000000, source: 'watch' }], next: -1 } }) : json({ data: { trackid: 1700000000 } });
    }));
    const history = await client.listWorkouts();
    await client.workoutDetail('1700000000', 'watch');
    assert.equal(n, 4);
    assert.equal(history.diagnostics.auth_country, 'JP');
    assert.equal(history.diagnostics.route_source, 'token_redirect.region');
    assert.equal(history.diagnostics.resolved_region, 'de2');
    assert.equal(history.diagnostics.login_host, 'api-mifit-de2.zepp.com');
    assert.equal(history.diagnostics.token_redirect_region, 'de2');
    assert.deepEqual(history.diagnostics.routing_warnings, ['unrecognized_login_region']);
  }
});

test('recognized login route wins even when another region field is unrecognized; host wrappers are validated', async () => {
  for (const routing of [
    { region: 'JP', r: { 'api-mifit.zepp.com': ['api-mifit-us3.zepp.com'] } },
    { region: { region: 'us3' } },
    { region: 'api-mifit-us3.zepp.com' },
    { region: 'JP', regist_info: { region: 'us3' } },
    { region: 'JP', r: { 'api-mifit.zepp.com': { host: 'api-mifit-us3.zepp.com' } } },
  ]) {
    let n = 0;
    const client = new ZeppClient({ ...config, ZEPP_DATA_REGION: 'auto' }, mock(url => {
      n++;
      if (n === 1) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access&region=us-west-2&country_code=JP' } });
      if (n === 2) return json({ ...routing, token_info: { app_token: 'fixture-token', user_id: 42 } });
      assert.equal(new URL(url).hostname, 'api-mifit-us3.zepp.com');
      return json({ data: { summary: [], next: -1 } });
    }));
    const history = await client.listWorkouts();
    assert.equal(history.diagnostics.resolved_region, 'us3');
    assert.ok(history.diagnostics.route_source.startsWith('login_response.'));
    assert.equal(n, 3);
  }
});

test('unknown login region without any usable response route cannot silently choose configured us2', async () => {
  let n = 0;
  const client = new ZeppClient(config, mock(() => {
    n++;
    if (n === 1) return new Response(null, { status: 303, headers: { location: 'https://example.invalid/?access=fixture-access' } });
    return json({ region: { opaque: 'fixture-must-not-emit' }, token_info: { app_token: 'fixture-token', user_id: 42 } });
  }));
  await assert.rejects(client.listWorkouts(), error => error instanceof ZeppError && error.reason === 'unsupported_account_routing');
  assert.equal(n, 2);
  assert.equal(client.diagnostics().login_region_shape, 'object');
  assert.equal(client.diagnostics().resolved_region, null);
  assert.ok(!JSON.stringify(client.diagnostics()).includes('fixture-must-not-emit'));
});
