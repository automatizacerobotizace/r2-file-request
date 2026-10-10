import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { DAY_MS, HOUR_MS, addAudit } from "../src/db";
import { adminCall, call, createShare, mailsTo, putObject, setup, tokenFrom } from "./helpers";

const to = "prijemce@example.org";

describe("outgoing share", () => {
  it("draft gets a presigned PUT for out/<id> without customer limits", async () => {
    const c = await setup();
    for (let i = 0; i < 20; i++) await addAudit(env.DB, { ts: c.clock.t, actor: "customer", action: "upload_url" });
    const res = await adminCall(c, "POST", "/api/out", { email: to, days: 2, lang: "cs", name: "a.pdf", size: 10 });
    const body = await res.json<{ id: string; url: string }>();
    expect(res.status).toBe(200);
    expect(new URL(body.url).pathname).toBe(`/r2-file-request/out/${body.id}`);
    expect(await env.DB.prepare("SELECT status, token_hash, link_version FROM transfers").first()).toEqual({ status: "draft", token_hash: null, link_version: 0 });
  });

  it("keeps the file name of a draft on one line", async () => {
    const c = await setup();
    const res = await adminCall(c, "POST", "/api/out", { email: to, name: "a\nb.pdf", size: 10 });
    expect(res.status).toBe(200);
    const body = await res.json<{ headers: Record<string, string> }>();
    expect(body.headers["x-amz-meta-filename"]).toBe(encodeURIComponent("a b.pdf"));
  });

  it("rejects too large files and bad input", async () => {
    const c = await setup();
    expect((await adminCall(c, "POST", "/api/out", { email: to, name: "a", size: 3_000_000_001 })).status).toBe(413);
    expect((await adminCall(c, "POST", "/api/out", { email: to, size: 1 })).status).toBe(400);
  });

  it("Send before the file is confirmed is refused without e-mail", async () => {
    const c = await setup();
    const { id } = await (await adminCall(c, "POST", "/api/out", { email: to, name: "a.pdf", size: 10 })).json<{ id: string }>();
    const r = await adminCall(c, "POST", `/api/transfers/${id}/send`);
    expect(r.status).toBe(409);
    expect(await adminCall(c, "POST", `/api/transfers/${id}/confirm`).then((x) => x.json())).toEqual({ error: "upload_failed" });
    expect(mailsTo(c, to)).toHaveLength(0);
  });

  it("two concurrent Sends with frozen clock: one E4", async () => {
    const c = await setup();
    const { id } = await (await adminCall(c, "POST", "/api/out", { email: to, days: 3, name: "a.pdf", size: 10 })).json<{ id: string }>();
    await putObject(`out/${id}`, "a.pdf", 10);
    expect(await (await adminCall(c, "POST", `/api/transfers/${id}/confirm`)).json()).toEqual({ ok: true });
    const [a, b] = await Promise.all([
      adminCall(c, "POST", `/api/transfers/${id}/send`),
      adminCall(c, "POST", `/api/transfers/${id}/send`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(mailsTo(c, to)).toHaveLength(1);
    const t = await env.DB.prepare("SELECT * FROM transfers WHERE id = ?").bind(id).first<Record<string, unknown>>();
    expect(t).toMatchObject({ status: "active", link_version: 1, sent_at: c.clock.t, expires_at: c.clock.t + 3 * DAY_MS });
  });

  it("E4 failure: 502, transfer active, Send again delivers a working link", async () => {
    const c = await setup();
    const { id } = await (await adminCall(c, "POST", "/api/out", { email: to, name: "a.pdf", size: 10 })).json<{ id: string }>();
    await putObject(`out/${id}`, "a.pdf", 10);
    await adminCall(c, "POST", `/api/transfers/${id}/confirm`);
    c.mailer.failures = 1;
    expect((await adminCall(c, "POST", `/api/transfers/${id}/send`)).status).toBe(502);
    const r = await adminCall(c, "POST", `/api/transfers/${id}/resend`, { linkVersion: 1 });
    expect(await r.json()).toMatchObject({ ok: true, linkVersion: 2 });
    expect((await call(c, "GET", `/d/${tokenFrom(mailsTo(c, to)[0]!, "d")}`)).status).toBe(200);
  });

  it("Send again with frozen clock: old link dies, new link works", async () => {
    const c = await setup();
    const { id, token } = await createShare(c);
    const [a, b] = await Promise.all([
      adminCall(c, "POST", `/api/transfers/${id}/resend`, { linkVersion: 1 }),
      adminCall(c, "POST", `/api/transfers/${id}/resend`, { linkVersion: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(mailsTo(c, to)).toHaveLength(2);
    expect((await call(c, "GET", `/d/${token}`)).status).toBe(410);
  });

  it("draft past its deadline cannot be confirmed or sent before cleanup runs", async () => {
    const c = await setup();
    const { id } = await (await adminCall(c, "POST", "/api/out", { email: to, name: "a.pdf", size: 10 })).json<{ id: string }>();
    await putObject(`out/${id}`, "a.pdf", 10);
    c.clock.advance(loadConfig(c.env).draftHours * HOUR_MS + 1);
    const confirm = await adminCall(c, "POST", `/api/transfers/${id}/confirm`);
    expect(confirm.status).toBe(410);
    expect(await confirm.json()).toEqual({ error: "link_invalid" });
    const send = await adminCall(c, "POST", `/api/transfers/${id}/send`);
    expect(send.status).toBe(409);
    expect(await send.json()).toMatchObject({ error: "conflict", transfer: { status: "draft" } });
    expect(await env.DB.prepare("SELECT status, uploaded_at, token_hash FROM transfers WHERE id = ?").bind(id).first())
      .toEqual({ status: "draft", uploaded_at: null, token_hash: null });
    expect(mailsTo(c, to)).toHaveLength(0);
  });

  it("draft confirmed in time but sent after the deadline is refused", async () => {
    const c = await setup();
    const { id } = await (await adminCall(c, "POST", "/api/out", { email: to, name: "a.pdf", size: 10 })).json<{ id: string }>();
    await putObject(`out/${id}`, "a.pdf", 10);
    expect(await (await adminCall(c, "POST", `/api/transfers/${id}/confirm`)).json()).toEqual({ ok: true });
    c.clock.advance(loadConfig(c.env).draftHours * HOUR_MS + 1);
    const send = await adminCall(c, "POST", `/api/transfers/${id}/send`);
    expect(send.status).toBe(409);
    expect(await send.json()).toMatchObject({ error: "conflict", transfer: { status: "draft" } });
    expect(await env.DB.prepare("SELECT status, token_hash FROM transfers WHERE id = ?").bind(id).first())
      .toEqual({ status: "draft", token_hash: null });
    expect(mailsTo(c, to)).toHaveLength(0);
  });
});
