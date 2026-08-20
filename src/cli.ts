import { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { ok, fail } from "./output.js";
import { runAuth, getPartnerToken } from "./auth.js";
import { apiFetch, resolveVin, withWake, commandBase } from "./api.js";
import { TESLA_DOMAIN, privateKeyPath, publicKeyPath } from "./config.js";

const program = new Command();
program
  .name("tesla-cli")
  .description("Personal Tesla Fleet API CLI")
  .version("0.1.0");

function run<T extends any[]>(fn: (...args: T) => Promise<void>) {
  return (...args: T) => {
    fn(...args).catch((err: any) => fail(err?.message ?? String(err)));
  };
}

program
  .command("auth")
  .description("Authorize via Tesla OAuth and save refresh token to .env")
  .action(run(async () => {
    await runAuth();
  }));

program
  .command("keys")
  .description("Generate EC key pair for Tesla vehicle command signing")
  .action(run(async () => {
    if (!existsSync(privateKeyPath)) {
      execSync(`openssl ecparam -genkey -name prime256v1 -noout -out "${privateKeyPath}"`);
    }
    if (!existsSync(publicKeyPath)) {
      execSync(`openssl ec -in "${privateKeyPath}" -pubout -out "${publicKeyPath}"`);
    }
    ok({
      publicKeyPath,
      url: `https://${TESLA_DOMAIN}/.well-known/appspecific/com.tesla.3p.public-key.pem`,
    });
  }));

program
  .command("register")
  .description("Register this app as a Tesla partner account")
  .action(run(async () => {
    const token = await getPartnerToken();
    const data = await apiFetch("POST", "/api/1/partner_accounts", {
      body: { domain: TESLA_DOMAIN },
      token,
    });
    ok(data);
  }));

program
  .command("vehicles")
  .description("List vehicles on this account")
  .action(run(async () => {
    const data = await apiFetch("GET", "/api/1/vehicles");
    ok(data);
  }));

program
  .command("status")
  .description("Get a status slice for a vehicle")
  .option("--vin <vin>", "vehicle VIN")
  .action(run(async (opts: { vin?: string }) => {
    const vin = await resolveVin(opts.vin);
    const data: any = await withWake(vin, () =>
      apiFetch("GET", `/api/1/vehicles/${vin}/vehicle_data`)
    );
    const v = data.response ?? {};
    ok({
      vin: v.vin,
      state: v.state,
      battery_level: v.charge_state?.battery_level,
      charging_state: v.charge_state?.charging_state,
      locked: v.vehicle_state?.locked,
      inside_temp: v.climate_state?.inside_temp,
      latitude: v.drive_state?.latitude,
      longitude: v.drive_state?.longitude,
      raw: v,
    });
  }));

program
  .command("wake")
  .description("Wake a vehicle")
  .option("--vin <vin>", "vehicle VIN")
  .action(run(async (opts: { vin?: string }) => {
    const vin = await resolveVin(opts.vin);
    await apiFetch("POST", `/api/1/vehicles/${vin}/wake_up`);
    const data = await apiFetch("GET", `/api/1/vehicles/${vin}`);
    ok(data);
  }));

function vehicleCommand(name: string, endpoint: string) {
  program
    .command(name)
    .option("--vin <vin>", "vehicle VIN")
    .action(run(async (opts: { vin?: string }) => {
      const vin = await resolveVin(opts.vin);
      const data = await withWake(vin, () =>
        apiFetch("POST", `/api/1/vehicles/${vin}/command/${endpoint}`, {
          base: commandBase(),
        })
      );
      ok(data);
    }));
}

vehicleCommand("lock", "door_lock");
vehicleCommand("unlock", "door_unlock");
vehicleCommand("honk", "honk_horn");

program
  .command("climate")
  .argument("<action>", "on or off")
  .option("--vin <vin>", "vehicle VIN")
  .action(run(async (action: string, opts: { vin?: string }) => {
    if (action !== "on" && action !== "off") {
      fail("climate action must be 'on' or 'off'");
    }
    const vin = await resolveVin(opts.vin);
    const endpoint = action === "on" ? "auto_conditioning_start" : "auto_conditioning_stop";
    const data = await withWake(vin, () =>
      apiFetch("POST", `/api/1/vehicles/${vin}/command/${endpoint}`, { base: commandBase() })
    );
    ok(data);
  }));

program
  .command("charge")
  .argument("<action>", "start or stop")
  .option("--vin <vin>", "vehicle VIN")
  .action(run(async (action: string, opts: { vin?: string }) => {
    if (action !== "start" && action !== "stop") {
      fail("charge action must be 'start' or 'stop'");
    }
    const vin = await resolveVin(opts.vin);
    const endpoint = action === "start" ? "charge_start" : "charge_stop";
    const data = await withWake(vin, () =>
      apiFetch("POST", `/api/1/vehicles/${vin}/command/${endpoint}`, { base: commandBase() })
    );
    ok(data);
  }));

program.parse();
