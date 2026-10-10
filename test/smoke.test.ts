import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("has D1 with migrations applied", async () => {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM settings").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("has an R2 bucket binding", async () => {
    await env.BUCKET.put("smoke/x", "hello", { customMetadata: { filename: "a%20b.txt" } });
    const head = await env.BUCKET.head("smoke/x");
    expect(head?.size).toBe(5);
    expect(head?.customMetadata?.filename).toBe("a%20b.txt");
    await env.BUCKET.delete("smoke/x");
  });

  it("sees configuration variables", () => {
    expect(env.PUBLIC_ORIGIN).toBe("https://fileshare.example.com");
    expect(env.R2_ACCESS_KEY_ID).toBe("AKIAIOSFODNN7EXAMPLE");
  });
});
