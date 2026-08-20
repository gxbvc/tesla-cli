import http from "node:http";
import fs from "node:fs";
import {
  envPath,
  TESLA_AUTH_URL,
  TESLA_TOKEN_URL,
  TESLA_SCOPES,
  TESLA_CLIENT_ID,
  TESLA_CLIENT_SECRET,
  TESLA_REDIRECT_URI,
  TESLA_AUDIENCE,
  tokenCachePath,
  requireClientCreds,
} from "./config.js";

// The refresh token lives in .env only (TESLA_REFRESH_TOKEN). .token.json
// caches just the short-lived access token so a stale refresh token never
// gets written back after a newer one already replaced it (refresh tokens
// are single-use with a 24h grace window on the previous one).
function updateEnvVar(key: string, value: string): void {
  let content: string;
  try {
    content = fs.readFileSync(envPath, "utf-8");
  } catch {
    content = "";
  }
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content += (content === "" || content.endsWith("\n") ? "" : "\n") + line + "\n";
  }
  fs.writeFileSync(envPath, content);
}

interface TokenCache {
  access_token: string;
  expires_at: number;
}

function readTokenCache(): TokenCache | null {
  try {
    return JSON.parse(fs.readFileSync(tokenCachePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeTokenCache(cache: TokenCache): void {
  fs.writeFileSync(tokenCachePath, JSON.stringify(cache, null, 2));
}

async function postToken(params: Record<string, string>): Promise<any> {
  const res = await fetch(TESLA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

async function exchangeCodeForToken(code: string): Promise<void> {
  const json = await postToken({
    grant_type: "authorization_code",
    client_id: TESLA_CLIENT_ID,
    client_secret: TESLA_CLIENT_SECRET,
    code,
    audience: TESLA_AUDIENCE,
    redirect_uri: TESLA_REDIRECT_URI,
  });
  updateEnvVar("TESLA_REFRESH_TOKEN", json.refresh_token);
  writeTokenCache({
    access_token: json.access_token,
    expires_at: Date.now() + json.expires_in * 1000,
  });
}

export async function refreshAccessToken(): Promise<string> {
  requireClientCreds();
  const refreshToken = process.env.TESLA_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("TESLA_REFRESH_TOKEN is missing. Run: tesla-cli auth");
  }
  const json = await postToken({
    grant_type: "refresh_token",
    client_id: TESLA_CLIENT_ID,
    refresh_token: refreshToken,
  });
  updateEnvVar("TESLA_REFRESH_TOKEN", json.refresh_token);
  const cache: TokenCache = {
    access_token: json.access_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  writeTokenCache(cache);
  return cache.access_token;
}

export async function getAccessToken(): Promise<string> {
  const cache = readTokenCache();
  if (cache && cache.expires_at > Date.now() + 60_000) {
    return cache.access_token;
  }
  return refreshAccessToken();
}

// Separate client_credentials token, used only by `register`. Never mixed
// into vehicle calls, never persisted to .token.json.
export async function getPartnerToken(): Promise<string> {
  requireClientCreds();
  const json = await postToken({
    grant_type: "client_credentials",
    client_id: TESLA_CLIENT_ID,
    client_secret: TESLA_CLIENT_SECRET,
    audience: TESLA_AUDIENCE,
    scope: TESLA_SCOPES,
  });
  return json.access_token;
}

export async function runAuth(): Promise<void> {
  requireClientCreds();
  const state = Math.random().toString(36).slice(2);
  const authUrl = new URL(TESLA_AUTH_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", TESLA_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", TESLA_REDIRECT_URI);
  authUrl.searchParams.set("scope", TESLA_SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "login");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost:3456");
    if (url.pathname !== "/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code || returnedState !== state) {
      const error =
        url.searchParams.get("error_description") ||
        "No code received or state mismatch";
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h1>Error</h1><p>${error}</p>`);
      console.error("Error:", error);
      server.close();
      process.exit(1);
      return;
    }
    try {
      await exchangeCodeForToken(code);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<h1>tesla-cli authenticated</h1><p>Refresh token saved to .env. You can close this tab.</p>"
      );
      console.log("Refresh token saved to .env");
      server.close();
      process.exit(0);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h1>Error</h1><p>${err.message}</p>`);
      console.error("Token exchange error:", err.message);
      server.close();
      process.exit(1);
    }
  });

  server.listen(3456, () => {
    console.log("Opening browser for Tesla authorization...");
    console.log(`If browser doesn't open, visit: ${authUrl.toString()}`);
    import("open")
      .then((m) => m.default(authUrl.toString()))
      .catch(() => {
        console.log("Could not open browser automatically.");
      });
  });
}

// Allow running directly: npx tsx src/auth.ts
if (
  process.argv[1]?.endsWith("auth.ts") ||
  process.argv[1]?.endsWith("auth.js")
) {
  runAuth();
}
