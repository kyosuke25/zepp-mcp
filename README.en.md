[日本語](README.md) | [English](README.en.md)

# Zepp MCP

A personal MCP server that reads your workouts through Zepp's **unofficial cloud API**. This TypeScript implementation runs on Cloudflare Workers and supports authentication, workout history, workout details, and time-series decoding of GPS, heart rate, altitude, cadence, power, running dynamics, and other samples.

**This is not an official project of Zepp Health, Huami, or Amazfit and is not affiliated with those companies.** The unofficial API may change or become unavailable without notice. The software is provided under the MIT License, without warranties regarding operation or data accuracy.

The current version is `0.2.16`. A public clone runs 77 tests using synthetic data and mocked network requests. Environments with the private local fixture also run four FIT regression tests. Authentication, retrieval of 39 workout records, and detailed decoding of the Fukuoka Marathon into per-second streams, including cadence, stride length, power, stance time, vertical oscillation, and vertical ratio, have been verified with a real account. This does not guarantee compatibility with every account, region, or device.

## Prerequisites

- A Cloudflare account with permission to deploy Workers
- Node.js **22.12.0 or later**, npm, and Git (required by the bundled Wrangler version)
- A **Zepp account that supports email-and-password login**, with your watch workouts synced to it
- An MCP client supporting Streamable HTTP and a custom Authorization header

Wrangler is included as a project dependency. No global installation is needed.

## Before you start: the Zepp account pitfall

If you sign in to the app only through Google or another social provider, entering your Google password into this server will not work. This implementation does not support Google OAuth or social login. **You need to link an email address and set a password on the app account that contains your workouts.** The available settings and their location depend on the app version and account state.

We encountered this actual case during development:

1. Email-and-password authentication succeeded, but workout history was empty.
2. The app containing the watch data used Google sign-in.
3. Trying to add the same email address to that app account failed with an “already exists” message.
4. We concluded that email-and-password authentication was signing in to a separate account with no data.

Even when the email address looks identical, social sign-in and email-and-password sign-in may not refer to the same account. If the email is already in use and cannot be linked, link another available email address to **the account containing your data**, then set its password. Simply creating another empty account will not solve the problem.

`diagnostics.user_id` and, when available, `diagnostics.account_profile.display_name` can help compare accounts. The app may not display an account ID, and a matching display name alone does not prove that the accounts are identical.

## 1. Clone and check offline

```sh
git clone https://github.com/kyosuke25/zepp-mcp.git
cd zepp-mcp
npm ci
npx wrangler --version
npm run check
npm test
npm run check:public
```

Before running tests, `npm test` builds the bundle with `wrangler deploy --dry-run`. It does not deploy to Cloudflare or contact the real Zepp service. If no private data is present in `test/fixtures/local/`, the four FIT regression tests are automatically skipped. Real fixtures are neither distributed nor tracked in Git.

## 2. Deploy to your Cloudflare account

```sh
npx wrangler login
npx wrangler whoami
npx wrangler deploy
```

If needed, change the Worker name `zepp-mcp` in `wrangler.jsonc` before deploying. You do not need to hardcode an account ID or deployment hostname. Save **your own Worker URL** from the deployment output.

```text
https://<worker-name>.<account-subdomain>.workers.dev
```

This is a placeholder. The developer's live server URL is not included in this repository. Until secrets are configured, `/mcp` remains closed with HTTP 503.

## 3. Configure the three secrets

Set Worker secrets using these **exact names**.

| Name | Value |
| --- | --- |
| `ZEPP_EMAIL` | The email linked to the Zepp account containing your workouts |
| `ZEPP_PASSWORD` | That account's Zepp password |
| `MCP_AUTH_TOKEN` | An independently generated random string, **at least 32 characters** |

Generate `MCP_AUTH_TOKEN` yourself using a password manager or a similar generator, and store it in your password manager. Do not reuse your Zepp or Google password. You will configure the same value in your MCP client later.

### Option A: Wrangler CLI

