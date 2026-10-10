import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS, addAudit } from "../src/db";
import { adminCall, call, heldCall, mailsTo, putObject, requestUploadLink, settle, setup, tokenFrom } from "./helpers";

const admin = "admin@example.com";
type Ctx = Awaited<ReturnType<typeof setup>>;
const start = (c: Ctx, token: string, body: unknown) => call(c, "POST", `/api/u/${token}/start`, { json: body });
const confirm = (c: Ctx, token: string) => call(c, "POST", `/api/u/${token}/confirm`, { json: {} });

describe("upload page", () => {
  it("renders for an open link with S3 in connect-src", async () => {
    const c = await setup();
    const { token } = await requestUploadLink(c);
    const res = await call(c, "GET", `/u/${token}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("/static/upload.js");
    expect(body).toContain("Pošlete jeden soubor (max. 3 GB)");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'self' https://ACCOUNT_ID.eu.r2.cloudflarestorage.com");
  });

  it("unknown, malformed or expired link: 410 page", async () => {
    const c = await setup();
    expect((await call(c, "GET", "/u/abc")).status).toBe(410);
    expect((await call(c, "GET", `/u/${"A".repeat(43)}`)).status).toBe(410);
    const { token } = await requestUploadLink(c);
    c.clock.advance(7 * DAY_MS);
    expect((await call(c, "GET", `/u/${token}`)).status).toBe(410);
  });
});

describe("start", () => {
  it("returns a 120 s presigned PUT for in/<id> with signed size, if-none-match and file name", async () => {
    const c = await setup();
    const { token, id } = await requestUploadLink(c);
    const res = await start(c, token, { name: "Návrh č. 1.zip", size: 1234 });
    expect(res.status).toBe(200);
    const body = await res.json<{ url: string; headers: Record<string, string> }>();
    const url = new URL(body.url);
    expect(url.origin).toBe("https://account_id.eu.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/r2-file-request/in/${id}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host;if-none-match;x-amz-meta-filename");
    expect(body.headers).toEqual({ "If-None-Match": "*", "x-amz-meta-filename": encodeURIComponent("Návrh č. 1.zip") });
    const a = await env.DB.prepare("SELECT * FROM audit WHERE action = 'upload_url'").first<{ actor: string; transfer_id: string }>();
    expect(a).toMatchObject({ actor: "customer", transfer_id: id });
  });

  it("URL validity is capped by the link expiry", async () => {
    const c = await setup();
    const { token } = await requestUploadLink(c);
    c.clock.advance(7 * DAY_MS - 30_000);
    const body = await (await start(c, token, { name: "a", size: 1 })).json<{ url: string }>();
    expect(new URL(body.url).searchParams.get("X-Amz-Expires")).toBe("30");
  });

  it("rejects files over 3 GB and bad input", async () => {
    const c = await setup();
    const { token } = await requestUploadLink(c);
    expect(await (await start(c, token, { name: "a", size: 3_000_000_001 })).json()).toEqual({ error: "too_large" });
    expect((await start(c, token, { name: "", size: 1 })).status).toBe(400);
    expect((await start(c, token, { size: 1 })).status).toBe(400);
    expect((await call(c, "POST", `/api/u/${token}/start`, { body: "x" })).status).toBe(400);
  });

  it("keeps the file name on one line", async () => {
    const c = await setup();
    const { token } = await requestUploadLink(c);
    const signedName = async (name: string) =>
      (await (await start(c, token, { name, size: 1 })).json<{ headers: Record<string, string> }>()).headers["x-amz-meta-filename"];
    expect(await signedName("a.zip\r\nAdministrace: https://example.net/\u2028b\u202efdp.exe")).toBe(
      encodeURIComponent("a.zip  Administrace: https://example.net/ b fdp.exe"),
    );
    expect(await signedName("rodina \u{1F468}\u200d\u{1F469}\u200d\u{1F467}.zip")).toBe(
      encodeURIComponent("rodina \u{1F468}\u200d\u{1F469}\u200d\u{1F467}.zip"),
    );
    expect((await start(c, token, { name: "\u202e\u0007", size: 1 })).status).toBe(400);
  });

  it("21st upload start in 24 h switches to maintenance with E6", async () => {
    const c = await setup();
    const { token } = await requestUploadLink(c);
    for (let i = 0; i < 20; i++) await addAudit(env.DB, { ts: c.clock.t, actor: "customer", action: "upload_url" });
    expect(await (await start(c, token, { name: "a", size: 1 })).json()).toEqual({ error: "maintenance" });
    expect(mailsTo(c, admin).some((m) => m.subject.includes("maintenance"))).toBe(true);
    expect(await (await start(c, token, { name: "a", size: 1 })).json()).toEqual({ error: "maintenance" });
  });
});

describe("start with a held-back body", () => {
  const uploadUrls = async () =>
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'upload_url'").first<{ n: number }>())!.n;

  it("issues no URL when the transfer is deleted before the body arrives", async () => {
    const c = await setup();
    const { token, id } = await requestUploadLink(c);
    const held = heldCall(c, `/api/u/${token}/start`, { name: "a.zip", size: 1 });
    await settle();
    await adminCall(c, "POST", `/api/transfers/${id}/delete`);
    held.release();
    const res = await held.response;
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "link_invalid" });
    expect(await uploadUrls()).toBe(0);
  });

  it("issues no URL for the old link when the link is sent again before the body arrives", async () => {
    const c = await setup();
    const to = "zakaznik@example.org";
    const { id } = await (await adminCall(c, "POST", "/api/in", { email: to })).json<{ id: string }>();
    const token = tokenFrom(mailsTo(c, to)[0]!, "u");
    const held = heldCall(c, `/api/u/${token}/start`, { name: "a.zip", size: 1 });
    await settle();
    expect((await adminCall(c, "POST", `/api/transfers/${id}/resend`, { linkVersion: 1 })).status).toBe(200);
    held.release();
    const res = await held.response;
    expect(res.status).toBe(410);
    expect(await uploadUrls()).toBe(0);
  });

  it("issues no URL when maintenance is switched on before the body arrives", async () => {
    const c = await setup();
    const { token } = await requestUploadLink(c);
    const held = heldCall(c, `/api/u/${token}/start`, { name: "a.zip", size: 1 });
    await settle();
    await adminCall(c, "POST", "/api/maintenance", { on: true });
    held.release();
    const res = await held.response;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "maintenance" });
    expect(await uploadUrls()).toBe(0);
  });
});

describe("confirm", () => {
  it("missing object: upload_failed, can retry", async () => {
    const c = await setup();
    const { token } = await requestUploadLink(c);
    const res = await confirm(c, token);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "upload_failed" });
  });

  it("takes name and size from the stored object, sends E3 once, closes the link", async () => {
    const c = await setup();
    const { token, id } = await requestUploadLink(c);
    await start(c, token, { name: "claimed.zip", size: 5 });
    await putObject(`in/${id}`, "Výkres ř.zip", 5);
    const before = mailsTo(c, admin).length;
    const [r1, r2] = await Promise.all([confirm(c, token), confirm(c, token)]);
    expect(await r1.json()).toEqual({ ok: true, fileName: "Výkres ř.zip" });
    expect(await r2.json()).toEqual({ ok: true, fileName: "Výkres ř.zip" });
    expect(await (await confirm(c, token)).json()).toEqual({ ok: true, fileName: "Výkres ř.zip" });
    const e3 = mailsTo(c, admin).slice(before);
    expect(e3).toHaveLength(1);
    expect(e3[0]!.text).toContain("Výkres ř.zip");
    const t = await env.DB.prepare("SELECT * FROM transfers WHERE id = ?").bind(id).first<Record<string, unknown>>();
    expect(t).toMatchObject({ status: "received", file_name: "Výkres ř.zip", file_size: 5, uploaded_at: c.clock.t });
    expect(await (await start(c, token, { name: "b", size: 1 })).json()).toEqual({ error: "link_invalid" });
    const page = await call(c, "GET", `/u/${token}`);
    expect(await page.text()).toContain("Soubor už byl přijat.");
  });

  it("link expired during upload: confirm rejected", async () => {
    const c = await setup();
    const { token, id } = await requestUploadLink(c);
    await putObject(`in/${id}`, "a.zip", 1);
    c.clock.advance(7 * DAY_MS);
    expect(await (await confirm(c, token)).json()).toEqual({ error: "link_invalid" });
  });
});
