import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, addAudit } from "../src/db";
import { consumeDownload, consumeUpload, createFormTransfer } from "../src/limits";
import { T0, resetState, testDeps } from "./helpers";

const db = env.DB;
const { cfg } = testDeps();
beforeEach(resetState);

async function seed(action: string, n: number, ts: number, extra: { transferId?: string; linkVersion?: number } = {}) {
  for (let i = 0; i < n; i++) await addAudit(db, { ts, actor: "customer", action, ...extra });
}

describe("upload limit (20 per 24 h)", () => {
  it("ten concurrent requests with one slot left: exactly one passes", async () => {
    await seed("upload_url", 19, T0);
    const r = await Promise.all(Array.from({ length: 10 }, () => consumeUpload(db, cfg, "t", 1, T0 + 1000)));
    expect(r.filter((x) => x === "ok")).toHaveLength(1);
    expect(r.filter((x) => x === "global")).toHaveLength(9);
  });

  it("rejections are logged separately and do not delay the window", async () => {
    await seed("upload_url", 20, T0);
    expect(await consumeUpload(db, cfg, "t", 1, T0 + 3_600_000)).toBe("global");
    const rej = await db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'limit_rejected'").first<{ n: number }>();
    expect(rej?.n).toBe(1);
    expect(await consumeUpload(db, cfg, "t", 1, T0 + DAY_MS + 1)).toBe("ok");
  });

  it("admin events do not count", async () => {
    for (let i = 0; i < 25; i++) await addAudit(db, { ts: T0, actor: "admin:a@example.com", action: "upload_url" });
    expect(await consumeUpload(db, cfg, "t", 1, T0 + 1)).toBe("ok");
  });
});

describe("download limit (20 per 24 h, 5 per link version)", () => {
  it("sixth download of one link version is local, a new version starts again", async () => {
    for (let i = 0; i < 5; i++) expect(await consumeDownload(db, cfg, "x", 1, T0)).toBe("ok");
    expect(await consumeDownload(db, cfg, "x", 1, T0)).toBe("local");
    expect(await consumeDownload(db, cfg, "x", 2, T0)).toBe("ok"); // same timestamp, new version
  });

  it("global limit wins and is reported as global", async () => {
    await seed("download_url", 20, T0, { transferId: "other", linkVersion: 1 });
    expect(await consumeDownload(db, cfg, "x", 1, T0 + 1)).toBe("global");
  });

  it("concurrent downloads with one slot left on the link: exactly one passes", async () => {
    await seed("download_url", 4, T0, { transferId: "x", linkVersion: 1 });
    const r = await Promise.all(Array.from({ length: 10 }, () => consumeDownload(db, cfg, "x", 1, T0 + 1)));
    expect(r.filter((x) => x === "ok")).toHaveLength(1);
  });
});

describe("form limit (3 per e-mail, 20 total)", () => {
  const base = { tokenHash: "", lang: "cs" as const };
  it("fourth request from the same e-mail is local", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await createFormTransfer(db, cfg, { ...base, id: `a${i}`, tokenHash: `h${i}`, email: "c@example.org", now: T0 })).toBe("ok");
    }
    expect(await createFormTransfer(db, cfg, { ...base, id: "a3", tokenHash: "h3", email: "c@example.org", now: T0 })).toBe("local");
    const t = await db.prepare("SELECT * FROM transfers WHERE id = 'a0'").first<{ status: string; link_version: number; expires_at: number }>();
    expect(t).toMatchObject({ status: "open", link_version: 1, expires_at: T0 + 7 * DAY_MS });
  });

  it("21st request in 24 h is global; concurrent: exactly one of ten passes the last slot", async () => {
    for (let i = 0; i < 19; i++) {
      await createFormTransfer(db, cfg, { ...base, id: `g${i}`, tokenHash: `g${i}`, email: `u${i}@example.org`, now: T0 });
    }
    const r = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createFormTransfer(db, cfg, { ...base, id: `c${i}`, tokenHash: `c${i}`, email: `c${i}@example.org`, now: T0 + 1 }),
      ),
    );
    expect(r.filter((x) => x === "ok")).toHaveLength(1);
    expect(r.filter((x) => x === "global")).toHaveLength(9);
  });
});
