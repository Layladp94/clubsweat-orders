// Central place for environment variables so a missing one fails loudly.

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing environment variable ${name}`);
  }
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.length > 0 ? v : undefined;
}

export const rands = (cents: number): string =>
  `R${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
