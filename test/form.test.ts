import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../src/db";
import { adminCall, call, heldCall, mailsTo, settle, setup, tokenFrom } from "./helpers";

const email = "zakaznik@example.org";
const admin = "admin@example.com";
const post = (c: Awaited<ReturnType<typeof setup>>, body: unknown) => call(c, "POST", "/api/request", { json: body });

describe("request form", () => {
  it("GET / renders the form with Turnstile and the privacy notice", async () => {
    const c = await setup();
    const res = await call(c, "GET", "/");
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('class="cf-turnstile"');
    expect(body).toContain("/static/form.js");
    expect(body).toContain("We process your e-mail address");
    expect(res.headers.get("content-security-policy")).toContain("https://challenges.cloudflare.com");
  });

  it("valid request: transfer open for 7 days, E1 with link to customer, E2 to admin", async () => {
    const c = await setup();
    const res = await post(c, { email: " Zakaznik@Example.org ", turnstile: "x", lang: "cs" });
    expect(await res.json()).toEqual({ ok: true });
    const [e1] = mailsTo(c, email);
    expect(e1?.subject).toContain("Odkaz pro odeslání souboru");
    const token = tokenFrom(e1!, "u");
    const row = await env.DB.prepare("SELECT * FROM transfers").first<Record<string, unknown>>();
    expect(row).toMatchObject({ direction: "in", status: "open", origin: "form", lang: "cs", email, link_version: 1, expires_at: c.clock.t + 7 * DAY_MS });
    expect(row?.token_hash).not.toBe(token);
    expect(mailsTo(c, admin)).toHaveLength(1);
  });

  it("failed Turnstile: 400 turnstile_failed, nothing created", async () => {
    const c = await setup();
    c.net.turnstile = false;
    const res = await post(c, { email, turnstile: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "turnstile_failed" });
    expect(c.mailer.sent).toHaveLength(0);
  });

  it("invalid address or domain without MX: same neutral answer, no e-mail", async () => {
    const c = await setup();
    expect(await (await post(c, { email: "not-an-address", turnstile: "x" })).json()).toEqual({ ok: true });
    c.net.mx = "none";
    expect(await (await post(c, { email, turnstile: "x" })).json()).toEqual({ ok: true });
    expect(c.mailer.sent).toHaveLength(0);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM transfers").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("DNS error: try_later, audit dns_error, E6 to admin", async () => {
    const c = await setup();
    c.net.mx = "error";
    const res = await post(c, { email, turnstile: "x" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "try_later" });
    const a = await env.DB.prepare("SELECT detail FROM audit WHERE action = 'dns_error'").first<{ detail: string }>();
    expect(a?.detail).toBe("example.org");
    expect(mailsTo(c, admin)[0]?.subject).toContain("DNS");
  });

  it("fourth request from one e-mail in 24 h: neutral, no e-mail", async () => {
    const c = await setup();
    for (let i = 0; i < 3; i++) await post(c, { email, turnstile: "x" });
    const before = c.mailer.sent.length;
    expect(await (await post(c, { email, turnstile: "x" })).json()).toEqual({ ok: true });
    expect(c.mailer.sent.length).toBe(before);
  });

  it("E1 failure: transfer stays, try_later, audit, E6", async () => {
    const c = await setup();
    c.mailer.failures = 1;
    const res = await post(c, { email, turnstile: "x" });
    expect(await res.json()).toEqual({ error: "try_later" });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM transfers WHERE status = 'open'").first<{ n: number }>();
    expect(n?.n).toBe(1);
    expect(mailsTo(c, admin)[0]?.subject).toContain("e1_failed");
  });

  it("21st form request in 24 h switches to maintenance and sends E6", async () => {
    const c = await setup();
    for (let i = 0; i < 20; i++) await post(c, { email: `u${i}@example.org`, turnstile: "x" });
    const res = await post(c, { email: "late@example.org", turnstile: "x" });
    expect(await res.json()).toEqual({ error: "maintenance" });
    expect((await call(c, "GET", "/")).status).toBe(503);
    expect(mailsTo(c, admin).some((m) => m.subject.includes("maintenance"))).toBe(true);
  });

  it("unknown paths are 404", async () => {
    const c = await setup();
    expect((await call(c, "GET", "/nope")).status).toBe(404);
    expect(await (await call(c, "GET", "/api/nope")).json()).toEqual({ error: "not_found" });
  });

  it("creates no transfer when maintenance is switched on before the body arrives", async () => {
    const c = await setup();
    const held = heldCall(c, "/api/request", { email, turnstile: "x", lang: "cs" });
    await settle();
    await adminCall(c, "POST", "/api/maintenance", { on: true });
    held.release();
    const res = await held.response;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "maintenance" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM transfers").first<{ n: number }>())!.n).toBe(0);
    expect(mailsTo(c, email)).toHaveLength(0);
  });
});