```sh
npx wrangler secret put ZEPP_EMAIL
npx wrangler secret put ZEPP_PASSWORD
npx wrangler secret put MCP_AUTH_TOKEN
```

Enter each value at its interactive prompt. Do not paste secret values into command arguments, Git-tracked files, chat, or issues.

### Option B: Cloudflare dashboard

1. Open your Worker under **Workers & Pages**.
2. Go to **Settings → Variables and Secrets → Add**.
3. Select **Secret** and enter the name and value above. Register all three as secrets.
4. Select **Deploy** to save and apply the changes.

The CLI and dashboard are alternatives; you do not need to register the secrets twice. See [Cloudflare's secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/) for details.

## 4. Plaintext region settings

The `vars` section of `wrangler.jsonc` contains these defaults. These settings are not secrets.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ZEPP_REGION` | `us2` | Initial region used to select the host for the first authentication request |
| `ZEPP_COUNTRY` | `US` | Country code for the initial authentication form |
| `ZEPP_DATA_REGION` | `auto` | Data region used when authentication responses provide no routing hints; auto uses the authentication region |

When the token response provides region/country_code, they are used for the app_token exchange. History and details prioritize the API route in the login response, a recognized login region, and then the token-response region. Configuration does not override those response hints. API hosts are not inferred from country codes.

The implementation normalizes `us-west-2`→`us2`, `eu-central-1`→`de2`, and `cn-north-1`→`cn`. Unrecognized supplementary metadata produces a warning when a recognized response route is available. If only unknown routing information is present and no valid response route can be resolved, the request stops. There is no automatic probing of other shards.

If you change your settings, keep your local `wrangler.jsonc` in sync. A later deployment may overwrite plaintext dashboard settings with the local configuration.

## 5. Connect an MCP client

The Streamable HTTP endpoint is **your Worker URL with `/mcp` appended**. Configure this header:

```text
Authorization: Bearer <your-MCP_AUTH_TOKEN>
```

The following example is for clients supporting environment-variable expansion. Adapt the syntax and expansion mechanism to your client.

```json
{
  "mcpServers": {
    "zepp": {
      "type": "http",
      "url": "${ZEPP_MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${ZEPP_MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

In the client's secret settings, set `ZEPP_MCP_URL` to your `/mcp` URL and `ZEPP_MCP_AUTH_TOKEN` to the same value as the Worker's `MCP_AUTH_TOKEN`. If your client cannot expand `${...}`, use its dedicated URL and secret-header fields. You do not need to give the MCP client your Zepp email or password.

An MCP `initialize` or `tools/list` POST with the Bearer header returning HTTP 200 confirms the MCP connection. Opening `/mcp` in a browser sends a GET and is not an equivalent check. HTTP 200 from `/health` only confirms that the Worker is running; it does not confirm Zepp authentication.

### Tools

| Tool | Arguments | Behavior |
| --- | --- | --- |
| `zepp_authenticate` | None | Authenticate to Zepp and return account/region diagnostics |
| `list_workouts` | Optional `cursor_track_id` | One history page preserving every upstream summary field except secrets; pass the returned `next_track_id` for the next page |
| `get_workout` | `track_id`, `source` | Fetch one detail and decode power and running dynamics; return available shoe attributes under `metadata` |
| `run_poc` | None | Authenticate → fetch one history page → fetch the first workout's details → decode |
| `get_daily_data` | `from_date`, `to_date`, optional `query_type` | Complete sleep, HR, steps and activity response plus JSON and minute-HR decoding |
| `get_health_events` | `event_type`, `from_ms`, `to_ms`, optional `sub_type`, `version`, `limit` | One page of stress, SpO2, PAI, load or other events |
| `get_sport_statistics` | `metric`, `from_date`, `to_date`, optional `limit` | One page of sport-load, VO2max or other statistics |
| `get_profile` | Optional `section`, `property_names`, `property_mode` | Mobile profile or user properties selected by scope or keys |
| `list_gear` | Optional `gear_type` | One My Gear page, with complete attributes and gearId-to-name/distance associations |
| `get_device_settings` | `device_sources` | Settings metadata for known source IDs; not paired-device inventory |

For the first live check, run `run_poc` **once**. If history is empty, detail retrieval is skipped. On failure, inspect the diagnostics instead of repeatedly calling with guessed settings. Zepp API calls other than authentication are GET requests only. There are no data writes or automatic pagination. Only HTTP 401/403 during history or detail retrieval invalidates the session and triggers reauthentication and at most one retry of the same data request. A second rejection stops the request; data-stage rejections are not cached as authentication failures for five minutes. Login-stage failures (auth_tokens/auth_login) are cached for five minutes and are not automatically retried.


This version uses Bearer-header authentication. It has no OAuth login page, automatic client registration, or legacy standalone SSE endpoint. Clients that cannot set custom headers require additional support.

### Shoes and gear

`list_workouts.items[]` preserves every upstream summary field with its original type, including `gearId`. An absent key is omitted. Neither a null selection nor an absent key proves that no shoes are registered. Shoe names are never inferred from IDs.

`get_workout.metadata` and `run_poc.workout.metadata` contain available top-level detail-data shoe attributes such as `gearId`, `shoe_id`, `gear`, and `shoe`. Original key names and scalar values are preserved; arrays and objects are preserved too, with authentication-related keys removed recursively. When shoe data is absent, no shoe keys are added. These attributes are not time-series streams. A history ID is not copied into detail metadata.

Version 0.2.16 uses `GET /users/{userId}/gears`, identified by static analysis of the official APK. With no arguments, `list_gear` sends `status=1&limit=100` for enabled gear. `gear_type: 0` sends `gearType=0&limit=100` for shoes; `gear_type: 1` selects bikes. Per-type queries omit status. Types 0/1 are documented by the APK; other numeric types are not guaranteed upstream. Only one page is fetched. `upstream.data.next` is preserved, but an unknown cursor parameter is never guessed.

`items` and `upstream` retain every non-secret attribute. `gear_by_id[gearId]` is an array of associations. Names prefer `nickname`, fall back to `brandModel`, and otherwise remain null. `total_distance_m` comes from `totalDistanceM`, and `initial_distance_m` from `initialDistanceM`; they are not added together or assigned guessed units. Duplicate gear IDs retain all associations. Use a workout's gearId to look up shoe names and cumulative distance. The [analysis evidence](RESEARCH.md) records the request, model and host-resolution paths.

Production verification of 0.2.16 retrieved seven shoes with names and cumulative distances and matched gearId for all 39 workout summaries. Real IDs, names, and distance values are not stored in the repository.

### All detail fields

Since 0.2.12, `field_inventory` includes every detail key except authentication fields. Entries contain `value_type`, `decode_status`, `sample_count`, and `count_basis`. Known streams are decoded into `streams` and `timeline` as before; every other field is retained with its original value under `metadata`. Unknown strings and arrays are also returned under `undecoded_streams` with their keys, counts, and `raw` values. Unsupported warnings no longer mean that data is discarded. The same handling covers unknown sport-specific fields such as HYROX, strength training, and swimming.

For unknown strings, the count is the number of semicolon-delimited record slots (excluding a trailing separator and retaining interior empty slots); arrays use their element count. These counts do not establish seconds or semantic samples. Objects, numbers, and other values use `sample_count: null` and `count_basis: not_applicable`. Units, column meanings, and timestamps of unknown formats are not guessed: raw values remain available for later validation. Treat raw values as health and personal data too.

### All history fields

Since 0.2.13, workout summaries have no field allowlist. New fields, sport-specific values, arrays, objects, nulls, and booleans are retained. Password, token, secret-key, authorization-header, cookie, and authentication-session keys are excluded recursively; known secret values are redacted before MCP output. Workout information such as `training_sessions` is retained, while authentication fields such as `session_id` are excluded. Personal information such as real IDs, display names, and emails is distinct from secret values under this policy. Use it only through your authenticated MCP clients and keep real responses out of public issues and repositories.

### Data beyond workouts

The [API coverage map](API_MAP.md) distinguishes documented paths from actual account availability. Some health APIs remain unverified against this account. Properties and gear were implemented from APK request definitions in 0.2.16; the [coverage map](API_MAP.md) and [report](REPORT.md) distinguish their verification status. Making all Zepp data accessible is the policy, rather than a claim that every endpoint and semantic decoder is already complete.

- `get_daily_data` accepts `YYYY-MM-DD` dates covering up to 31 inclusive days. `query_type` defaults to `detail`; `summary` is also supported. The complete structured response is returned under `upstream`, and the encoded wire response under `encoded_upstream`. Both `days[].summary` and `days[].decoded.summary` expose the expanded summary; `summary_decode` states its format or result. Date-keyed responses, wrapper arrays, whitespace and unpadded/URL-safe Base64 are supported. Unknown formats produce `summary: null` and a warning while retaining raw values. Heart-rate bytes become minute positions and bpm under `heart_rate_minutes`; 0, 254, and 255 become null. Activity binary data remains raw with its format marked unverified. Dates and timezones are not inferred; include the previous date for sleep crossing midnight.
- `get_health_events` accepts Unix-millisecond bounds spanning up to 31 days. `limit` is 1–1000 (default 200), and `version` defaults to `v1`. Use `all_day_stress` for stress, `blood_oxygen` for SpO2, and `PaiHealthInfo` for PAI. For training load, use `version: v2`, `event_type: exertion`, and `sub_type: algo_result`. All response fields and parsed embedded JSON are retained. Other event names are accepted, without a guarantee that Zepp supports or returns them.
- `get_sport_statistics` accepts up to 31 inclusive dates. Documented metrics are `SPORT_LOAD` and `VO2_MAX`; `limit` is 1–1000 (default 200). Unknown metric names may be rejected upstream.
- `get_profile.section` defaults to `profile`, using `/huami.health.getUserInfo.json` with `userid`. `section: properties` uses the numeric-ID path `/users/{userId}/properties` with `propertyName` and `mode`. Without additional arguments, it mirrors the observed app query `propertyName=huami.watch&mode=RANGE` for the watch-settings scope; this does not fetch every namespace unconditionally. Explicit `property_names` defaults to `BATCH` for comma-separated exact keys. `property_mode: RANGE` requires exactly one namespace/prefix. Only BATCH supports multiple keys, with a local limit of 100. An empty property object is retained as a valid response. For `get_device_settings.device_sources`, supply source IDs obtained from daily data or another known source.

Production verification of 0.2.16 confirmed HTTP 200 for both properties RANGE and BATCH. The default `huami.watch` scope was empty, while the APK-observed `huami.midong.user.version` scope returned two fields; BATCH with an exact returned key retrieved one field. A RANGE prefix used as a BATCH exact key may return an empty object. Example scope query:

```json
{"section":"properties","property_names":["huami.midong.user.version"],"property_mode":"RANGE"}
```

All tools are read-only with no automatic pagination. Health GETs use the host resolved during authentication and `appplatform: web`, while mobile profile, properties and gear use `android_phone`. HTTP 401/403 triggers at most one reauthentication and retry; the tools never probe another API or region automatically. Authentication material is excluded and redacted even inside embedded JSON/Base64 JSON. Empty responses do not necessarily mean that no measurements exist: device, date range, region, and upstream behavior affect availability.

## Local development

```sh
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
```

Open `.dev.vars` in an editor and set the same three secrets. `.dev.vars` is for local development only and is not automatically registered in production.

```sh
npm run dev
```

The local MCP URL is `http://127.0.0.1:8787/mcp`. Running `npm run poc` once in another terminal reads `.dev.vars` and contacts the real Zepp service through the local MCP server. Results are saved to the Git-ignored `output/poc-result.json`.

To check decoding without contacting a real account, run `npm run fixture`. Its output is `output/fixture-decoded.json`.

## Diagnostics and data format

Authentication, history, detail, and PoC responses include `diagnostics`: implementation version, user_id, display name when available, configuration, resolved region, history host, routing source, and upstream HTTP statuses. `login_region_shape` and `routing_warnings` also identify unrecognized supplementary hints. `retry_count` is the cumulative retry count within the isolate; `last_retry` contains the last retry stage, UTC timestamp, and HTTP status. `authentication_source` identifies the last authentication path: `login`, `shared_login` (waiting for a concurrent login), `cache` (using an unexpired session), or `failure_cache` (a cached login failure). As indicated by `upstream_status_scope: last_observed`, upstream HTTP statuses are the last observed values and do not imply upstream revalidation when using the cache. Sessions are not coordinated across isolates, so another login can still invalidate a refreshed session. Raw authentication responses, Location URLs, passwords, and tokens are not returned. Raw health data is retained after authentication material is excluded and redacted. Treat real IDs, display names, and location data as personal information; do not paste them into public issues.

The display-name `status` is `available`, `not_returned`, or `withheld`; the name is null when unavailable. No additional profile API is called. `authentication_method: email_password` describes the Worker's authentication method, not detection of Google sign-in in the app.

`streams` contains observations for each sensor; `timeline` is their union by offset in seconds. Timestamps use UTC. Missing observations are not interpolated or forward-filled. GPS latitude/longitude deltas are accumulated and divided by 1e8; absolute altitude values in centimeters are converted to meters. Heart-rate deltas are accumulated. Cadence, `cadence_spm`, prioritizes gait column 4. Only when that column is absent is cadence estimated as interval steps × 60 ÷ seconds, with `cadence_source` distinguishing the source. Unsupported streams produce warnings.

Power and running dynamics are returned in `streams.power_meter`, `streams.runPosture`, and the merged `timeline`.

| Output field | Unit and conversion |
| --- | --- |
| `power_w` | Running power, W |
| `stance_time_ms` | Stance time, ms; 65535 becomes null |
| `vertical_oscillation_mm` | Vertical oscillation, mm; 65535 becomes null |
| `vertical_ratio_pct` | Vertical ratio, %; encoded value ÷ 10; 255 becomes null |

The first column of both streams is accumulated as a seconds delta. A first power delta of 1 starts at offset 1; a first runPosture delta of 0 starts at offset 0. A delta of 0 means another observation at the same time; 2 means an observation two seconds later. Gaps are not filled. There is no fixed ±1-second adjustment or alignment against the GPS time column. Same-time observations remain in the original stream; timeline uses the last observation. `sample_alignment` reports `mode: delta_seconds`, input counts, zero-delta counts, gap counts, and related information.

The temporary raw-stream diagnostic tool has been removed following final FIT validation.

## Security and publication scope

- **The source is public, but access to personal data through the live MCP server requires a token.** Knowing the URL is not enough. The network URL itself is public; only `/health` returns a non-sensitive liveness response.
- If secrets are missing or the MCP token is shorter than 32 characters, `/mcp` returns 503. A missing or incorrect Bearer token returns 401.
- This repository contains no real credentials, real user_id, live deployment URL, or Cloudflare account ID. Public test data consists only of synthetic values and dummy credentials. Private real data is isolated in the Git-ignored directory. The fixed authentication key/IV are public protocol constants, not personal secrets.
- `.env`, `.dev.vars`, `.wrangler/`, `output/`, `dist/`, and `test/fixtures/local/` are excluded from Git. Do not force-add them.
- Zepp tokens are cached only in isolate memory, for up to 15 minutes. Authentication failures are suppressed for five minutes within the same isolate; caching and suppression are not shared across isolates or deployments.
- The implementation avoids logging raw responses and authentication headers. Keep secrets and health data out of any additional logging or monitoring.
- Anyone you share the MCP token with can retrieve your personal data. Limit where it is stored and which clients receive it, and rotate it if leaked.

## File layout and license

`src/zepp-client.ts` and `src/decoder.ts` are independent of MCP. `src/index.ts` is the Workers/MCP entry point; `test/` contains synthetic data, network mocks, and workerd integration tests; `REPORT.md` records validation and pre-publication checks.

[MIT License](LICENSE).
