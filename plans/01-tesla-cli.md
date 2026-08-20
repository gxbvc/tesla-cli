# tesla-cli v1

Personal Tesla Fleet API CLI. TypeScript, fetch, no SDK. Match dropbox-cli (OAuth) and printful-cli (JSON envelope).

Do not overwrite `.env`, `.gitignore`, or existing credentials. Do not print secrets. Do not read `.env` into logs.

## Layout (do not add extra files)

```
tesla-cli/
  bin/tesla-cli.js
  src/cli.ts
  src/config.ts
  src/auth.ts
  src/api.ts
  src/output.ts
  package.json
  tsconfig.json
  AGENTS.md
  README.md
  .env.example      # already exists; you may APPEND keys, do not wipe
  .gitignore        # already exists; keep .env .token.json private-key.pem
```

No `src/client.ts`. No `src/commands/`. No Tesla SDK. No protobuf. No telemetry. No energy/Powerwall.

## Deps

`commander`, `dotenv`, `open`. Dev: `typescript`, `tsx`, `@types/node`.
`"type": "module"`, bin `tesla-cli` → `./bin/tesla-cli.js`.
Scripts: `build` = tsc, `dev` = tsx src/cli.ts, `auth` = tsx src/auth.ts.
tsconfig: ES2022, Node16, strict, outDir dist, rootDir src.

## JSON

Copy printful-cli `src/output.ts`: `ok(data)` stdout `{ok:true,data}`, `fail(error,code?)` stderr `{ok:false,error}` exit 1.

## Config (`src/config.ts`)

Load dotenv from the tool directory (same `fileURLToPath` pattern as dropbox-cli), not cwd.
Required: `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET`.
Defaults:
- `TESLA_REDIRECT_URI=http://localhost:3456/callback`
- `TESLA_AUDIENCE=https://fleet-api.prd.na.vn.cloud.tesla.com`
- `TESLA_AUTH_URL=https://auth.tesla.com/oauth2/v3/authorize`
- `TESLA_TOKEN_URL=https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token`
- `TESLA_API_BASE` = audience
- `TESLA_DOMAIN=gxb.vc`
- `TESLA_PROXY_URL` optional (e.g. `https://localhost:4443`)

Token cache file: `~/tools/tesla-cli/.token.json` (gitignored). Private key: `~/tools/tesla-cli/private-key.pem`.

## Auth (`src/auth.ts`)

Copy dropbox-cli localhost:3456 `/callback` server + `open` package.

Authorize GET `https://auth.tesla.com/oauth2/v3/authorize` with:
`response_type=code`, `client_id`, `redirect_uri`, `scope=openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds`, `state` (random), `prompt=login`.
No PKCE.

Token POST `application/x-www-form-urlencoded` to `TESLA_TOKEN_URL`:
`grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `audience`, `redirect_uri`.

Save `refresh_token` to `.env` as `TESLA_REFRESH_TOKEN` (dropbox `updateEnvVar` pattern). Save `{access_token, refresh_token, expires_at}` to `.token.json`.

Refresh: `grant_type=refresh_token`, `client_id`, `refresh_token`. **Always persist the new refresh token** (single-use; 24h grace on the previous one). Access token ~8h; refresh if `expires_at` is within 60s.

`api.ts` `authedFetch` uses the user access token. On 401, refresh once and retry.

Partner token (client_credentials) is separate, only for `register`. Do not mix it into vehicle calls.

## API (`src/api.ts`)

`apiFetch(method, path, {body, token, base}?)`.
Reads/wake: `TESLA_API_BASE`.
Commands (`/command/`): `TESLA_PROXY_URL` if set, else `TESLA_API_BASE` (will fail on 2021+ cars until proxy exists — surface Tesla's error JSON, do not fake success).

VIN: optional CLI arg; if omitted, `GET /api/1/vehicles` and use the only vehicle, or fail if 0 or >1 asking for `--vin`.

Wake-before-command: if a command/status gets a not-online/asleep error, `POST /wake_up`, poll `GET /api/1/vehicles/{vin}` up to ~30s, retry once. Do not wake on `vehicles` list.

## Commands (all in `src/cli.ts`)

```
tesla-cli auth
tesla-cli keys              # openssl ecparam prime256v1 private-key.pem + public-key.pem if missing
tesla-cli register          # client_credentials token, POST /api/1/partner_accounts {domain}
tesla-cli vehicles
tesla-cli status [--vin]
tesla-cli wake [--vin]
tesla-cli lock|unlock|honk [--vin]
tesla-cli climate on|off [--vin]
tesla-cli charge start|stop [--vin]
```

Endpoints (NA):
- GET `/api/1/vehicles`
- GET `/api/1/vehicles/{vin}/vehicle_data`
- POST `/api/1/vehicles/{vin}/wake_up`
- POST `/api/1/vehicles/{vin}/command/door_lock|door_unlock|honk_horn|auto_conditioning_start|auto_conditioning_stop|charge_start|charge_stop`
- POST `/api/1/partner_accounts` body `{domain}` with partner token
- GET `/api/1/partner_accounts/public_key?domain=` to verify

`status` should print a small useful slice inside `data`: vin, state, battery_level, charging_state, locked, inside_temp, latitude/longitude if present — plus keep the raw `vehicle_data` under `data.raw` so agents can jq. Keep it one response.

`keys` prints the public key path and the URL Tesla must fetch: `https://$TESLA_DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem`. Does not upload it.

## Docs

AGENTS.md: terse cheatsheet.
README.md: setup (auth, keys, host public key, register, pair virtual key at `https://tesla.com/_ak/$TESLA_DOMAIN`, optional tesla-http-proxy). Do not paste secrets.

Append to `.env.example` (do not delete existing lines):
```
TESLA_REFRESH_TOKEN=
TESLA_DOMAIN=gxb.vc
TESLA_PROXY_URL=
```

## Register in toolkit

Alphabetically:
- `~/tools/sync.sh` REPOS: `"tesla-cli|https://github.com/gxbvc/tesla-cli.git|main"`
- CRED_FILES: `"tesla-cli/.env"`
- npmdir loop: add `tesla-cli`
- `~/tools/AGENTS.md` index row: Tesla vehicle status and commands via Fleet API

## Finish

```
npm install && npm run build && npm link
git init && git add (never .env) && commit
gh repo create gxbvc/tesla-cli --public --source=. --push
```

If `gh repo create` fails, still leave a clean local commit.

## Out of scope

Hosting the PEM on gxb.vc, adding billing, pairing the virtual key, installing tesla-http-proxy, editing the Tesla developer dashboard.
