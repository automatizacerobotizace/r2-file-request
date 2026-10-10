import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS, addAudit } from "../src/db";
import { adminCall, call, createShare, mailsTo, setup, tokenFrom } from "./helpers";

const admin = "admin@example.com";
const to = "prijemce@example.org";
type Ctx = Awaited<ReturnType<typeof setup>>;
const dl = (c: Ctx, token: string) => call(c, "POST", `/d/${token}/download`, { body: "", headers: { "content-type": "application/x-www-form-urlencoded" } });

describe("download page", () => {
  it("shows name, size, validity, malware notice and a POST form; S3 in form-action", async () => {
    const c = await setup();
    const { token } = await createShare(c, { name: "výkres.pdf", size: 1_500_000 });
    const res = await call(c, "GET", `/d/${token}`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("výkres.pdf");
    expect(body).toContain("1,5 MB");
    expect(body).toContain("Soubory nejsou kontrolovány na přítomnost malwaru");
    expect(body).toContain(`action="/d/${token}/download"`);
    expect(res.headers.get("content-security-policy")).toContain("form-action 'self' https://ACCOUNT_ID.eu.r2.cloudflarestorage.com");
  });

  it("expired or deleted share: 410", async () => {
    const c = await setup();
    const { token } = await createShare(c, { days: 1 });
    c.clock.advance(DAY_MS);
    expect((await call(c, "GET", `/d/${token}`)).status).toBe(410);
    const s2 = await createShare(c);
    await adminCall(c, "POST", `/api/transfers/${s2.id}/delete`);
    expect((await call(c, "GET", `/d/${s2.token}`)).status).toBe(410);
    expect((await dl(c, s2.token)).status).toBe(410);
  });
});

describe("download", () => {
  it("303 to a presigned GET with attachment; first click sends E5 once", async () => {
    const c = await setup();
    const { id, token } = await createShare(c, { name: "a b.pdf" });
    const before = mailsTo(c, admin).length;
    const r = await dl(c, token);
    expect(r.status).toBe(303);
    const u = new URL(r.headers.get("location")!);
    expect(u.pathname).toBe(`/r2-file-request/out/${id}`);
    expect(u.searchParams.get("response-content-disposition")).toBe("attachment; filename*=UTF-8''a%20b.pdf");
    expect(u.searchParams.get("response-content-type")).toBe("application/octet-stream");
    expect(r.headers.get("cache-control")).toBe("no-store");
    await dl(c, token);
    const e5 = mailsTo(c, admin).slice(before);
    expect(e5).toHaveLength(1);
    expect(e5[0]!.text).toContain(to);
    const t = await env.DB.prepare("SELECT first_download_at FROM transfers WHERE id = ?").bind(id).first<{ first_download_at: number }>();
    expect(t?.first_download_at).toBe(c.clock.t);
  });

  it("E5 can be switched off", async () => {
    const c = await setup({ NOTIFY_FIRST_DOWNLOAD: "false" });
    const { token } = await createShare(c);
    const before = mailsTo(c, admin).length;
    await dl(c, token);
    expect(mailsTo(c, admin).length).toBe(before);
  });

  it("sixth click is refused; admin downloads do not count; Send again restores 5 with frozen clock", async () => {
    const c = await setup();
    const { id, token } = await createShare(c);
    for (let i = 0; i < 3; i++) await adminCall(c, "POST", `/api/transfers/${id}/download`);
    for (let i = 0; i < 5; i++) expect((await dl(c, token)).status).toBe(303);
    const sixth = await dl(c, token);
    expect(sixth.status).toBe(429);
    expect(await sixth.text()).toContain("Limit stažení je vyčerpán");
    await adminCall(c, "POST", `/api/transfers/${id}/resend`, { linkVersion: 1 });
    const fresh = tokenFrom(mailsTo(c, to)[1]!, "d");
    for (let i = 0; i < 5; i++) expect((await dl(c, fresh)).status).toBe(303);
    expect((await dl(c, fresh)).status).toBe(429);
    const list = await (await adminCall(c, "GET", "/api/transfers?direction=out")).json<{ transfers: { downloads: number }[] }>();
    expect(list.transfers[0]?.downloads).toBe(10);
  });

  it("21st customer download in 24 h switches to maintenance with E6", async () => {
    const c = await setup();
    const { token } = await createShare(c);
    for (let i = 0; i < 20; i++) {
      await addAudit(env.DB, { ts: c.clock.t, actor: "customer", action: "download_url", transferId: "other", linkVersion: 1 });
    }
    const r = await dl(c, token);
    expect(r.status).toBe(503);
    expect(mailsTo(c, admin).some((m) => m.subject.includes("maintenance"))).toBe(true);
    expect((await call(c, "GET", `/d/${token}`)).status).toBe(503);
  });
});
