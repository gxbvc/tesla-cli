export function ok(data: unknown): void {
  console.log(JSON.stringify({ ok: true, data }));
}

export function fail(error: string, code?: string): never {
  console.error(JSON.stringify({ ok: false, error, ...(code && { code }) }));
  process.exit(1);
}
