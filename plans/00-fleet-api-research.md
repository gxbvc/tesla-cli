# Tesla Fleet API research — tesla-cli (2026)

## Direct answer

For a **personal, single-vehicle CLI**, the modern Tesla Fleet API requires **all** of the following before any command (lock/climate/honk/charge) will work, and this cannot be skipped even for a personal app:

1. User OAuth token (authorization_code + PKCE-free, but with `state`; refresh token via `offline_access`).
2. **Partner registration is mandatory for every app**, including personal ones — "Each application from developer.tesla.com must complete this step." This requires a **client_credentials (M2M) token** and a **publicly hosted EC public key** on a real domain (`gxb.vc` works; `localhost` does not).
3. **Virtual key pairing** in the Tesla mobile app (`https://tesla.com/_ak/<domain>`) is required for **commands** (lock, climate, honk, charge start/stop). It is **not** required for reads (`vehicle_data`, `vehicles` list, `wake_up`).
4. Most 2021+ vehicles now require **signed commands** via the Vehicle Command Protocol. The legacy plain-REST `/command/*` endpoints are deprecated/rejected on these cars unless the request is signed. The practical minimum is running Tesla's own **`tesla-http-proxy`** (Go binary/Docker image from `teslamotors/vehicle-command`) locally, which signs REST calls with your private key before forwarding to Fleet API — this is far less code than reimplementing the protobuf/BLE signing scheme in TypeScript.

Blocker for you: **domain + public-key hosting is not optional**, and **virtual key pairing must be done once in the Tesla app on your phone**, in person/BLE-proximity to the car (or via the deep link while near the car).

---

## 1. Third-party user OAuth

- Authorize: `https://auth.tesla.com/oauth2/v3/authorize`
  Params: `response_type=code`, `client_id`, `redirect_uri`, `scope` (space-delimited, must include `openid` and `offline_access` to get a refresh token), `state` (required), `nonce` (optional), `prompt_missing_scopes`/`require_requested_scopes` (optional).
  No PKCE (`code_challenge`) parameter is documented/required — confidential client (client_secret) flow.
- Token exchange: `POST https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token`
  Body: `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `audience` (Fleet API base URL, e.g. `https://fleet-api.prd.na.vn.cloud.tesla.com`), `redirect_uri`.
- Refresh: same token URL, `grant_type=refresh_token`, `client_id`, `refresh_token`.
  - Refresh token is **single-use**; a new one is issued each time. Grace window: most recently used refresh token stays valid up to **24 hours** if you fail to save the new one.
  - Refresh token **expires after 3 months** of non-use.
  - `401 login_required` = expired/cycled-out token or user password reset.
- Note: token calls must hit `fleet-auth.prd.vn.cloud.tesla.com`, not the regional Fleet API host (different rate limits).

Source: https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens

## 2. Partner (client_credentials) token

- `POST https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token`, `grant_type=client_credentials`, `client_id`, `client_secret`, `audience`, `scope`.
- Required to call `POST /api/1/partner_accounts` (register) — **mandatory one-time step per region**, no exception for personal-use apps ("Each application from developer.tesla.com must complete this step").
- Cannot be skipped: without registration, Fleet API calls (even reads, per "A public key must be hosted... before making calls to Fleet API") are not enabled for the app.

Source: https://developer.tesla.com/docs/fleet-api/authentication/partner-tokens, https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api

## 3. Public key hosting

- Exact path: `https://<app-domain>/.well-known/appspecific/com.tesla.3p.public-key.pem`
- Key type: EC, curve **secp256r1 / prime256v1** (P-256). Generate with:
  ```
  openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem
  openssl ec -in private-key.pem -pubout -out public-key.pem
  ```
- Must be a **real internet-reachable domain** matching the app's `allowed_origins` root domain on developer.tesla.com — localhost cannot serve this. **`gxb.vc` (or a subdomain) must be used.**
- Required for: domain-ownership verification during partner registration (gate for *any* Fleet API calls), and specifically for validating **signed vehicle commands** and Fleet Telemetry. Private key never touches Tesla's servers or gets hosted; it lives on your machine and signs command payloads (via the proxy).
- Verify registration: `GET /api/1/partner_accounts/public_key?domain={domain}` (needs partner token).

