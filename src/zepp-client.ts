import { accountProfile, emptyAccountProfile } from './account-profile';
import { apiOrigin, countryCode, dataRoute, loginRouting, normalizeRegion } from './routing';
/** Independent Workers-compatible client; no MCP imports.
 * Encrypted auth protocol reference: argrento/huami-token, huami_token/{zepp,constants,helpers}.py
 * History/detail protocol reference: frankherchet/zepp-mcp, src/zepp_mcp/client.py.
 * Independently implemented with Web Crypto and fetch; no third-party login logger.
 */
export interface ZeppConfig {
  ZEPP_EMAIL?: string; ZEPP_PASSWORD?: string;
  ZEPP_REGION?: string; ZEPP_COUNTRY?: string; ZEPP_DATA_REGION?: string;
}
export type Fetcher = typeof fetch;
export type JsonObject = Record<string, unknown>;
export class ZeppError extends Error {
  constructor(public readonly stage: string, public readonly http_status: number | null,
    public readonly reason: string, public readonly api_code?: string) {
    super(`${stage}: ${reason}`);
  }
  toJSON() { return { stage: this.stage, http_status: this.http_status, reason: this.reason,
    ...(this.api_code ? { api_code: this.api_code } : {}) }; }
}
function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
const userAgent = 'Zepp/9.12.5 (Pixel 4; Android 12; Density/2.75)';
// Public protocol constants from huami-token, NOT user secrets or encryption at rest.
const protocolKey = 'xeNtBVqzDc6tuNTh';
const protocolIV = 'MAAAYAAAAAAAAABg';
export async function encryptCredentials(form: URLSearchParams): Promise<ArrayBuffer> {
  const encode = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encode.encode(protocolKey), 'AES-CBC', false, ['encrypt']);
  // Web Crypto AES-CBC applies PKCS#7 padding itself.
  return crypto.subtle.encrypt({ name: 'AES-CBC', iv: encode.encode(protocolIV) }, key, encode.encode(form.toString()));
}

