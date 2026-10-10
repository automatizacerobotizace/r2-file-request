import { env } from "cloudflare:workers";
import { resetJwksCache } from "../src/access";
import { handleRequest } from "../src/app";
import { loadConfig } from "../src/config";
import type { Deps } from "../src/deps";
import type { AppEnv } from "../src/env";
import { MemoryMailer, type Mail } from "../src/mailer";
import type { MxResult } from "../src/mx";
import { base64url } from "../src/tokens";
import { DOH, SITEVERIFY, dohAnswer, fakeFetch } from "./fake-fetch";

export const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);

export class Clock {
  t = T0;
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

export async function resetState(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM transfers"),
    env.DB.prepare("DELETE FROM audit"),
    env.DB.prepare("DELETE FROM settings"),
  ]);
  const listed = await env.BUCKET.list();
  if (listed.objects.length) await env.BUCKET.delete(listed.objects.map((o) => o.key));
}

export function testDeps(o: { env?: Partial<AppEnv>; clock?: Clock; mailer?: MemoryMailer } = {}): Deps & {
  clock: Clock;
  mailer: MemoryMailer;
} {
  const e = { ...env, ...o.env } as AppEnv;
  const clock = o.clock ?? new Clock();
  const mailer = o.mailer ?? new MemoryMailer();
  return {
    env: e,
    cfg: loadConfig(e),
    mailer,
    clock,
    now: clock.now,
    fetch: (() => {
      throw new Error("network not allowed in this test");
    }) as unknown as typeof fetch,
  };
}

export const ORIGIN = "https://fileshare.example.com";

export interface TestCtx {
  env: AppEnv;
  clock: Clock;
  mailer: MemoryMailer;
  net: { mx: MxResult; turnstile: boolean };
  fetch: ReturnType<typeof fakeFetch>;
}

export async function setup(envOverrides: Partial<AppEnv> = {}): Promise<TestCtx> {
  resetJwksCache();
  await resetState();
  const net = { mx: "ok" as MxResult, turnstile: true };
  const f = fakeFetch({
    [DOH]: () =>
      net.mx === "ok" ? dohAnswer(0, [{ type: 15, data: "10 mx.example.org." }])
        : net.mx === "none" ? dohAnswer(3) : dohAnswer(2),
    [SITEVERIFY]: () => Response.json({ success: net.turnstile }),
    [JWKS_URL]: () => Response.json({ keys: [accessJwk] }),
  });
  return { env: { ...env, ...envOverrides } as AppEnv, clock: new Clock(), mailer: new MemoryMailer(), net, fetch: f };
}

export function call(
  c: TestCtx, method: string, path: string,
  o: { json?: unknown; headers?: Record<string, string>; body?: BodyInit } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  let body = o.body;
  if (o.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(o.json);
  }
  const req = new Request(ORIGIN + path, { method, headers, body, redirect: "manual" });
  return handleRequest(req, c.env, { mailer: c.mailer, fetch: c.fetch, now: c.clock.now });
}

// A POST whose JSON body the client holds back: the request starts at once, the body arrives after release().
export function heldCall(c: TestCtx, path: string, json: unknown): { response: Promise<Response>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      await gate;
      ctl.enqueue(new TextEncoder().encode(JSON.stringify(json)));
      ctl.close();
    },
  });
  const req = new Request(ORIGIN + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  return { response: handleRequest(req, c.env, { mailer: c.mailer, fetch: c.fetch, now: c.clock.now }), release };
}

// Lets a request that is already running reach the point where it waits for its body.
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

export function mailsTo(c: TestCtx, to: string): Mail[] {
  return c.mailer.sent.filter((m) => m.to === to);
}

export function tokenFrom(mail: Mail, kind: "u" | "d"): string {
  const m = mail.text.match(new RegExp(`/${kind}/([A-Za-z0-9_-]{43})`));
  if (!m) throw new Error("no token in mail");
  return m[1]!;
}

export async function requestUploadLink(c: TestCtx, email = "zakaznik@example.org"): Promise<{ token: string; id: string }> {
  const res = await call(c, "POST", "/api/request", { json: { email, turnstile: "x", lang: "cs" } });
  if (res.status !== 200) throw new Error(`request failed ${res.status}`);
  const mails = mailsTo(c, email);
  const token = tokenFrom(mails[mails.length - 1]!, "u");
  const row = await env.DB.prepare("SELECT id FROM transfers WHERE email = ? ORDER BY created_at DESC LIMIT 1").bind(email).first<{ id: string }>();
  return { token, id: row!.id };
}

export async function putObject(key: string, name: string, size: number): Promise<void> {
  await env.BUCKET.put(key, new Uint8Array(size), { customMetadata: { filename: encodeURIComponent(name) } });
}

export const JWKS_URL = "https://example.cloudflareaccess.com/cdn-cgi/access/certs";

const accessKeys = (await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const accessJwk = { ...((await crypto.subtle.exportKey("jwk", accessKeys.publicKey)) as JsonWebKey), kid: "k1", alg: "RS256", use: "sig" };

export async function signJwt(payload: Record<string, unknown>, o: { kid?: string; key?: CryptoKey } = {}): Promise<string> {
  const enc = (v: unknown) => base64url(new TextEncoder().encode(JSON.stringify(v)));
  const head = enc({ alg: "RS256", kid: o.kid ?? "k1", typ: "JWT" });
  const body = enc(payload);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", o.key ?? accessKeys.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${base64url(new Uint8Array(sig))}`;
}

export function adminClaims(c: TestCtx, over: Record<string, unknown> = {}): Record<string, unknown> {
  const s = Math.floor(c.clock.t / 1000);
  return { aud: ["YOUR_ACCESS_AUD"], iss: "https://example.cloudflareaccess.com", email: "admin@example.com", iat: s, exp: s + 3600, ...over };
}

export async function adminCall(
  c: TestCtx, method: string, path: string, body?: unknown,
  o: { origin?: string | null; jwt?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const jwt = o.jwt === undefined ? await signJwt(adminClaims(c)) : o.jwt;
  if (jwt) headers["Cf-Access-Jwt-Assertion"] = jwt;
  const origin = o.origin === undefined ? ORIGIN : o.origin;
  if (origin) headers["Origin"] = origin;
  const adminPath = c.env.ADMIN_PATH;
  return call(c, method, adminPath + path, { json: method === "POST" ? (body ?? {}) : undefined, headers });
}

export async function jwksBody(): Promise<{ keys: JsonWebKey[] }> {
  return { keys: [accessJwk] };
}

export async function createShare(
  c: TestCtx, o: { email?: string; name?: string; size?: number; days?: number } = {},
): Promise<{ id: string; token: string }> {
  const email = o.email ?? "prijemce@example.org";
  const name = o.name ?? "výkres.pdf";
  const size = o.size ?? 10;
  const d = await (await adminCall(c, "POST", "/api/out", { email, days: o.days ?? 7, lang: "cs", name, size })).json<{ id: string }>();
  await putObject(`out/${d.id}`, name, size);
  await adminCall(c, "POST", `/api/transfers/${d.id}/confirm`);
  const s = await adminCall(c, "POST", `/api/transfers/${d.id}/send`);
  if (s.status !== 200) throw new Error(`send failed ${s.status}`);
  const mails = mailsTo(c, email);
  return { id: d.id, token: tokenFrom(mails[mails.length - 1]!, "d") };
}
