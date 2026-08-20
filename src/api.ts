import { TESLA_AUDIENCE, TESLA_PROXY_URL } from "./config.js";
import { getAccessToken, refreshAccessToken } from "./auth.js";

interface ApiOptions {
  body?: unknown;
  token?: string;
  base?: string;
}

export function commandBase(): string {
  return TESLA_PROXY_URL || TESLA_AUDIENCE;
}

export async function apiFetch(
  method: string,
  path: string,
  opts: ApiOptions = {}
): Promise<any> {
  const base = opts.base ?? TESLA_AUDIENCE;
  const explicitToken = opts.token;
  const token = explicitToken ?? (await getAccessToken());

  const doFetch = (tok: string) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  let res = await doFetch(token);
  if (res.status === 401 && !explicitToken) {
    const newToken = await refreshAccessToken();
    res = await doFetch(newToken);
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(JSON.stringify(json));
  }
  return json;
}

export async function resolveVin(vinArg?: string): Promise<string> {
  if (vinArg) return vinArg;
  const data = (await apiFetch("GET", "/api/1/vehicles")) as {
    response?: Array<{ vin: string }>;
  };
  const vehicles = data.response ?? [];
  if (vehicles.length === 0) {
    throw new Error("No vehicles found on this account.");
  }
  if (vehicles.length > 1) {
    throw new Error(`Multiple vehicles found (${vehicles.length}). Pass --vin.`);
  }
  return vehicles[0].vin;
}

async function wakeVehicle(vin: string): Promise<void> {
  await apiFetch("POST", `/api/1/vehicles/${vin}/wake_up`);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const data = (await apiFetch("GET", `/api/1/vehicles/${vin}`)) as {
      response?: { state?: string };
    };
    if (data.response?.state === "online") return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Not used for the `vehicles` list command; only status/commands wake.
export async function withWake<T>(vin: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/asleep|offline|vehicle unavailable|408/i.test(msg)) {
      await wakeVehicle(vin);
      return await fn();
    }
    throw err;
  }
}
