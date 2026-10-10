import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../src/db";
import { adminCall, call, mailsTo, putObject, setup, tokenFrom } from "./helpers";

const cust = "zakaznik@example.org";

describe("admin incoming requests", () => {
  it("creates a request with chosen validity and language, sends E1", async () => {
    const c = await setup();
    const res = await adminCall(c, "POST", "/api/in", { email: cust, days: 3, lang: "en" });
    const body = await res.json<{ ok: boolean; id: string; linkVersion: number }>();
    expect(body).toMatchObject({ ok: true, linkVersion: 1 });
    const [e1] = mailsTo(c, cust);
    expect(e1?.subject).toBe("Link to send a file – Example");
    const t = await env.DB.prepare("SELECT * FROM transfers WHERE id = ?").bind(body.id).first<Record<string, unknown>>();
    expect(t).toMatchObject({ origin: "admin", status: "open", expires_at: c.clock.t + 3 * DAY_MS, lang: "en" });
    const a = await env.DB.prepare("SELECT actor FROM audit WHERE action = 'request_created'").first<{ actor: string }>();
    expect(a?.actor).toBe("admin:admin@example.com");
    expect((await call(c, "GET", `/u/${tokenFrom(e1!, "u")}`)).status).toBe(200);
  });

  it("validates input", async () => {
    const c = await setup();
    for (const b of [{ email: "x" }, { email: cust, days: 0 }, { email: cust, days: 8 }, { email: cust, days: "3" }]) {
      expect((await adminCall(c, "POST", "/api/in", b)).status).toBe(400);
    }
  });

  it("E1 failure: 502 mail_failed, then Send again issues a new link", async () => {
    const c = await setup();
    c.mailer.failures = 1;
    const r1 = await adminCall(c, "POST", "/api/in", { email: cust });
    expect(r1.status).toBe(502);
    const { id, linkVersion } = await r1.json<{ id: string; linkVersion: number }>();
    const r2 = await adminCall(c, "POST", `/api/transfers/${id}/resend`, { linkVersion });
    expect(await r2.json()).toMatchObject({ ok: true, linkVersion: 2 });
    expect(mailsTo(c, cust)).toHaveLength(1);
  });

  it("Send again invalidates the previous link; concurrent resends with same version send one e-mail", async () => {
    const c = await setup();
    const { id } = await (await adminCall(c, "POST", "/api/in", { email: cust })).json<{ id: string }>();
    const oldToken = tokenFrom(mailsTo(c, cust)[0]!, "u");
    const [a, b] = await Promise.all([
      adminCall(c, "POST", `/api/transfers/${id}/resend`, { linkVersion: 1 }),
      adminCall(c, "POST", `/api/transfers/${id}/resend`, { linkVersion: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(mailsTo(c, cust)).toHaveLength(2);
    expect((await call(c, "GET", `/u/${oldToken}`)).status).toBe(410);
    expect((await call(c, "GET", `/u/${tokenFrom(mailsTo(c, cust)[1]!, "u")}`)).status).toBe(200);
  });

  it("Send again is refused for requests from the public form", async () => {
    const c = await setup();
    await call(c, "POST", "/api/request", { json: { email: cust, turnstile: "x" } });
    const row = await env.DB.prepare("SELECT id FROM transfers").first<{ id: string }>();
    expect((await adminCall(c, "POST", `/api/transfers/${row!.id}/resend`, { linkVersion: 1 })).status).toBe(409);
  });

  it("delete removes the object at once and is repeatable", async () => {
    const c = await setup();
    const { id } = await (await adminCall(c, "POST", "/api/in", { email: cust })).json<{ id: string }>();
    await putObject(`in/${id}`, "a.zip", 3);
    expect(await (await adminCall(c, "POST", `/api/transfers/${id}/delete`)).json()).toEqual({ ok: true, status: "deleted" });
    expect(await env.BUCKET.head(`in/${id}`)).toBeNull();
    const t = await env.DB.prepare("SELECT purged_at, ended_at FROM transfers WHERE id = ?").bind(id).first<{ purged_at: number | null; ended_at: number }>();
    expect(t).toEqual({ purged_at: null, ended_at: c.clock.t });
    expect(await (await adminCall(c, "POST", `/api/transfers/${id}/delete`)).json()).toEqual({ ok: true, status: "deleted" });
  });

  it("admin download of a received file: presigned GET, not counted for customers", async () => {
    const c = await setup();
    const { id } = await (await adminCall(c, "POST", "/api/in", { email: cust })).json<{ id: string }>();
    const token = tokenFrom(mailsTo(c, cust)[0]!, "u");
    await putObject(`in/${id}`, "a b.zip", 3);
    await call(c, "POST", `/api/u/${token}/confirm`, { json: {} });
    for (let i = 0; i < 3; i++) {
      const { url } = await (await adminCall(c, "POST", `/api/transfers/${id}/download`)).json<{ url: string }>();
      const u = new URL(url);
      expect(u.pathname).toBe(`/r2-file-request/in/${id}`);
      expect(u.searchParams.get("response-content-disposition")).toBe("attachment; filename*=UTF-8''a%20b.zip");
      expect(u.searchParams.get("X-Amz-Expires")).toBe("120");
    }
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'download_url'").first<{ n: number }>();
    expect(n?.n).toBe(0);
    const list = await (await adminCall(c, "GET", "/api/transfers?direction=in")).json<{ transfers: Record<string, unknown>[] }>();
    expect(list.transfers[0]).toMatchObject({ id, status: "received", file_name: "a b.zip" });
    expect(list.transfers[0]).not.toHaveProperty("token_hash");
  });
});
