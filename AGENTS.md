# tesla-cli

Personal Tesla Fleet API CLI (no SDK, no telemetry, no Powerwall).

## Setup order

`keys` → host the public key → `register` → `auth` → pair the virtual key. See README.md.

## Commands

```bash
tesla-cli auth                 # opens browser, saves TESLA_REFRESH_TOKEN to .env
tesla-cli keys                 # generates private-key.pem / public-key.pem if missing
tesla-cli register              # registers this app as a Tesla partner account
tesla-cli vehicles
tesla-cli status [--vin VIN]
tesla-cli wake [--vin VIN]
tesla-cli lock|unlock|honk [--vin VIN]
tesla-cli climate on|off [--vin VIN]
tesla-cli charge start|stop [--vin VIN]
```

`--vin` is optional if the account has exactly one vehicle.

## Output

JSON envelope: `{"ok": true, "data": {...}}` or `{"ok": false, "error": "..."}`.

## Auth model

- `TESLA_REFRESH_TOKEN` lives in `.env` only, updated on every refresh (refresh tokens are single-use).
- `.token.json` (gitignored) caches only the short-lived access token.
- `register` uses a separate client_credentials partner token, never mixed into vehicle calls.
- `lock`/`unlock`/`honk`/`climate`/`charge` go through `TESLA_PROXY_URL` if set (required for 2021+ cars); otherwise they hit the Fleet API directly and will fail with Tesla's error on unsupported cars.

## Gotchas

- Billing limit on the Tesla developer account defaults to $0 — all vehicle calls get rejected until a payment method + limit are set in the dashboard.
- `tesla-http-proxy` serves a self-signed cert; set `NODE_EXTRA_CA_CERTS` to its `tls-cert.pem` or requests through `TESLA_PROXY_URL` fail on TLS.
