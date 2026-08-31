# tesla-cli

Personal Tesla Fleet API CLI. TypeScript, `fetch`, no Tesla SDK.

## Prerequisites

- Node.js 18+
- A Tesla developer app at [developer.tesla.com](https://developer.tesla.com) (client ID/secret)
- `openssl` (for `tesla-cli keys`)
- A domain you control that can serve a static file over HTTPS (used for `TESLA_DOMAIN`, e.g. `gxb.vc`)

## Setup

```bash
cd ~/tools/tesla-cli
npm install
cp .env.example .env
# fill in TESLA_CLIENT_ID, TESLA_CLIENT_SECRET, TESLA_DOMAIN
npm run build
npm link
```

Setup order matters — registration gates all Fleet API calls, including reads:

1. **`tesla-cli keys`** — generates `private-key.pem` / `public-key.pem` (gitignored).
2. **Host the public key** at `https://$TESLA_DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem` (the exact path `tesla-cli keys` prints). This step is manual, not done by this CLI.
3. **`tesla-cli register`** — registers the app as a Tesla partner account for `TESLA_DOMAIN`. Requires the public key to already be hosted.
4. **`tesla-cli auth`** — opens a browser for the Tesla OAuth login, saves `TESLA_REFRESH_TOKEN` to `.env`.
5. **Pair the virtual key** by visiting `https://tesla.com/_ak/$TESLA_DOMAIN` from a phone with the Tesla app, near the car. Required before any lock/unlock/climate/charge command works.

### Billing

Tesla developer accounts default to a **$0 billing limit**, which silently rejects every vehicle API call even with correct auth. Add a payment method and raise the limit at developer.tesla.com before expecting `status`/`vehicles`/commands to work.

### Command signing (2021+ cars)

Reads (`vehicles`, `status`, `wake`) hit the Fleet API directly. Commands (`lock`, `unlock`, `honk`, `climate`, `charge`) go through local `tesla-http-proxy` on `https://localhost:4443` (`TESLA_PROXY_URL`). The proxy is kept running by launchd (`vc.gxb.tesla-http-proxy`). The `tesla-cli` wrapper trusts `tls-cert.pem` automatically.

## Commands

```bash
tesla-cli auth                  # OAuth login, saves refresh token to .env
tesla-cli keys                  # generate EC key pair, print public key URL
tesla-cli register              # register as Tesla partner for TESLA_DOMAIN
tesla-cli vehicles               # list vehicles
tesla-cli status [--vin VIN]     # battery, lock, climate, location slice + raw data
tesla-cli wake [--vin VIN]
tesla-cli lock [--vin VIN]
tesla-cli unlock [--vin VIN]
tesla-cli honk [--vin VIN]
tesla-cli climate on|off [--vin VIN]
tesla-cli charge start|stop [--vin VIN]
```

`--vin` is optional when the account has exactly one vehicle; otherwise it's required.

## Output

All commands print JSON to stdout:

```json
{"ok": true, "data": { ... }}
{"ok": false, "error": "message"}
```
