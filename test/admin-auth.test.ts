import { describe, expect, it } from "vitest";
import { adminCall, adminClaims, call, setup, signJwt } from "./helpers";

describe("admin access", () => {
  it("without or with an invalid JWT: 403 for page and API", async () => {
    const c = await setup();
    expect((await adminCall(c, "GET", "", undefined, { jwt: null })).status).toBe(403);
    expect((await adminCall(c, "GET", "/api/overview", undefined, { jwt: null })).status).toBe(403);
    const wrongAud = await signJwt(adminClaims(c, { aud: ["X"] }));
    expect((await adminCall(c, "GET", "/api/overview", undefined, { jwt: wrongAud })).status).toBe(403);
  });

  it("with a valid JWT: page and overview work", async () => {
    const c = await setup();
    const page = await adminCall(c, "GET", "");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("/static/admin.js");
    const ov = await adminCall(c, "GET", "/api/overview");
    expect(await ov.json()).toEqual({ maintenance: null, warnings: [] });
  });

  it("POST needs exact Origin and JSON", async () => {
    const c = await setup();
    expect((await adminCall(c, "POST", "/api/maintenance", { on: true }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await adminCall(c, "POST", "/api/maintenance", { on: true }, { origin: null })).status).toBe(403);
    expect((await adminCall(c, "POST", "/api/maintenance", { on: true }, { origin: "null" })).status).toBe(403);
    const jwt = await signJwt(adminClaims(c));
    const form = await call(c, "POST", "/admin/api/maintenance", {
      body: "on=true", headers: { "Cf-Access-Jwt-Assertion": jwt, Origin: "https://fileshare.example.com", "content-type": "application/x-www-form-urlencoded" },
    });
    expect(form.status).toBe(403);
  });

  it("no state-changing GET exists", async () => {
    const c = await setup();
    expect((await adminCall(c, "GET", "/api/maintenance")).status).toBe(404);
    expect((await adminCall(c, "GET", "/api/transfers/00000000-0000-4000-8000-000000000000/delete")).status).toBe(404);
  });

  it("maintenance toggle: on/off with audit actor", async () => {
    const c = await setup();
    await adminCall(c, "POST", "/api/maintenance", { on: true });
    const ov = await (await adminCall(c, "GET", "/api/overview")).json<{ maintenance: { reason: string; actor: string } }>();
    expect(ov.maintenance).toMatchObject({ reason: "manual", actor: "admin:admin@example.com" });
    expect((await call(c, "GET", "/")).status).toBe(503);
    await adminCall(c, "POST", "/api/maintenance", { on: false });
    expect((await call(c, "GET", "/")).status).toBe(200);
    const audit = await (await adminCall(c, "GET", "/api/audit")).json<{ events: { action: string }[] }>();
    expect(audit.events.map((e) => e.action)).toEqual(expect.arrayContaining(["maintenance_on", "maintenance_off"]));
  });

  it("custom ADMIN_PATH: /admin is 404, custom path works, invalid path is 500", async () => {
    const c = await setup({ ADMIN_PATH: "/sprava-x7" });
    expect((await call(c, "GET", "/admin")).status).toBe(404);
    expect((await adminCall(c, "GET", "/api/overview")).status).toBe(200);
    const bad = await setup({ ADMIN_PATH: "/api" });
    expect((await call(bad, "GET", "/")).status).toBe(500);
  });
});
