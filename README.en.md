[日本語](README.md) | [English](README.en.md)

# Zepp MCP

A personal MCP server that reads your workouts through Zepp's **unofficial cloud API**. This TypeScript implementation runs on Cloudflare Workers and supports authentication, workout history, workout details, and time-series decoding of GPS, heart rate, altitude, cadence, and other samples.

**This is not an official project of Zepp Health, Huami, or Amazfit and is not affiliated with those companies.** The unofficial API may change or become unavailable without notice. The software is provided under the MIT License, without warranties regarding operation or data accuracy.

The current version is `0.2.4`. It has 30 tests using synthetic data and mocked network requests. Authentication, retrieval of 39 workout records, and detailed decoding of the Fukuoka Marathon into per-second streams, including cadence and stride length, have been verified with a real account. This does not guarantee compatibility with every account, region, or device.

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

Before running tests, `npm test` builds the bundle with `wrangler deploy --dry-run`. It does not deploy to Cloudflare or contact the real Zepp service.

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
| `list_workouts` | Optional `cursor_track_id` | Fetch one history page; pass the returned `next_track_id` for the next page |
| `get_workout` | `track_id`, `source` | Fetch and decode one workout using the ID and source from history |
| `run_poc` | None | Authenticate → fetch one history page → fetch the first workout's details → decode |
| `debug_raw_streams` | `track_id`, `source` | Temporary diagnostic: return all field names/types and the first 8000 characters plus full length of each string-stream candidate from one detail response |

For the first live check, run `run_poc` **once**. If history is empty, detail retrieval is skipped. On failure, inspect the diagnostics instead of repeatedly calling with guessed settings. Zepp API calls other than authentication are GET requests only. There are no data writes, automatic pagination, or automatic retries.

`debug_raw_streams` is temporary and will be removed after comparison with FIT data. `fields` lists every field's key and type; `stream_keys` and `streams` cover every string field, including empty strings, except metadata and sensitive fields. Each entry has `raw_prefix`, `length` in Unicode characters, and `truncated`. `excluded_fields` explains exclusions for non-string, metadata, and sensitive fields. It does not decode data or fetch additional history. Results contain real workout/location data: do not post them to public issues or commit them to Git. Additional decoding of power and running dynamics has not yet been implemented.

This version uses Bearer-header authentication. It has no OAuth login page, automatic client registration, or legacy standalone SSE endpoint. Clients that cannot set custom headers require additional support.

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

Authentication, history, and PoC responses include `diagnostics`: implementation version, user_id, display name when available, configuration, resolved region, history host, routing source, and upstream HTTP statuses. `login_region_shape` and `routing_warnings` also identify unrecognized supplementary hints. Raw responses, Location URLs, passwords, and tokens are not returned. Treat real IDs, display names, and location data as personal information; do not paste them into public issues.

The display-name `status` is `available`, `not_returned`, or `withheld`; the name is null when unavailable. No additional profile API is called. `authentication_method: email_password` describes the Worker's authentication method, not detection of Google sign-in in the app.

`streams` contains observations for each sensor; `timeline` is their union by offset in seconds. Timestamps use UTC. Missing observations are not interpolated or forward-filled. GPS latitude/longitude deltas are accumulated and divided by 1e8; absolute altitude values in centimeters are converted to meters. Heart-rate deltas are accumulated. Cadence, `cadence_spm`, prioritizes gait column 4. Only when that column is absent is cadence estimated as interval steps × 60 ÷ seconds, with `cadence_source` distinguishing the source. Unsupported streams produce warnings.

## Security and publication scope

- **The source is public, but access to personal data through the live MCP server requires a token.** Knowing the URL is not enough. The network URL itself is public; only `/health` returns a non-sensitive liveness response.
- If secrets are missing or the MCP token is shorter than 32 characters, `/mcp` returns 503. A missing or incorrect Bearer token returns 401.
- This repository contains no real credentials, real user_id, live deployment URL, or Cloudflare account ID. Tests use only synthetic data and dummy credentials. The fixed authentication key/IV are public protocol constants, not personal secrets.
- `.env`, `.dev.vars`, `.wrangler/`, `output/`, and `dist/` are excluded from Git. Do not force-add them.
- Zepp tokens are cached only in isolate memory, for up to 15 minutes. Authentication failures are suppressed for five minutes within the same isolate; caching and suppression are not shared across isolates or deployments.
- The implementation avoids logging raw responses and authentication headers. Keep secrets and health data out of any additional logging or monitoring.
- Anyone you share the MCP token with can retrieve your personal data. Limit where it is stored and which clients receive it, and rotate it if leaked.

## File layout and license

`src/zepp-client.ts` and `src/decoder.ts` are independent of MCP. `src/index.ts` is the Workers/MCP entry point; `test/` contains synthetic data, network mocks, and workerd integration tests; `REPORT.md` records validation and pre-publication checks.

[MIT License](LICENSE).
