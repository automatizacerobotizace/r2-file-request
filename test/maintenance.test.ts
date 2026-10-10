import { describe, expect, it } from "vitest";
import { adminCall, call, createShare, mailsTo, requestUploadLink, setup } from "./helpers";

describe("maintenance mode", () => {
  it("blocks the public part, keeps the admin working, manual switch off", async () => {
    const c = await setup();
    const { token } = await requestUploadLink(c);
    const share = await createShare(c);
    await adminCall(c, "POST", "/api/maintenance", { on: true });

    expect((await call(c, "GET", "/")).status).toBe(503);
    expect(await (await call(c, "POST", "/api/request", { json: { email: "x@example.org", turnstile: "x" } })).json()).toEqual({ error: "maintenance" });
    expect((await call(c, "GET", `/u/${token}`)).status).toBe(503);
    expect(await (await call(c, "POST", `/api/u/${token}/start`, { json: { name: "a", size: 1 } })).json()).toEqual({ error: "maintenance" });
    expect((await call(c, "GET", `/d/${share.token}`)).status).toBe(503);
    expect((await call(c, "POST", `/d/${share.token}/download`, { body: "" })).status).toBe(503);

    const r = await adminCall(c, "POST", "/api/in", { email: "novy@example.org" });
    expect(r.status).toBe(200);
    expect(mailsTo(c, "novy@example.org")).toHaveLength(1);

    await adminCall(c, "POST", "/api/maintenance", { on: false });
    expect((await call(c, "GET", `/u/${token}`)).status).toBe(200);
  });
});
