import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { adminCall, call, createShare, putObject, requestUploadLink, setup } from "./helpers";

const S3 = "https://ACCOUNT_ID.eu.r2.cloudflarestorage.com";

function base(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-inline");
  return csp;
}

describe("security headers per page", () => {
  it("form, upload, download, admin, message, API and redirect", async () => {
    const c = await setup();
    const form = base(await call(c, "GET", "/"));
    expect(form).toContain("frame-src https://challenges.cloudflare.com");
    expect(form).not.toContain(S3);

    const { token } = await requestUploadLink(c);
    const up = base(await call(c, "GET", `/u/${token}`));
    expect(up).toContain(`connect-src 'self' ${S3}`);
    expect(up).toContain("frame-src 'none'");

    const share = await createShare(c);
    const down = base(await call(c, "GET", `/d/${share.token}`));
    expect(down).toContain(`form-action 'self' ${S3}`);
    expect(down).toContain("connect-src 'self';");

    const adm = base(await adminCall(c, "GET", ""));
    expect(adm).toContain(`connect-src 'self' ${S3}`);

    const msg = base(await call(c, "GET", "/u/nope"));
    expect(msg).toContain("script-src 'self';");

    expect(base(await call(c, "POST", "/api/request", { json: {} }))).toBe("default-src 'none'; frame-ancestors 'none'");
    base(await call(c, "POST", `/d/${share.token}/download`, { body: "" }));
    base(await adminCall(c, "GET", "/api/overview"));
  });
});

describe("no secrets in the audit log", () => {
  it("audit rows contain no tokens and no URLs", async () => {
    const c = await setup();
    const { token, id } = await requestUploadLink(c);
    await call(c, "POST", `/api/u/${token}/start`, { json: { name: "a.zip", size: 1 } });
    await putObject(`in/${id}`, "a.zip", 1);
    await call(c, "POST", `/api/u/${token}/confirm`, { json: {} });
    const share = await createShare(c);
    await call(c, "POST", `/d/${share.token}/download`, { body: "" });
    await adminCall(c, "POST", `/api/transfers/${id}/download`);
    await adminCall(c, "POST", `/api/transfers/${share.id}/resend`, { linkVersion: 1 });
    const { results } = await env.DB.prepare("SELECT * FROM audit").all();
    const dump = JSON.stringify(results);
    expect(results.length).toBeGreaterThan(5);
    for (const secret of [token, share.token]) expect(dump).not.toContain(secret);
    expect(dump).not.toMatch(/https?:\/\//);
    expect(dump).not.toContain("X-Amz");
  });
});