Source: https://developer.tesla.com/docs/fleet-api/virtual-keys/developer-guide, https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints

## 4. Vehicle Command Protocol / tesla-http-proxy — is it required in 2026?

- Yes for most vehicles. Doc: "The Vehicle Commands Proxy is **not required** for most business vehicles and **pre-2021 S and X vehicles**." Implication: everything else (2021+ Model 3/Y/S/X, i.e. almost all consumer cars sold since 2021) **requires signed commands**.
- If a command is unsigned, "the vehicle will reject the request and perform no action."
- Some individual command endpoints explicitly call out the requirement, e.g. `set_pin_to_drive`, `reset_pin_to_drive_pin`, `set_vehicle_name`.
- Smallest path: run `teslamotors/vehicle-command`'s `tesla-http-proxy` (Go binary, or `docker run tesla/vehicle-command`) as a local sidecar. It exposes the **same REST paths** (`/api/1/vehicles/{vin}/command/door_lock` etc.) on `localhost:4443`, taking your OAuth bearer token + configured private key, and forwards signed requests to Fleet API. Your TypeScript CLI just calls `https://localhost:4443/...` instead of Tesla's servers directly for command calls — no protobuf/BLE signing code needed in TS. `vehicle_data`/`wake_up`/list vehicles can go straight to the real Fleet API (reads don't need signing).
- Alternative (avoid the Go proxy sidecar entirely): `POST /api/1/vehicles/{vin}/signed_command`, a generic endpoint replacing the legacy per-command REST endpoints, but it requires you to construct the signed protobuf payload yourself — not worth it vs. running the proxy binary.

Source: https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands, https://github.com/teslamotors/vehicle-command

## 5. Endpoints + JSON shapes

Regional base URL (North America): `https://fleet-api.prd.na.vn.cloud.tesla.com`

| Purpose | Method + Path | Token | Via proxy? |
|---|---|---|---|
| List vehicles | `GET /api/1/vehicles` | user | no |
| Vehicle summary | `GET /api/1/vehicles/{vin}` | user | no |
| Vehicle status/data | `GET /api/1/vehicles/{vin}/vehicle_data` | user | no |
| Wake | `POST /api/1/vehicles/{vin}/wake_up` | user | no |
| Fleet status (check if vehicle needs signed commands) | `POST /api/1/vehicles/fleet_status` | user or partner | no |
| Lock | `POST /api/1/vehicles/{vin}/command/door_lock` | user | **yes** (via `tesla-http-proxy` on `localhost:4443`) |
| Unlock | `POST /api/1/vehicles/{vin}/command/door_unlock` | user | yes |
| Climate on | `POST /api/1/vehicles/{vin}/command/auto_conditioning_start` | user | yes |
| Climate off | `POST /api/1/vehicles/{vin}/command/auto_conditioning_stop` | user | yes |
| Honk | `POST /api/1/vehicles/{vin}/command/honk_horn` | user | yes |
| Charge start | `POST /api/1/vehicles/{vin}/command/charge_start` | user | yes |
| Charge stop | `POST /api/1/vehicles/{vin}/command/charge_stop` | user | yes |
| Partner registration (one-time) | `POST /api/1/partner_accounts` | partner (client_credentials) | no |
| Verify public key registered | `GET /api/1/partner_accounts/public_key?domain=...` | partner | no |

`vehicle_data` response includes nested `charge_state`, `climate_state`, `drive_state`, `vehicle_state`, etc. (undocumented exact shape in the excerpt fetched; recommend calling it live once auth works and inspecting the JSON — it's large and self-describing). Command endpoints generally return `{"response": {"result": true/false, "reason": "..."}}`.

Sources: https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints, https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands, https://developer.tesla.com/docs/fleet-api/getting-started/regions-countries

## 6. Virtual key pairing

- Deep link: `https://tesla.com/_ak/<app-domain>` (optionally `?vin=VIN123`).
- Prereq: user has authorized the app (step 1) with `vehicle_device_data`, `vehicle_cmds`, or `vehicle_location` scope.
- User opens this link on their phone (Tesla app installed, near/paired with the car) to add the app's public key to the vehicle's key list (max 20 keys).
- **Not needed for reads** (vehicle_data, list, wake). **Required for any command** on vehicles that require the Vehicle Command Protocol (i.e., essentially all 2021+ cars).
- Revocable any time from the car's Locks screen, or by revoking app access from `https://auth.tesla.com/user/revoke/consent?...`.

Source: https://developer.tesla.com/docs/fleet-api/virtual-keys/developer-guide

## 7. Rate limits, wake-before-command, billing

- Per device, per account: **Realtime Data 60/min, Wakes 3/min, Device Commands 30/min**.
- Billing: pay-per-use, billing limit defaults to **$0**, must add payment method + limit or the app is auto-disabled. $10/mo discount for individual/small devs. Requests with status <500 are billable; ≥500 are not.
- Wake behavior: vehicles asleep will reject `vehicle_data`/commands until woken; Tesla's guidance is to check online state first (via `vehicles`/`fleet_status`) rather than always waking, since frequent waking is "a sign of improper application design" and wakes are separately rate-limited (3/min). No explicit "408" code documented in the fetched pages — expect to poll vehicle online state and call `wake_up` then retry with backoff (few seconds) before issuing the real command/data call.

Source: https://developer.tesla.com/docs/fleet-api/billing-and-limits

---

## Recommended minimum auth sequence

1. Generate EC P-256 keypair (`openssl ecparam -name prime256v1 ...`), host `public-key.pem` at `https://<domain>/.well-known/appspecific/com.tesla.3p.public-key.pem` on a real domain (e.g. a `gxb.vc` subdomain). **Human action: DNS/hosting on gxb.vc.**
2. Get a partner (client_credentials) token; call `POST /api/1/partner_accounts` to register the app + verify the public key (one-time per region).
3. User OAuth: local HTTP server on `localhost:3456/callback` (already registered) → send owner to `/authorize` with `scope=openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds` → exchange code for access+refresh tokens.
4. `GET /api/1/vehicles` and `POST /api/1/vehicles/fleet_status` to list vehicles and check `vehicle_command_protocol_required`.
5. **Human action:** open `https://tesla.com/_ak/<domain>` in the Tesla phone app while near the car to pair the virtual key (needed once, for commands only).
6. Reads (`vehicle_data`, `wake_up`) go straight to `fleet-api.prd.na.vn.cloud.tesla.com` with the user access token.
7. Commands go through a local `tesla-http-proxy` (from `teslamotors/vehicle-command`, run as a Docker/Go sidecar with the private key + user token) on `localhost:4443`, hitting the identical `/api/1/vehicles/{vin}/command/*` paths.

## What to skip for v1

- Fleet Telemetry / streaming (explicitly out of scope, and it's a separate config/websocket system).
- Energy/Powerwall endpoints (different product entirely).
- `signed_command` raw protobuf construction — use the Go proxy binary instead, don't reimplement signing in TS.
- Driver invitations, guest mode, navigation, scheduling, PIN-to-drive, valet — not requested.
- PKCE — not part of Tesla's documented flow.

## Blockers needing a human

1. **Domain hosting**: pick/confirm a `gxb.vc` subdomain and get the public key file served over HTTPS there before partner registration can succeed.
2. **Virtual key pairing**: must be done once, in person, via the Tesla iPhone/Android app near the car (`https://tesla.com/_ak/<domain>`) — an agent cannot do this remotely.
3. **Billing**: add a payment method and set a billing limit in the developer dashboard, or all calls will be rejected once the app starts making billable requests.
4. **Partner registration is per-region** — since this is a US car, only NA region registration is needed, but confirm audience URL matches (`https://fleet-api.prd.na.vn.cloud.tesla.com`).

## Sources

- https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens
- https://developer.tesla.com/docs/fleet-api/authentication/partner-tokens
- https://developer.tesla.com/docs/fleet-api/virtual-keys/developer-guide
- https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints
- https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands
- https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints
- https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api
- https://developer.tesla.com/docs/fleet-api/getting-started/regions-countries
- https://developer.tesla.com/docs/fleet-api/billing-and-limits
- https://github.com/teslamotors/vehicle-command

## Gaps

- Exact `vehicle_data` JSON schema not pulled in full (large, self-describing — inspect live once auth works).
- No explicit "HTTP 408 asleep" documentation found in current docs; behavior inferred from best-practices guidance on checking online state + wake rate limits.
