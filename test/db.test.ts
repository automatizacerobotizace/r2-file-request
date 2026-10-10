import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS, activateOut, addAudit, getByTokenHash, getTransfer, insertAdminIncoming, insertDraft, insertSettingIfAbsent,
  isLive, listTransfers, markDeleted, markFirstDownload, markOutUploaded, markReceived, rotateToken, deleteSetting, getSetting,
} from "../src/db";
import { T0, resetState } from "./helpers";

const db = env.DB;
beforeEach(resetState);

describe("incoming transfer", () => {
  it("open → received only once and only while valid", async () => {
    await insertAdminIncoming(db, { id: "a", tokenHash: "h1", email: "c@example.org", lang: "cs", validDays: 7, now: T0 });
    const t = await getTransfer(db, "a");
    expect(t).toMatchObject({ status: "open", link_version: 1, expires_at: T0 + 7 * DAY_MS, origin: "admin" });
    expect(isLive(t!, T0 + 7 * DAY_MS - 1)).toBe(true);
    expect(await getByTokenHash(db, "h1")).not.toBeNull();
    expect(await markReceived(db, "a", "x.zip", 10, T0 + 7 * DAY_MS)).toBe(false); // expired
    expect(await markReceived(db, "a", "x.zip", 10, T0 + 1)).toBe(true);
    expect(await markReceived(db, "a", "y.zip", 20, T0 + 2)).toBe(false);
    expect(await getTransfer(db, "a")).toMatchObject({ status: "received", file_name: "x.zip", file_size: 10, uploaded_at: T0 + 1 });
  });
});

describe("outgoing transfer", () => {
  beforeEach(async () => {
    await insertDraft(db, { id: "o", email: "c@example.org", lang: "en", validDays: 3, now: T0 });
  });

  it("cannot be activated before the file is uploaded", async () => {
    expect(await activateOut(db, "o", "h", T0 + 1, T0 - 1)).toBe(false);
    expect(await markOutUploaded(db, "o", "a.pdf", 5, T0 + 1, T0 - 1)).toBe(true);
    expect(await markOutUploaded(db, "o", "b.pdf", 6, T0 + 2, T0 - 1)).toBe(false);
    expect(await activateOut(db, "o", "h", T0 + 10, T0 - 1)).toBe(true);
    expect(await getTransfer(db, "o")).toMatchObject({
      status: "active", token_hash: "h", link_version: 1, sent_at: T0 + 10, expires_at: T0 + 10 + 3 * DAY_MS,
    });
  });

  it("upload and activation are refused once the draft deadline has passed", async () => {
    expect(await markOutUploaded(db, "o", "a.pdf", 5, T0 + 1, T0)).toBe(false);
    expect(await markOutUploaded(db, "o", "a.pdf", 5, T0 + 1, T0 - 1)).toBe(true);
    expect(await activateOut(db, "o", "h", T0 + 2, T0)).toBe(false);
    expect(await getTransfer(db, "o")).toMatchObject({ status: "draft", token_hash: null });
  });

  it("two concurrent activations: exactly one succeeds", async () => {
    await markOutUploaded(db, "o", "a.pdf", 5, T0, T0 - 1);
    const r = await Promise.all([activateOut(db, "o", "h1", T0 + 1, T0 - 1), activateOut(db, "o", "h2", T0 + 1, T0 - 1)]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it("rotateToken needs the expected link_version; concurrent rotations with same version: one wins", async () => {
    await markOutUploaded(db, "o", "a.pdf", 5, T0, T0 - 1);
    await activateOut(db, "o", "h1", T0, T0 - 1);
    const r = await Promise.all([rotateToken(db, "o", "h2", T0, 1), rotateToken(db, "o", "h3", T0, 1)]);
    expect(r.filter(Boolean)).toHaveLength(1);
    const t = await getTransfer(db, "o");
    expect(t?.link_version).toBe(2);
    expect(await getByTokenHash(db, "h1")).toBeNull();
    expect(await rotateToken(db, "o", "h4", T0, 1)).toBe(false);
  });

  it("markDeleted and markFirstDownload are one-shot", async () => {
    expect(await markFirstDownload(db, "o", T0)).toBe(true);
    expect(await markFirstDownload(db, "o", T0 + 1)).toBe(false);
    expect(await markDeleted(db, "o", T0)).toBe(true);
    expect(await markDeleted(db, "o", T0)).toBe(false);
    expect(await getTransfer(db, "o")).toMatchObject({ status: "deleted", ended_at: T0 });
  });

  it("listTransfers counts only customer download_url events and hides nothing needed", async () => {
    await addAudit(db, { ts: T0, actor: "customer", action: "download_url", transferId: "o", linkVersion: 1 });
    await addAudit(db, { ts: T0, actor: "admin:a@example.com", action: "admin_download", transferId: "o" });
    const [row] = await listTransfers(db, "out");
    expect(row?.downloads).toBe(1);
  });
});

describe("settings", () => {
  it("insertSettingIfAbsent inserts once", async () => {
    expect(await insertSettingIfAbsent(db, "k", "1")).toBe(true);
    expect(await insertSettingIfAbsent(db, "k", "2")).toBe(false);
    expect(await getSetting(db, "k")).toBe("1");
    expect(await deleteSetting(db, "k")).toBe(true);
    expect(await getSetting(db, "k")).toBeNull();
  });
});