export class ZeppClient {
  #config: ZeppConfig;
  #fetch: Fetcher;
  #token?: string;
  #userId?: string;
  #access?: string;
  #expires = 0;
  #profile = emptyAccountProfile();
  #redactionSecrets: string[] = [];
  #dataOrigin?: string;
  #resolvedRegion?: string;
  #routeSource = 'not_authenticated';
  #authRegion?: string;
  #authCountry?: string;
  #redirectRegionPresent = false;
  #loginRegionPresent = false;
  #loginMapPresent = false;
  #statuses: Record<string, number | null> = {};
  #historyCursor: string | null = null;
  #loginHost?: string;
  #redirectRegion?: string;
  #loginHintRegion?: string;
  #loginRegionShape = 'missing';
  #routingWarnings: string[] = [];
  #pending?: Promise<void>;
  #failure?: { until: number; error: ZeppError };
  constructor(config: ZeppConfig, fetcher: Fetcher = fetch) {
    this.#config = { ...config };
    // A native Workers fetch must not be called with this client as its receiver.
    this.#fetch = (input, init) => fetcher(input, init);
  }
  matches(c: ZeppConfig): boolean {
    return (['ZEPP_EMAIL', 'ZEPP_PASSWORD', 'ZEPP_REGION', 'ZEPP_COUNTRY', 'ZEPP_DATA_REGION'] as const)
      .every(k => c[k] === this.#config[k]);
  }
  diagnostics() {
    return { implementation_version: '0.2.4', user_id: this.#userId ?? null,
      account_profile: { ...this.#profile },
      configured: { auth_region: normalizeRegion(this.#config.ZEPP_REGION ?? 'us2') ?? 'invalid',
        data_region: this.#config.ZEPP_DATA_REGION === 'auto' || !this.#config.ZEPP_DATA_REGION ? 'auto' : normalizeRegion(this.#config.ZEPP_DATA_REGION) ?? 'invalid',
        country: countryCode(this.#config.ZEPP_COUNTRY ?? 'US') ?? 'invalid' },
      resolved_region: this.#resolvedRegion ?? null,
      history_host: this.#dataOrigin ? new URL(this.#dataOrigin).hostname : null,
      route_source: this.#routeSource, auth_region: this.#authRegion ?? null,
      auth_country: this.#authCountry ?? null,
      login_host: this.#loginHost ?? null,
      token_redirect_region: this.#redirectRegion ?? null,
      login_hint_region: this.#loginHintRegion ?? null,
      login_region_shape: this.#loginRegionShape,
      routing_warnings: [...this.#routingWarnings],
      redirect_region_present: this.#redirectRegionPresent,
      login_region_present: this.#loginRegionPresent, login_route_map_present: this.#loginMapPresent,
      upstream_http_status: { auth_tokens: this.#statuses.auth_tokens ?? null, auth_login: this.#statuses.auth_login ?? null,
        history: this.#statuses.history ?? null, detail: this.#statuses.detail ?? null },
      history_request: { cursor_track_id: this.#historyCursor, cursor_mode: this.#historyCursor === null ? 'omitted_first_page' : 'explicit',
        source_filter: null, type_filter: null, count_filter: null } };
  }
  /** All strings from upstream or tools pass this filter before MCP output. */
  redact(value: unknown): unknown {
    if (typeof value === 'string') {
      for (const secret of [this.#config.ZEPP_EMAIL, this.#config.ZEPP_PASSWORD, this.#token, this.#access, ...this.#redactionSecrets]) {
        if (secret) value = (value as string).split(secret).join('[REDACTED]');
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(v => this.redact(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.redact(v)]));
    return value;
  }
  async #request(stage: string, url: string, init: RequestInit): Promise<Response> {
    try {
      // No redirects (including auth redirects), no retry, hard deadline.
      this.#statuses[stage] = null;
      const response = await this.#fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20000) });
      this.#statuses[stage] = response.status;
      return response;
    } catch { throw new ZeppError(stage, null, 'network_or_timeout'); }
  }
  async #json(stage: string, response: Response): Promise<JsonObject> {
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new ZeppError(stage, response.status, 'non_json_response'); }
    const data = object(raw);
    const code = data.error_code ?? data.code;
    // Never emit upstream free-text messages, URLs, headers or bodies.
    const safeCode = typeof code === 'number' || typeof code === 'string' ? String(code) : '';
    const apiCode = /^\d{1,8}$/.test(safeCode) ? safeCode : undefined;
    if (!response.ok || data.error_code !== undefined || (data.code !== undefined && ![0, 1, 200, '0', '1', '200'].includes(data.code as number))) {
      throw new ZeppError(stage, response.status, 'upstream_rejected', apiCode);
    }
    if (Object.keys(data).length === 0) throw new ZeppError(stage, response.status, 'invalid_json_shape');
    return data;
  }
  async authenticate() {
    if (this.#token && Date.now() < this.#expires) return { authenticated: true as const, diagnostics: this.diagnostics() };
    if (this.#failure && Date.now() < this.#failure.until) throw this.#failure.error;
    this.#pending ??= this.#login().catch(error => {
      const safe = error instanceof ZeppError ? error : new ZeppError('auth', null, 'unexpected_failure');
      this.#failure = { until: Date.now() + 300000, error: safe };
      throw safe;
    }).finally(() => { this.#pending = undefined; });
    await this.#pending;
    return { authenticated: true as const, diagnostics: this.diagnostics() };
  }
  async #login(): Promise<void> {
    this.#token = this.#userId = this.#access = undefined;
    this.#profile = emptyAccountProfile();
    this.#redactionSecrets = [];
    this.#loginHost = this.#redirectRegion = this.#loginHintRegion = undefined;
    this.#loginRegionShape = 'missing';
    this.#routingWarnings = [];
    const c = this.#config;
    if (!c.ZEPP_EMAIL || !c.ZEPP_PASSWORD) throw new ZeppError('config', null, 'missing_zepp_secrets');
    this.#dataOrigin = this.#resolvedRegion = this.#authRegion = this.#authCountry = undefined;
    this.#routeSource = 'not_authenticated';
    this.#statuses = {};
    this.#redirectRegionPresent = this.#loginRegionPresent = this.#loginMapPresent = false;
    let country = c.ZEPP_COUNTRY ?? 'US';
    if (!/^[A-Z]{2}$/.test(country)) throw new ZeppError('config', null, 'invalid_country');
    const configuredRegion = normalizeRegion(c.ZEPP_REGION ?? 'us2');
    const fallbackRegion = c.ZEPP_DATA_REGION && c.ZEPP_DATA_REGION !== 'auto' ? normalizeRegion(c.ZEPP_DATA_REGION) : undefined;
    if (!configuredRegion || (c.ZEPP_DATA_REGION && c.ZEPP_DATA_REGION !== 'auto' && !fallbackRegion)) throw new ZeppError('config', null, 'invalid_region');
    const authHost = apiOrigin('api-user', configuredRegion);
    const form = new URLSearchParams({ emailOrPhone: c.ZEPP_EMAIL, state: 'REDIRECTION', client_id: 'HuaMi',
      password: c.ZEPP_PASSWORD, redirect_uri: 'https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html',
      region: c.ZEPP_REGION === 'de2' ? 'eu-central-1' : c.ZEPP_REGION === 'cn' ? 'cn-north-1' : 'us-west-2',
      country_code: country });
    form.append('token', 'access'); form.append('token', 'refresh');
    const response = await this.#request('auth_tokens', `${authHost}/v2/registrations/tokens`, {
      method: 'POST', body: await encryptCredentials(form), headers: {
        app_name: 'com.huami.midong', appname: 'com.huami.midong', cv: '151689_9.12.5', v: '2.0',
        appplatform: 'android_phone', vb: '202509151347', vn: '9.12.5', 'user-agent': userAgent,
        'x-hm-ekv': '1', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
    if (response.status !== 303) {
      if (!response.ok) await this.#json('auth_tokens', response);
      throw new ZeppError('auth_tokens', response.status, 'expected_303_redirect');
    }
    let access: string | null;
    let redirectParams: URLSearchParams;
    try { redirectParams = new URL(response.headers.get('location') ?? '').searchParams; access = redirectParams.get('access'); }
    catch { throw new ZeppError('auth_tokens', response.status, 'invalid_redirect'); }
    if (!access) throw new ZeppError('auth_tokens', response.status, 'missing_access_token');
    this.#access = access;
    const refresh = redirectParams.get('refresh');
    if (refresh) this.#redactionSecrets.push(refresh);
    this.#redirectRegionPresent = redirectParams.has('region');
    const redirectRegion = normalizeRegion(redirectParams.get('region')) ?? dataRoute(redirectParams.get('region'))?.region;
    this.#redirectRegion = redirectRegion;
    if (this.#redirectRegionPresent && !redirectRegion) throw new ZeppError('auth_tokens', response.status, 'unsupported_account_region');
    country = countryCode(redirectParams.get('country_code')) ?? country;
    this.#authCountry = country;
    this.#authRegion = redirectRegion ?? configuredRegion;
    const loginHost = apiOrigin('api-mifit', this.#authRegion);
    this.#loginHost = new URL(loginHost).hostname;
    const login = new URLSearchParams({ code: access, device_id: crypto.randomUUID(), device_model: 'android_phone',
      app_version: '9.12.5', dn: 'api-mifit.zepp.com,api-user.zepp.com,api-watch.zepp.com,app-analytics.zepp.com,auth.zepp.com,api-analytics.zepp.com',
      third_name: 'huami', source: 'com.huami.watch.hmwatchmanager:9.12.5:151689', app_name: 'com.huami.midong',
      country_code: country, grant_type: 'access_token', allow_registration: 'false', lang: 'en' });
    if (country === 'US') login.set('countryState', 'US-NY');
    const loginResponse = await this.#request('auth_login', `${loginHost}/v2/client/login`, {
      method: 'POST', body: login, headers: { app_name: 'com.huami.webapp', appname: 'com.huami.webapp',
        origin: 'https://user.zepp.com', referer: 'https://user.zepp.com/', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
    const result = await this.#json('auth_login', loginResponse);
    const info = object(result.token_info);
    if (typeof info.app_token !== 'string' || !info.app_token || !['string', 'number'].includes(typeof info.user_id) || !/^\d{1,30}$/.test(String(info.user_id))) {
      throw new ZeppError('auth_login', loginResponse.status, 'missing_session_fields');
    }
    const routing = loginRouting(result);
    this.#loginRegionPresent = routing.regionPresent;
    this.#loginMapPresent = routing.mapPresent;
    this.#loginHintRegion = routing.route?.region ?? routing.region;
    this.#loginRegionShape = routing.regionShape;
    // Unknown metadata must not veto a validated response route. Never guess a
    // host from a country (JP != an API shard), nor fall back to config in this case.
    if (routing.regionPresent && !routing.regionRecognized) this.#routingWarnings.push('unrecognized_login_region');
    if (routing.mapPresent && !routing.mapRecognized) this.#routingWarnings.push('unrecognized_login_route_map');
    if (this.#routingWarnings.length && !routing.route && !routing.region && !redirectRegion) {
      throw new ZeppError('auth_login', loginResponse.status, 'unsupported_account_routing');
    }
    this.#authCountry = routing.country ?? country;
    this.#resolvedRegion = routing.route?.region ?? routing.region ?? redirectRegion ?? fallbackRegion ?? configuredRegion;
    this.#dataOrigin = routing.route?.origin ?? apiOrigin('api-mifit', this.#resolvedRegion);
    this.#routeSource = routing.route ? routing.routeSource! : routing.region ? 'login_response.region'
      : redirectRegion ? 'token_redirect.region' : fallbackRegion ? 'configured_data_region_fallback' : 'configured_auth_region_fallback';
    this.#token = info.app_token; this.#userId = String(info.user_id);
    if (typeof info.login_token === 'string') this.#redactionSecrets.push(info.login_token);
    this.#profile = accountProfile(result, value => this.redact(value) as string);
    this.#expires = Date.now() + 15 * 60000;
  }
  async #get(stage: string, path: string, params: Record<string, string>): Promise<JsonObject> {
    await this.authenticate();
    const url = new URL(path, this.#dataOrigin!);
    url.search = new URLSearchParams({ ...params, userid: this.#userId! }).toString();
    const response = await this.#request(stage, url.toString(), { method: 'GET', headers: {
      apptoken: this.#token!, appname: 'com.huami.midong', appplatform: 'android_phone', 'user-agent': userAgent } });
    if ([401, 403].includes(response.status)) {
      this.#token = undefined;
      this.#failure = { until: Date.now() + 300000, error: new ZeppError(stage, response.status, 'session_rejected_no_retry') };
    }
    return this.#json(stage, response);
  }
  async listWorkouts(cursor?: string) {
    if (cursor !== undefined && !/^\d{1,12}$/.test(cursor)) throw new ZeppError('history', null, 'invalid_cursor');
    this.#historyCursor = cursor ?? null;
    this.#statuses.history = this.#statuses.detail = null;
    // Initial page has no cursor or source/type filter. Continue only with server's next.
    const payload = await this.#get('history', '/v1/sport/run/history.json', cursor === undefined ? {} : { trackid: cursor });
    const data = object(payload.data);
    if (!Array.isArray(data.summary)) throw new ZeppError('history', 200, 'missing_summary_list');
    // Public output is an allowlist; no raw response or token-bearing metadata.
    const keys = ['trackid', 'source', 'type', 'end_time', 'distance', 'sport_time', 'calorie', 'avg_heart_rate'];
    const items = data.summary.map(item => {
      const record = object(item);
      return Object.fromEntries(keys.filter(k => typeof record[k] === 'string' || typeof record[k] === 'number').map(k => [k, record[k]]));
    });
    const next = data.next;
    return { items, count: items.length, pages_requested: 1, diagnostics: this.diagnostics(),
      next_track_id: (typeof next === 'string' || typeof next === 'number') && !['0', '-1', ''].includes(String(next)) ? String(next) : null };
  }
  async workoutDetail(trackid: string, source: string): Promise<JsonObject> {
    const payload = await this.#get('detail', '/v1/sport/run/detail.json', { trackid, source });
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) throw new ZeppError('detail', 200, 'missing_detail_object');
    return object(payload.data);
  }
}
