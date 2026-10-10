import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DAY_MS } from "../src/db";
import { enterMaintenance, getMaintenance, leaveMaintenance } from "../src/maintenance";
import { notifyProblem, sendNotice } from "../src/notify";
import { resetState, testDeps } from "./helpers";

beforeEach(resetState);

describe("notifyProblem (E6)", () => {
  it("sends the same kind at most once per 24 h", async () => {
    const d = testDeps();
    await notifyProblem(d, "dns", "example.org");
    await notifyProblem(d, "dns", "example.org");
    await notifyProblem(d, "cleanup", "x");
    expect(d.mailer.sent.map((m) => m.subject)).toHaveLength(2);
    d.clock.advance(DAY_MS + 1);
    await notifyProblem(d, "dns", "example.org");
    expect(d.mailer.sent).toHaveLength(3);
  });

  it("two concurrent calls of the same kind send exactly one e-mail", async () => {
    const d = testDeps();
    await Promise.all([notifyProblem(d, "dns", "a.example.org"), notifyProblem(d, "dns", "b.example.org")]);
    expect(d.mailer.sent).toHaveLength(1);
  });

  it("after an SMTP failure the next attempt waits 24 h", async () => {
    const d = testDeps();
    d.mailer.failAlways = true;
    await notifyProblem(d, "dns", "x");
    d.mailer.failAlways = false;
    d.clock.advance(DAY_MS - 1);
    await notifyProblem(d, "dns", "x");
    expect(d.mailer.sent).toHaveLength(0);
    d.clock.advance(1);
    await notifyProblem(d, "dns", "x");
    expect(d.mailer.sent).toHaveLength(1);
  });

  it("records a failed E6 in the audit", async () => {
    const d = testDeps();
    d.mailer.failAlways = true;
    await notifyProblem(d, "dns", "x");
    const row = await env.DB.prepare("SELECT detail FROM audit WHERE action = 'mail_failed'").first<{ detail: string }>();
    expect(row?.detail).toBe("E6:dns");
  });
});

describe("sendNotice", () => {
  it("audits failures and does not throw", async () => {
    const d = testDeps();
    d.mailer.failAlways = true;
    await sendNotice(d, { to: "a@example.com", subject: "s", text: "t" }, "E3", "tid");
    const row = await env.DB.prepare("SELECT * FROM audit WHERE action = 'mail_failed'").first<{ detail: string; transfer_id: string }>();
    expect(row).toMatchObject({ detail: "E3", transfer_id: "tid" });
  });
});

describe("maintenance", () => {
  it("automatic entry sends E6 once; manual leave works", async () => {
    const d = testDeps();
    expect(await enterMaintenance(d, "upload_total", "system")).toBe(true);
    expect(await enterMaintenance(d, "upload_total", "system")).toBe(false);
    expect(await getMaintenance(env.DB)).toMatchObject({ reason: "upload_total", actor: "system" });
    expect(d.mailer.sent).toHaveLength(1);
    expect(await leaveMaintenance(d, "admin:a@example.com")).toBe(true);
    expect(await getMaintenance(env.DB)).toBeNull();
  });

  it("manual entry by admin sends no E6", async () => {
    const d = testDeps();
    await enterMaintenance(d, "manual", "admin:a@example.com");
    expect(d.mailer.sent).toHaveLength(0);
  });
});
