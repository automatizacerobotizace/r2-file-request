import { describe, expect, it } from "vitest";
import { MAX_JSON_BYTES, apiError, csp, html, json, readJson, redirect } from "../src/http";

function expectBase(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
}

describe("http", () => {
  it("csp has strict defaults and per-page extras", () => {
    const base = csp();
    expect(base).toContain("default-src 'none'");
    expect(base).toContain("script-src 'self'");
    expect(base).toContain("connect-src 'self'");
    expect(base).toContain("frame-src 'none'");
    expect(base).toContain("frame-ancestors 'none'");
    expect(base).not.toContain("unsafe-inline");
    expect(base).toContain("font-src 'self'");
    const form = csp({ script: ["https://challenges.cloudflare.com"], frame: ["https://challenges.cloudflare.com"] });
    expect(form).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(form).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp({ connect: ["https://s3.example"] })).toContain("connect-src 'self' https://s3.example");
    expect(csp({ formAction: ["https://s3.example"] })).toContain("form-action 'self' https://s3.example");
  });

  it("all helpers set the base security headers", async () => {
    const h = html("<p>x</p>", csp());
    expectBase(h);
    expect(h.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(h.headers.get("content-security-policy")).toBe(csp());
    const j = json({ a: 1 }, 201);
    expectBase(j);
    expect(j.status).toBe(201);
    expect(j.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    const e = apiError("link_invalid", 410);
    expect(await e.json()).toEqual({ error: "link_invalid" });
    const r = redirect("https://s3.example/x");
    expectBase(r);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://s3.example/x");
  });
});

function jsonRequest(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("https://fileshare.example.com/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit);
}

// A JSON string literal of exactly `bytes` bytes once wrapped in an object: {"a":"xxx…"}.
function jsonOfSize(bytes: number): string {
  return `{"a":"${"x".repeat(bytes - 8)}"}`;
}

describe("readJson", () => {
  it("returns the parsed object for a normal body", async () => {
    expect(await readJson(jsonRequest(JSON.stringify({ email: "a@example.org", days: 7 })))).toEqual({
      email: "a@example.org",
      days: 7,
    });
  });

  it("rejects a 1 MiB body announced by Content-Length", async () => {
    const body = jsonOfSize(1024 * 1024);
    const req = jsonRequest(body, { "content-length": String(body.length) });
    expect(req.headers.get("content-length")).toBe(String(1024 * 1024));
    expect(await readJson(req)).toBeNull();
  });

  it("rejects a streamed body without Content-Length once it exceeds the limit", async () => {
    const chunk = new TextEncoder().encode("x".repeat(4096));
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) {
        ctl.enqueue(new TextEncoder().encode('{"a":"'));
      },
      pull(ctl) {
        pulls++;
        if (pulls > 1000) {
          ctl.enqueue(new TextEncoder().encode('"}'));
          ctl.close();
        } else ctl.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = jsonRequest(stream);
    expect(req.headers.get("content-length")).toBeNull();
    expect(await readJson(req)).toBeNull();
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
  });

  it("accepts a body of exactly the limit", async () => {
    const body = jsonOfSize(MAX_JSON_BYTES);
    expect(new TextEncoder().encode(body).length).toBe(MAX_JSON_BYTES);
    const v = await readJson<{ a: string }>(jsonRequest(body));
    expect(v?.a.length).toBe(MAX_JSON_BYTES - 8);
  });

  it("returns null for a JSON array", async () => {
    expect(await readJson(jsonRequest("[1, 2]"))).toBeNull();
  });
});
