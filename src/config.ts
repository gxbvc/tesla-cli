import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const rootDir = join(__dirname, "..");
export const envPath = join(rootDir, ".env");
loadEnv({ path: envPath });

// Fixed Tesla OAuth endpoints (do not change per-install).
export const TESLA_AUTH_URL = "https://auth.tesla.com/oauth2/v3/authorize";
export const TESLA_TOKEN_URL =
  "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";
export const TESLA_SCOPES =
  "openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds";

export const TESLA_CLIENT_ID = process.env.TESLA_CLIENT_ID || "";
export const TESLA_CLIENT_SECRET = process.env.TESLA_CLIENT_SECRET || "";
export const TESLA_REDIRECT_URI =
  process.env.TESLA_REDIRECT_URI || "http://localhost:3456/callback";
export const TESLA_AUDIENCE =
  process.env.TESLA_AUDIENCE || "https://fleet-api.prd.na.vn.cloud.tesla.com";
export const TESLA_DOMAIN = process.env.TESLA_DOMAIN || "gxb.vc";
export const TESLA_PROXY_URL = process.env.TESLA_PROXY_URL || "";

export const tokenCachePath = join(rootDir, ".token.json");
export const privateKeyPath = join(rootDir, "private-key.pem");
export const publicKeyPath = join(rootDir, "public-key.pem");

export function requireClientCreds(): void {
  if (!TESLA_CLIENT_ID || !TESLA_CLIENT_SECRET) {
    console.error(
      JSON.stringify({
        ok: false,
        error:
          "TESLA_CLIENT_ID and TESLA_CLIENT_SECRET are required in .env",
      })
    );
    process.exit(1);
  }
}
