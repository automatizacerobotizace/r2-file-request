import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handleScheduled } from "../src/app";
import { CLEANUP_BATCH, runCleanup } from "../src/cleanup";
import { loadConfig } from "../src/config";
import { DAY_MS, HOUR_MS, getTransfer } from "../src/db";
import { adminCall, createShare, putObject, requestUploadLink, setup, testDeps } from "./helpers";

describe("cleanup", () => {
  it("expires transfers after expires_at and deletes their objects; idempotent", async () => {
    const c = await setup();
    const { id } = await requestUploadLink(c);
    await putObject(`in/${id}`, "a.zip", 1);
    const share = await createShare(c, { days: 1 });
    c.clock.advance(DAY_MS);
    const d = testDeps({ clock: c.clock });
    expect((await getTransfer(env.DB, share.id))?.status).toBe("active");
    await runCleanup(d);
    expect((await getTransfer(env.DB, share.id))?.status).toBe("expired");
    expect(await env.BUCKET.head(`out/${share.id}`)).toBeNull();
    expect((await getTransfer(env.DB, id))?.status).toBe("open");
    c.clock.advance(6 * DAY_MS);
    await runCleanup(d);
    const t = await getTransfer(env.DB, id);
    expect(t).toMatchObject({ status: "expired", purged_at: c.clock.t });
    expect(await env.BUCKET.head(`in/${id}`)).toBeNull();
    expect(await runCleanup(d)).toEqual({ purged: 0, failures: 0 });
  });

  it("deletes drafts older than 24 h, including an uploaded object", async () => {
    const c = await setup();
    const { id } = await (await adminCall(c, "POST", "/api/out", { email: "a@example.org", name: "a", size: 1 })).json<{ id: string }>();
    await putObject(`out/${id}`, "a", 1);
    c.clock.advance(24 * HOUR_MS);
    await runCleanup(testDeps({ clock: c.clock }));
    expect(await getTransfer(env.DB, id)).toMatchObject({ status: "deleted", purged_at: c.clock.t });
    expect(await env.BUCKET.head(`out/${id}`)).toBeNull();
  });

  it("re-deletes the object until a deletion succeeds 24 h after the end", async () => {
    const c = await setup();
    const { id } = await requestUploadLink(c);
    await putObject(`in/${id}`, "a.zip", 1);
    await adminCall(c, "POST", `/api/transfers/${id}/delete`);
    expect(await env.BUCKET.head(`in/${id}`)).toBeNull();
    const endedAt = c.clock.t;
    expect(await getTransfer(env.DB, id)).toMatchObject({ status: "deleted", purged_at: null, ended_at: endedAt });
    // an upload that was running during the deletion completes (tests upload through the R2 binding, not S3)
    await putObject(`in/${id}`, "a.zip", 1);
    const d = testDeps({ clock: c.clock });
    expect(await runCleanup(d)).toEqual({ purged: 1, failures: 0 });
    expect(await env.BUCKET.head(`in/${id}`)).toBeNull();
    expect((await getTransfer(env.DB, id))?.purged_at).toBe(c.clock.t);
    await putObject(`in/${id}`, "a.zip", 1);
    c.clock.advance(HOUR_MS);
    expect(await runCleanup(d)).toEqual({ purged: 0, failures: 0 });
    expect(await env.BUCKET.head(`in/${id}`)).toBeNull();
    const lastPurge = c.clock.t;
    expect((await getTransfer(env.DB, id))?.purged_at).toBe(lastPurge);
    // 25 h after ended_at: one more deletion, the final one
    c.clock.advance(24 * HOUR_MS);
    await putObject(`in/${id}`, "a.zip", 1);
    expect(await runCleanup(d)).toEqual({ purged: 0, failures: 0 });
    expect(await env.BUCKET.head(`in/${id}`)).toBeNull();
    const finalPurge = c.clock.t;
    expect(await getTransfer(env.DB, id)).toMatchObject({ purged_at: finalPurge, ended_at: endedAt });
    // after the final deletion the transfer is left alone; the R2 lifecycle rule catches up
    c.clock.advance(15 * 60_000);
    await putObject(`in/${id}`, "a.zip", 1);
    expect(await runCleanup(d)).toEqual({ purged: 0, failures: 0 });
    expect(await env.BUCKET.head(`in/${id}`)).not.toBeNull();
    expect((await getTransfer(env.DB, id))?.purged_at).toBe(finalPurge);
  });

  it("re-deletes the object of an expired transfer", async () => {
    const c = await setup();
    const share = await createShare(c, { days: 1 });
    c.clock.advance(DAY_MS);
    const d = testDeps({ clock: c.clock });
    expect(await runCleanup(d)).toEqual({ purged: 1, failures: 0 });
    expect(await getTransfer(env.DB, share.id)).toMatchObject({ status: "expired", purged_at: c.clock.t });
    expect(await env.BUCKET.head(`out/${share.id}`)).toBeNull();
    await putObject(`out/${share.id}`, "a.zip", 1);
    c.clock.advance(HOUR_MS);
    expect(await runCleanup(d)).toEqual({ purged: 0, failures: 0 });
    expect(await env.BUCKET.head(`out/${share.id}`)).toBeNull();
  });

  it("removes transfers and their audit 90 days after the end", async () => {
    const c = await setup();
    const { id } = await requestUploadLink(c);
    await adminCall(c, "POST", `/api/transfers/${id}/delete`);
    c.clock.advance(90 * DAY_MS);
    await runCleanup(testDeps({ clock: c.clock }));
    expect(await getTransfer(env.DB, id)).toBeNull();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE transfer_id = ?").bind(id).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("repeated R2 failures: audit each run, E6 from the third run, at most once per 24 h", async () => {
    const c = await setup();
    const { id } = await requestUploadLink(c);
    await adminCall(c, "POST", `/api/transfers/${id}/delete`);
    c.clock.advance(loadConfig(c.env).presignSeconds * 1000 + 1);
    const failing = { ...env.BUCKET, delete: async () => { throw new Error("r2 down"); } } as unknown as R2Bucket;
    const d = testDeps({ clock: c.clock, env: { BUCKET: failing } });
    for (let i = 0; i < 4; i++) {
      expect(await runCleanup(d)).toEqual({ purged: 0, failures: 1 });
      c.clock.advance(15 * 60_000);
    }
    const errs = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'cleanup_error'").first<{ n: number }>();
    expect(errs?.n).toBe(4);
    expect(d.mailer.sent.filter((m) => m.subject.includes("cleanup"))).toHaveLength(1);
    const ok = testDeps({ clock: c.clock });
    await runCleanup(ok);
    expect((await getTransfer(env.DB, id))?.purged_at).toBe(c.clock.t);
    expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'cleanup_failures'").first()).toBeNull();
  });

  it("keeps deleting after the window until a deletion succeeds", async () => {
    const c = await setup();
    const { id } = await requestUploadLink(c);
    await adminCall(c, "POST", `/api/transfers/${id}/delete`);
    const endedAt = c.clock.t;
    const ok = testDeps({ clock: c.clock });
    expect(await runCleanup(ok)).toEqual({ purged: 1, failures: 0 });
    const firstPurge = c.clock.t;
    // an upload that was running during the deletion completes; from now on R2 deletions fail
    await putObject(`in/${id}`, "a.zip", 1);
    const failing = { ...env.BUCKET, delete: async () => { throw new Error("r2 down"); } } as unknown as R2Bucket;
    const bad = testDeps({ clock: c.clock, env: { BUCKET: failing } });
    c.clock.advance(25 * HOUR_MS);
    expect(await runCleanup(bad)).toEqual({ purged: 0, failures: 1 });
    expect(await getTransfer(env.DB, id)).toMatchObject({ purged_at: firstPurge, ended_at: endedAt });
    // 90 days later the record must still be there: the object was never deleted for good
    c.clock.advance(90 * DAY_MS);
    expect(await runCleanup(bad)).toEqual({ purged: 0, failures: 1 });
    expect(await getTransfer(env.DB, id)).not.toBeNull();
    expect(await env.BUCKET.head(`in/${id}`)).not.toBeNull();
    expect(await runCleanup(ok)).toEqual({ purged: 0, failures: 0 });
    expect(await env.BUCKET.head(`in/${id}`)).toBeNull();
    expect(await getTransfer(env.DB, id)).toBeNull();
  });

  it("more ended transfers than one batch: all are deleted and the runs take turns", async () => {
    const c = await setup();
    const ids = Array.from({ length: CLEANUP_BATCH + 10 }, (_, i) => `t${String(i).padStart(3, "0")}`);
    const insert = env.DB.prepare(
      "INSERT INTO transfers (id, direction, email, lang, origin, created_at, valid_days, status, ended_at) VALUES (?1, 'in', 'a@example.org', 'cs', 'admin', ?2, 7, 'deleted', ?2)",
    );
    await env.DB.batch(ids.map((id) => insert.bind(id, c.clock.t)));
    const putAll = () => Promise.all(ids.map((id) => putObject(`in/${id}`, "a.zip", 1)));
    const left = async () => (await env.BUCKET.list()).objects.length;
    const d = testDeps({ clock: c.clock });
    await putAll();
    expect(await runCleanup(d)).toEqual({ purged: CLEANUP_BATCH, failures: 0 });
    c.clock.advance(15 * 60_000);
    expect(await runCleanup(d)).toEqual({ purged: 10, failures: 0 });
    expect(await left()).toBe(0);
    // the objects come back (uploads finishing late): two more runs reach every transfer again
    await putAll();
    c.clock.advance(15 * 60_000);
    await runCleanup(d);
    c.clock.advance(15 * 60_000);
    await runCleanup(d);
    expect(await left()).toBe(0);
  });

  it("keeps a transfer and its audit past 90 days until its object is deleted", async () => {
    const c = await setup();
    const { id } = await requestUploadLink(c);
    await adminCall(c, "POST", `/api/transfers/${id}/delete`);
    await putObject(`in/${id}`, "a.zip", 1);
    const auditCount = async () =>
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE transfer_id = ?").bind(id).first<{ n: number }>())!.n;
    const before = await auditCount();
    expect(before).toBeGreaterThan(0);
    const failing = { ...env.BUCKET, delete: async () => { throw new Error("r2 down"); } } as unknown as R2Bucket;
    c.clock.advance(91 * DAY_MS);
    expect(await runCleanup(testDeps({ clock: c.clock, env: { BUCKET: failing } }))).toEqual({ purged: 0, failures: 1 });
    expect(await getTransfer(env.DB, id)).toMatchObject({ status: "deleted", purged_at: null });
    expect(await auditCount()).toBe(before);
    expect(await runCleanup(testDeps({ clock: c.clock }))).toEqual({ purged: 1, failures: 0 });
    expect(await env.BUCKET.head(`in/${id}`)).toBeNull();
    expect(await getTransfer(env.DB, id)).toBeNull();
    expect(await auditCount()).toBe(0);
  });

  it("handleScheduled runs the cleanup", async () => {
    const c = await setup();
    const share = await createShare(c, { days: 1 });
    c.clock.advance(DAY_MS);
    await handleScheduled(c.env, { mailer: c.mailer, fetch: c.fetch, now: c.clock.now });
    expect((await getTransfer(env.DB, share.id))?.status).toBe("expired");
  });
});
